import asyncio

from fastapi import APIRouter, Path

from ...main_context import *
from .report_rendering import *
from .reports_shared import *
from .reports_shared import (
    SHARED_REPORT_TOKEN_PATH,
    REPORT_SLUG_PATH,
    REPORT_TYPE_PATH,
    _enforce_public_shared_report_rate_limit,
    _is_public_shared_report,
    _safe_public_thumbnail_svg,
    _shared_report_csv_response,
    _shared_report_html_response,
    _shared_report_markdown_response,
    _shared_report_pdf_response,
    _snapshot_report_type,
    _snapshot_url,
)

router = APIRouter(tags=["reports"])

@router.get("/s/reports/{token}.md", name="public_shared_report_markdown")
async def public_shared_report_markdown(request: Request, token: str = SHARED_REPORT_TOKEN_PATH, db: AsyncSession = Depends(get_db)):
    _enforce_public_shared_report_rate_limit(request, token)
    snapshot = await crud.get_shared_report_by_token(db, token)
    if not snapshot or not snapshot.activo or crud.shared_report_is_expired(snapshot):
        raise HTTPException(status_code=404, detail="Informe no disponible")
    if not _is_public_shared_report(snapshot):
        raise HTTPException(status_code=404, detail="Informe no disponible")
    content = _shared_report_markdown(snapshot, await crud.shared_report_has_new_values(db, snapshot))
    filename = f"{snapshot.token}.md"
    return _shared_report_markdown_response(content, filename)

@router.get("/informes/{solution}/{project}/{build}/{report_type}/{token}.md", name="pretty_public_shared_report_markdown")
async def pretty_public_shared_report_markdown(
    request: Request,
    solution: str = REPORT_SLUG_PATH,
    project: str = REPORT_SLUG_PATH,
    build: str = REPORT_SLUG_PATH,
    report_type: str = REPORT_TYPE_PATH,
    token: str = SHARED_REPORT_TOKEN_PATH,
    db: AsyncSession = Depends(get_db),
):
    return await public_shared_report_markdown(request=request, token=token, db=db)

@router.get("/s/reports/{token}.csv", name="public_shared_report_csv")
async def public_shared_report_csv(request: Request, token: str = SHARED_REPORT_TOKEN_PATH, db: AsyncSession = Depends(get_db)):
    _enforce_public_shared_report_rate_limit(request, token)
    snapshot = await crud.get_shared_report_by_token(db, token)
    if not snapshot or not snapshot.activo or crud.shared_report_is_expired(snapshot):
        raise HTTPException(status_code=404, detail="Informe no disponible")
    if not _is_public_shared_report(snapshot):
        raise HTTPException(status_code=404, detail="Informe no disponible")
    return _shared_report_csv_response(_shared_report_csv(snapshot), f"{snapshot.token}.csv")

@router.get("/informes/{solution}/{project}/{build}/{report_type}/{token}.csv", name="pretty_public_shared_report_csv")
async def pretty_public_shared_report_csv(
    request: Request,
    solution: str = REPORT_SLUG_PATH,
    project: str = REPORT_SLUG_PATH,
    build: str = REPORT_SLUG_PATH,
    report_type: str = REPORT_TYPE_PATH,
    token: str = SHARED_REPORT_TOKEN_PATH,
    db: AsyncSession = Depends(get_db),
):
    return await public_shared_report_csv(request=request, token=token, db=db)

@router.get("/s/reports/{token}.pdf", name="public_shared_report_pdf")
async def public_shared_report_pdf(request: Request, token: str = SHARED_REPORT_TOKEN_PATH, db: AsyncSession = Depends(get_db)):
    _enforce_public_shared_report_rate_limit(request, token)
    snapshot = await crud.get_shared_report_by_token(db, token)
    if not snapshot or not snapshot.activo or crud.shared_report_is_expired(snapshot):
        raise HTTPException(status_code=404, detail="Informe no disponible")
    if not _is_public_shared_report(snapshot):
        raise HTTPException(status_code=404, detail="Informe no disponible")
    has_new_values = await crud.shared_report_has_new_values(db, snapshot)
    latest = await crud.get_latest_equivalent_shared_report(db, snapshot) if has_new_values else None
    latest_url = _snapshot_url(latest, request) if latest else None
    return await _shared_report_pdf_response(snapshot, request, has_new_values, latest_url)

