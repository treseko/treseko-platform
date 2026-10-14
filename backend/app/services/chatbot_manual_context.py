"""Freeze manual execution inputs privately; expose only policy-safe evidence."""
import json
from copy import deepcopy
from types import SimpleNamespace

from fastapi import HTTPException

from ..repositories.chatbot_execution import build_chatbot_context, merge_chatbot_config, validate_chatbot_execution_config
from .api_dynamic_variables import DynamicVariableContext
from .api_evidence_policy import evidence_policy_marker, public_test_data_evidence_enabled
from .ai_report_sanitizer import sanitize_ai_report_payload
from .secret_crypto import encrypt_secret_value, decrypt_secret_value


def freeze_manual_context(execution, case, run, resolved, environment=None):
    variables = (resolved or {}).get('variables_resueltas') or {}
    dataset = (resolved or {}).get('dataset_resuelto') or []
    environment_config = (resolved or {}).get('configuracion_chatbot_ambiente') or {}
    dynamic = DynamicVariableContext(execution.dynamic_seed)
    context = build_chatbot_context(case, run, variables, dataset, '', environment_config, dynamic_variables=dynamic)
    template = merge_chatbot_config(environment_config, case.configuracion_chatbot or {})
    public = public_test_data_evidence_enabled(execution=execution, environment=environment, case=case)
    context['evidence_policy'] = evidence_policy_marker(public)['evidence_policy']
    private = {'context': context, 'template': template, 'dynamic_values': dynamic.values, 'public': public,
               'environment': {key: deepcopy(getattr(environment, key, None)) for key in ('url', 'variables', 'configuracion_chatbot')} if environment is not None else None}
    execution.chatbot_manual_context_secret = encrypt_secret_value(json.dumps(private, ensure_ascii=False))
    execution.chatbot_config_snapshot = deepcopy(context) if public else sanitize_ai_report_payload(context)
    return private


def thaw_manual_context(execution):
    secret = getattr(execution, 'chatbot_manual_context_secret', None)
    if secret:
        try:
            return json.loads(decrypt_secret_value(secret))
        except (ValueError, json.JSONDecodeError) as exc:
            raise HTTPException(409, 'No se pudo recuperar el contexto congelado de la ejecución.') from exc
    # Legacy executions can resume only when their frozen snapshot is complete.
    # Never replace redacted credentials or an existing transcript with live settings.
    snapshot = getattr(execution, 'chatbot_config_snapshot', None) or {}
    if snapshot.get('config'):
        if '[redacted]' in json.dumps(snapshot).lower():
            raise HTTPException(409, 'Esta ejecución histórica no conserva el contexto privado completo. Inicia una nueva ejecución.')
        private = {'context': deepcopy(snapshot), 'template': deepcopy(snapshot['config']), 'dynamic_values': {},
                   'public': bool((snapshot.get('evidence_policy') or {}).get('public_test_data'))}
        execution.chatbot_manual_context_secret = encrypt_secret_value(json.dumps(private, ensure_ascii=False))
        return private
    if (getattr(execution, 'chatbot_resultado', None) or {}).get('turns'):
        raise HTTPException(409, 'Esta ejecución histórica no conserva el contexto congelado. Inicia una nueva ejecución.')
    return None


def validate_manual_context(private):
    context = private['context']
    errors = validate_chatbot_execution_config(SimpleNamespace(configuracion_chatbot=private['template']), variables=context.get('variables') or {})
    if errors:
        raise HTTPException(400, 'No se puede ejecutar el Chatbot: ' + ' '.join(errors))
