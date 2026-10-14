"""Private execution payloads: encryption never changes the test's data."""
import json

SCHEMA = 'treseko.worker-payload/v1'


def freeze_worker_payload(payload):
    from .secret_crypto import encrypt_secret_value
    summary = {key: payload[key] for key in ('proyecto_id', 'case_code', 'framework', 'language', 'script_format', 'dry_run', 'record_video', 'correlation_id') if key in payload}
    return {**summary, 'schema_version': SCHEMA, 'payload_secret': encrypt_secret_value(json.dumps(payload, ensure_ascii=False))}


def decode_worker_payload(value):
    from .secret_crypto import decrypt_secret_value
    if isinstance(value, dict) and value.get('schema_version') in {SCHEMA, 'treseko.api-worker-job/v1'} and 'payload_secret' in value:
        decoded = json.loads(decrypt_secret_value(value['payload_secret']))
        if not isinstance(decoded, dict):
            raise ValueError('El payload privado del worker no es válido')
        return decoded
    return value


def worker_payload(job):
    if getattr(job, 'job_type', None) == 'API_EXECUTION':
        from ..repositories.api_automation_jobs import decrypt_api_worker_payload
        return decrypt_api_worker_payload(job)
    return decode_worker_payload(job.payload_congelado)
