from datetime import datetime, timedelta
from uuid import UUID
from sqlalchemy import delete, select
from .. import models
from ..time_utils import utc_now, ensure_utc


async def register_recording(db, report, project_id, *, execution_id=None, temporary=False):
    reference = report.get('recording_ref') if isinstance(report, dict) else None
    if not isinstance(reference, dict):
        return None
    try:
        identifier = UUID(reference['id'])
        size = int(reference['size_bytes'])
        pages = int(reference.get('page_count', 1))
        if not 1 <= pages <= 100:
            raise ValueError('Invalid page count')
        if size <= 0 or size > 128 * 1024 * 1024:
            raise ValueError('Invalid size')
        expires = datetime.fromisoformat(reference['expires_at'].replace('Z', '+00:00')) if temporary else None
        if temporary and (expires.tzinfo is None or expires <= utc_now()):
            raise ValueError('Invalid expiry')
    except (ValueError, KeyError, TypeError, AttributeError):
        report.pop('recording_ref', None)
        return None
    row = await db.get(models.AiVideoRecording, identifier)
    if row and (row.proyecto_id != project_id or row.execution_id != execution_id):
        report.pop('recording_ref', None)
        return None
    if row is None:
        db.add(models.AiVideoRecording(id=identifier, proyecto_id=project_id, execution_id=execution_id, size_bytes=size, expires_at=expires))
    report['recording_ref'] = {'id': str(identifier), 'content_type': 'video/webm',
        'temporary': temporary, 'expires_at': expires.isoformat() if expires else None,
        'size_bytes': size, 'page_count': pages, 'url': f'/ai-videos/{identifier}/'}
    # Expired dry-run metadata is disposable too; permanent evidence remains.
    await db.execute(delete(models.AiVideoRecording).where(models.AiVideoRecording.expires_at < utc_now() - timedelta(days=1)))
    await db.flush()
    return report['recording_ref']


def worker_video_path(identifier):
    from .worker_result_storage import result_upload_root
    root = result_upload_root() / 'temporary-videos'
    return root / f'{UUID(str(identifier))}.webm'


async def import_worker_temporary_video(db, content: bytes, project_id):
    import os
    from uuid import uuid4
    identifier = uuid4()
    file = worker_video_path(identifier)
    file.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if file.parent.is_symlink():
        raise ValueError('El almacenamiento temporal no puede ser un enlace')
    import shutil
    reserve=max(0,int(os.getenv('AUTOMATION_EVIDENCE_DISK_RESERVE_MB','512')))*1024*1024
    if shutil.disk_usage(file.parent).free < len(content)+reserve:
        raise OSError('No hay espacio para conservar el video completo; se reintentará su entrega')
    # Exclusive creation and fsync: a result is never acknowledged without
    # retaining every byte. Storage failures propagate so delivery can retry.
    with file.open('xb') as stream:
        os.chmod(file, 0o600)
        stream.write(content)
        stream.flush()
        os.fsync(stream.fileno())
    expires = utc_now() + timedelta(hours=24)
    db.add(models.AiVideoRecording(id=identifier, proyecto_id=project_id,
        execution_id=None, size_bytes=len(content), expires_at=expires))
    await db.flush()
    return {'type': 'video', 'content_type': 'video/webm', 'filename': 'dry-run.webm',
        'recording_ref': {'id': str(identifier), 'content_type': 'video/webm',
        'temporary': True, 'expires_at': expires.isoformat(), 'size_bytes': len(content),
        'page_count': 1, 'url': f'/ai-videos/{identifier}/'}}


async def cleanup_expired_worker_videos(db):
    rows = (await db.execute(select(models.AiVideoRecording).where(
        models.AiVideoRecording.expires_at <= utc_now()))).scalars().all()
    for row in rows:
        file = worker_video_path(row.id)
        if file.is_file() and not file.is_symlink():
            file.unlink()
            await db.delete(row)


async def cleanup_worker_video_storage():
    from ..database import AsyncSessionLocal
    async with AsyncSessionLocal() as db:
        await cleanup_expired_worker_videos(db)
        await db.commit()