@router.get("/informes/{solution}/{project}/{build}/{report_type}/{token}.pdf", name="pretty_public_shared_report_pdf")
async def pretty_public_shared_report_pdf(
    request: Request,
    solution: str = REPORT_SLUG_PATH,
    project: str = REPORT_SLUG_PATH,
    build: str = REPORT_SLUG_PATH,
    report_type: str = REPORT_TYPE_PATH,
    token: str = SHARED_REPORT_TOKEN_PATH,
    db: AsyncSession = Depends(get_db),
):
    return await public_shared_report_pdf(request=request, token=token, db=db)

@router.get("/s/reports/{token}", response_class=HTMLResponse, name="public_shared_report")
async def public_shared_report_v2(request: Request, token: str = SHARED_REPORT_TOKEN_PATH, db: AsyncSession = Depends(get_db)):
    _enforce_public_shared_report_rate_limit(request, token)
    snapshot = await crud.get_shared_report_by_token(db, token)
    if not snapshot or not snapshot.activo or crud.shared_report_is_expired(snapshot):
        raise HTTPException(status_code=404, detail="Informe no disponible")
    if not _is_public_shared_report(snapshot):
        raise HTTPException(status_code=404, detail="Informe no disponible")
    has_new_values = await crud.shared_report_has_new_values(db, snapshot)
    latest = await crud.get_latest_equivalent_shared_report(db, snapshot) if has_new_values else None
    latest_url = _snapshot_url(latest, request) if latest else None
    return _shared_report_html_response(_shared_report_html(snapshot, request, has_new_values, latest_url))

@router.get("/informes/{solution}/{project}/{build}/{report_type}/{token}", response_class=HTMLResponse, name="pretty_public_shared_report")
async def pretty_public_shared_report(
    request: Request,
    solution: str = REPORT_SLUG_PATH,
    project: str = REPORT_SLUG_PATH,
    build: str = REPORT_SLUG_PATH,
    report_type: str = REPORT_TYPE_PATH,
    token: str = SHARED_REPORT_TOKEN_PATH,
    db: AsyncSession = Depends(get_db),
):
    return await public_shared_report_v2(request=request, token=token, db=db)

@router.get("/reports/internal/{token}.md", name="internal_shared_report_markdown")
async def internal_shared_report_markdown(
    token: str = SHARED_REPORT_TOKEN_PATH,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("reportes.ver", "read"))
):
    snapshot = await crud.get_shared_report_by_token(db, token)
    if not snapshot or not snapshot.activo or crud.shared_report_is_expired(snapshot):
        raise HTTPException(status_code=404, detail="Informe no disponible")
    await access_control.require_project_access(db, current_user, snapshot.proyecto_id, "read")
    if _snapshot_report_type(snapshot) != "internal":
        raise HTTPException(status_code=404, detail="Informe interno no encontrado")
    content = _shared_report_markdown(snapshot, await crud.shared_report_has_new_values(db, snapshot))
    filename = f"{snapshot.token}-interno.md"
    return _shared_report_markdown_response(content, filename)

@router.get("/informes-internos/{solution}/{project}/{build}/{token}.md", name="pretty_internal_shared_report_markdown")
async def pretty_internal_shared_report_markdown(
    solution: str = REPORT_SLUG_PATH,
    project: str = REPORT_SLUG_PATH,
    build: str = REPORT_SLUG_PATH,
    token: str = SHARED_REPORT_TOKEN_PATH,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("reportes.ver", "read"))
):
    return await internal_shared_report_markdown(token=token, db=db, current_user=current_user)

@router.get("/reports/internal/{token}.csv", name="internal_shared_report_csv")
async def internal_shared_report_csv(
    token: str = SHARED_REPORT_TOKEN_PATH,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("reportes.ver", "read"))
):
    snapshot = await crud.get_shared_report_by_token(db, token)
    if not snapshot or not snapshot.activo or crud.shared_report_is_expired(snapshot):
        raise HTTPException(status_code=404, detail="Informe no disponible")
    await access_control.require_project_access(db, current_user, snapshot.proyecto_id, "read")
    if _snapshot_report_type(snapshot) != "internal":
        raise HTTPException(status_code=404, detail="Informe interno no encontrado")
    return _shared_report_csv_response(_shared_report_csv(snapshot), f"{snapshot.token}-interno.csv")

