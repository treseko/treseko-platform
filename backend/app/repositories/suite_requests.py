"""Replay committed suite creation/copy requests without duplicating records."""
import hashlib
import json
from sqlalchemy import select
from .. import models
from .suite_policy import lock_suite_project


def request_details(payload, source_id=None):
    data = payload.model_dump(mode='json')
    request_id = data.pop('request_id', None)
    if not request_id:
        return {}
    value = {'payload': data, 'source_id': str(source_id) if source_id else None}
    fingerprint = hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()
    return {'suite_request_id': str(request_id), 'suite_request_fingerprint': fingerprint}


async def previous_request(db, user_id, project_id, action, details):
    if not details:
        return None
    await lock_suite_project(db, project_id)
    log = await db.scalar(select(models.AuditLog).where(models.AuditLog.usuario_id == user_id,
        models.AuditLog.recurso == 'suite', models.AuditLog.accion == action,
        models.AuditLog.detalles['suite_request_id'].as_string() == details['suite_request_id'],
    ).order_by(models.AuditLog.fecha.desc()).limit(1))
    if not log:
        return None
    if (log.detalles or {}).get('suite_request_fingerprint') != details['suite_request_fingerprint']:
        raise ValueError('El identificador de guardado se usó con otros datos. Abre una nueva operación.')
    suite = await db.get(models.Suite, log.recurso_id)
    if not suite or not suite.activo or suite.proyecto_id != project_id:
        raise ValueError('La operación ya se guardó, pero su suite dejó de estar disponible. Recarga el proyecto.')
    return suite, log.detalles
