from uuid import UUID
import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Query
from fastapi.responses import StreamingResponse, FileResponse
from ... import models, auth, access_control
from ...database import get_db
from ...time_utils import utc_now, ensure_utc
from ...services.ai_video_recordings import worker_video_path
from ...repositories.repository_context import ENGINE_URL, engine_internal_headers

router = APIRouter(tags=['AI video evidence'])


@router.get('/ai-videos/{recording_id}/')
async def read_video(recording_id: UUID, request: Request, page: int = Query(0, ge=0, le=99), db=Depends(get_db), user=Depends(auth.check_capability('motor_ia.ver', 'read'))):
    row = await db.get(models.AiVideoRecording, recording_id)
    if not row:
        raise HTTPException(404, 'Video no disponible')
    await access_control.require_project_access(db, user, row.proyecto_id, 'read')
    if row.expires_at and ensure_utc(row.expires_at) <= utc_now():
        raise HTTPException(410, 'El video temporal ha caducado')
    local_file = worker_video_path(recording_id)
    if local_file.is_file() and not local_file.is_symlink():
        if page != 0:
            raise HTTPException(404, 'Página de video no disponible')
        return FileResponse(local_file, media_type='video/webm', headers={
            'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff'})
    headers = engine_internal_headers()
    if request.headers.get('range'):
        headers['Range'] = request.headers['range']
    client = httpx.AsyncClient(timeout=30)
    try:
        upstream = await client.send(client.build_request('GET', f'{ENGINE_URL.rstrip("/")}/internal/videos/{recording_id}?page={page}', headers=headers), stream=True)
    except httpx.HTTPError:
        await client.aclose()
        raise HTTPException(503, 'Almacenamiento de video no disponible')
    if upstream.status_code not in (200, 206):
        status = upstream.status_code
        await upstream.aclose()
        await client.aclose()
        raise HTTPException(404 if status == 404 else 502, 'Video no disponible')

    async def chunks():
        try:
            async for chunk in upstream.aiter_bytes():
                yield chunk
        finally:
            await upstream.aclose()
            await client.aclose()
    response_headers = {'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff'}
    for key in ('content-length', 'content-range', 'accept-ranges'):
        if key in upstream.headers:
            response_headers[key] = upstream.headers[key]
    return StreamingResponse(chunks(), status_code=upstream.status_code, media_type='video/webm', headers=response_headers)


@router.delete('/ai-videos/{recording_id}/', status_code=204)
async def delete_video(recording_id: UUID, db=Depends(get_db), user=Depends(auth.check_capability('crear_pruebas.scripts', 'edit'))):
    row = await db.get(models.AiVideoRecording, recording_id)
    if not row:
        raise HTTPException(404, 'Video no disponible')
    await access_control.require_project_access(db, user, row.proyecto_id, 'edit')
    if row.expires_at is None:
        raise HTTPException(409, 'Solo se pueden eliminar videos temporales de dry run')
    local_file = worker_video_path(recording_id)
    if local_file.is_file() and not local_file.is_symlink():
        local_file.unlink()
        await db.delete(row)
        await db.commit()
        return
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            upstream = await client.delete(f'{ENGINE_URL.rstrip("/")}/internal/videos/{recording_id}', headers=engine_internal_headers())
    except httpx.HTTPError:
        raise HTTPException(503, 'No se pudo eliminar el video; vuelve a intentar')
    if upstream.status_code not in (204, 404):
        raise HTTPException(503, 'No se pudo eliminar el video; vuelve a intentar')
    await db.delete(row)
    await db.commit()