@router.get("/informes-internos/{solution}/{project}/{build}/{token}.csv", name="pretty_internal_shared_report_csv")
async def pretty_internal_shared_report_csv(
    solution: str = REPORT_SLUG_PATH,
    project: str = REPORT_SLUG_PATH,
    build: str = REPORT_SLUG_PATH,
    token: str = SHARED_REPORT_TOKEN_PATH,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("reportes.ver", "read"))
):
    return await internal_shared_report_csv(token=token, db=db, current_user=current_user)

@router.get("/reports/internal/{token}.pdf", name="internal_shared_report_pdf")
async def internal_shared_report_pdf(
    request: Request,
    token: str = SHARED_REPORT_TOKEN_PATH,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("reportes.ver", "read"))
):
    snapshot = await crud.get_shared_report_by_token(db, token)
    if not snapshot or not snapshot.activo or crud.shared_report_is_expired(snapshot):
        raise HTTPException(status_code=404, detail="Informe no disponible")
    await access_control.require_project_access(db, current_user, snapshot.proyecto_id, "read")
    if _snapshot_report_type(snapshot) != "internal":
        raise HTTPException(status_code=404, detail="Informe interno no encontrado")
    has_new_values = await crud.shared_report_has_new_values(db, snapshot)
    latest = await crud.get_latest_equivalent_shared_report(db, snapshot) if has_new_values else None
    latest_url = _snapshot_url(latest, request) if latest else None
    return await _shared_report_pdf_response(snapshot, request, has_new_values, latest_url)

@router.get("/informes-internos/{solution}/{project}/{build}/{token}.pdf", name="pretty_internal_shared_report_pdf")
async def pretty_internal_shared_report_pdf(
    request: Request,
    solution: str = REPORT_SLUG_PATH,
    project: str = REPORT_SLUG_PATH,
    build: str = REPORT_SLUG_PATH,
    token: str = SHARED_REPORT_TOKEN_PATH,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("reportes.ver", "read"))
):
    return await internal_shared_report_pdf(request=request, token=token, db=db, current_user=current_user)

@router.get("/reports/internal/{token}", response_class=HTMLResponse, name="internal_shared_report")
async def internal_shared_report(
    request: Request,
    token: str = SHARED_REPORT_TOKEN_PATH,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("reportes.ver", "read"))
):
    snapshot = await crud.get_shared_report_by_token(db, token)
    if not snapshot or not snapshot.activo or crud.shared_report_is_expired(snapshot):
        raise HTTPException(status_code=404, detail="Informe no disponible")
    await access_control.require_project_access(db, current_user, snapshot.proyecto_id, "read")
    if _snapshot_report_type(snapshot) != "internal":
        raise HTTPException(status_code=404, detail="Informe interno no encontrado")
    has_new_values = await crud.shared_report_has_new_values(db, snapshot)
    latest = await crud.get_latest_equivalent_shared_report(db, snapshot) if has_new_values else None
    latest_url = _snapshot_url(latest, request) if latest else None
    return _shared_report_html_response(_shared_report_html(snapshot, request, has_new_values, latest_url))

@router.get("/informes-internos/{solution}/{project}/{build}/{token}", response_class=HTMLResponse, name="pretty_internal_shared_report")
async def pretty_internal_shared_report(
    request: Request,
    solution: str = REPORT_SLUG_PATH,
    project: str = REPORT_SLUG_PATH,
    build: str = REPORT_SLUG_PATH,
    token: str = SHARED_REPORT_TOKEN_PATH,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("reportes.ver", "read"))
):
    return await internal_shared_report(request=request, token=token, db=db, current_user=current_user)

@router.get("/s/reports/{token}", response_class=HTMLResponse, name="public_shared_report_legacy")
async def public_shared_report(request: Request, token: str = SHARED_REPORT_TOKEN_PATH, db: AsyncSession = Depends(get_db)):
    _enforce_public_shared_report_rate_limit(request, token)
    snapshot = await crud.get_shared_report_by_token(db, token)
    if not snapshot or not snapshot.activo or crud.shared_report_is_expired(snapshot):
        raise HTTPException(status_code=404, detail="Informe no disponible")
    if not _is_public_shared_report(snapshot):
        raise HTTPException(status_code=404, detail="Informe no disponible")
    has_new_values = await crud.shared_report_has_new_values(db, snapshot)
    payload = snapshot.payload or {}
    meta = payload.get("metadata") or {}
    metrics = payload.get("metrics") or {}
    stats = metrics.get("stats") or {}
    title = html.escape(snapshot.title)
    description = html.escape(snapshot.description or "")
    image_url = str(request.url_for("public_shared_report_thumbnail", token=token))
    banner = (
        "<div class='banner'>Hay nuevos resultados disponibles desde que se compartio este informe.</div>"
        if has_new_values else ""
    )
    body = f"""<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{title}</title>
  <meta name="description" content="{description}" />
  <meta property="og:title" content="{title}" />
  <meta property="og:description" content="{description}" />
  <meta property="og:image" content="{html.escape(image_url)}" />
  <meta property="og:type" content="article" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="{title}" />
  <meta name="twitter:description" content="{description}" />
  <meta name="twitter:image" content="{html.escape(image_url)}" />
  <style>
    body {{ margin: 0; font-family: Arial, sans-serif; background: #f8fafc; color: #0f172a; }}
    main {{ max-width: 980px; margin: 40px auto; padding: 0 20px; }}
    .card {{ background: white; border: 1px solid #e2e8f0; border-radius: 14px; padding: 28px; box-shadow: 0 10px 35px rgba(15,23,42,.08); }}
    .banner {{ background: #fff7ed; border: 1px solid #fed7aa; color: #9a3412; padding: 12px 16px; border-radius: 10px; margin-bottom: 18px; font-weight: 700; }}
    .grid {{ display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-top: 24px; }}
    .metric {{ border-radius: 12px; padding: 20px; }}
    .ok {{ background: #dcfce7; color: #166534; }}
    .fail {{ background: #fee2e2; color: #991b1b; }}
    .blocked {{ background: #dbeafe; color: #1e3a8a; }}
    .value {{ font-size: 42px; font-weight: 800; display: block; }}
    .label {{ font-size: 13px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }}
    .meta {{ color: #64748b; line-height: 1.7; }}
  </style>
</head>
<body>
  <main>
    {banner}
    <section class="card">
      <h1>{title}</h1>
      <p class="meta">
        Organizacion: {html.escape(str(meta.get("organizacion") or "N/D"))}<br/>
        Componente: {html.escape(str(meta.get("componente") or "N/D"))}<br/>
        Plataforma: {html.escape(str(meta.get("plataforma") or "N/D"))}<br/>
        Fecha snapshot: {html.escape(str(meta.get("snapshot_at") or snapshot.created_at))}
      </p>
      <div class="grid">
        <div class="metric ok"><span class="label">Pasadas</span><span class="value">{stats.get("pasados", 0)}</span></div>
        <div class="metric fail"><span class="label">Fallidas</span><span class="value">{stats.get("fallados", 0)}</span></div>
        <div class="metric blocked"><span class="label">Bloqueadas</span><span class="value">{stats.get("bloqueados", 0)}</span></div>
      </div>
      <p class="meta">Cobertura: {metrics.get("cobertura_porcentaje", 0)}% · Ejecutadas: {metrics.get("total_ejecutados", 0)} / {metrics.get("total_casos_asignados", 0)}</p>
    </section>
  </main>
</body>
</html>"""
    return _shared_report_html_response(body)

@router.get("/s/reports/{token}/thumbnail.svg", name="public_shared_report_thumbnail")
async def public_shared_report_thumbnail(request: Request, token: str = SHARED_REPORT_TOKEN_PATH, db: AsyncSession = Depends(get_db)):
    _enforce_public_shared_report_rate_limit(request, token)
    snapshot = await crud.get_shared_report_by_token(db, token)
    if not snapshot or not snapshot.activo or crud.shared_report_is_expired(snapshot):
        raise HTTPException(status_code=404, detail="Miniatura no disponible")
    if not _is_public_shared_report(snapshot):
        raise HTTPException(status_code=404, detail="Miniatura no disponible")
    return Response(
        content=_safe_public_thumbnail_svg(snapshot.thumbnail_svg),
        media_type="image/svg+xml",
        headers={
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'; img-src 'none'; style-src 'unsafe-inline'",
        },
    )

@router.get("/informes/{solution}/{project}/{build}/{report_type}/{token}/preview.svg", name="pretty_public_shared_report_thumbnail")
async def pretty_public_shared_report_thumbnail(
    request: Request,
    solution: str = REPORT_SLUG_PATH,
    project: str = REPORT_SLUG_PATH,
    build: str = REPORT_SLUG_PATH,
    report_type: str = REPORT_TYPE_PATH,
    token: str = SHARED_REPORT_TOKEN_PATH,
    db: AsyncSession = Depends(get_db),
):
    return await public_shared_report_thumbnail(request=request, token=token, db=db)
