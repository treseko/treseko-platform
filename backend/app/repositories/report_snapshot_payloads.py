from .repository_context import *
from .report_fingerprints import REPORT_BUNDLE_TYPES
import html

def _shared_report_thumbnail_svg(payload: Dict[str, Any]) -> str:
    meta = payload.get("metadata") or {}
    metrics = payload.get("metrics") or {}
    stats = metrics.get("stats") or {}
    proyecto = html.escape(str(meta.get("proyecto") or "Proyecto QA")[:48], quote=False)
    build = html.escape(str(meta.get("build") or "Build activa")[:40], quote=False)
    pasados = int(stats.get("pasados") or 0)
    fallados = int(stats.get("fallados") or 0)
    bloqueados = int(stats.get("bloqueados") or 0)
    cobertura = metrics.get("cobertura_porcentaje") or 0
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#0f172a"/>
  <rect x="48" y="48" width="1104" height="534" rx="28" fill="#ffffff"/>
  <text x="92" y="125" font-family="Arial, sans-serif" font-size="42" font-weight="700" fill="#0f172a">{proyecto}</text>
  <text x="92" y="175" font-family="Arial, sans-serif" font-size="26" fill="#475569">{build}</text>
  <text x="92" y="260" font-family="Arial, sans-serif" font-size="28" font-weight="700" fill="#334155">Snapshot de calidad</text>
  <rect x="92" y="315" width="280" height="140" rx="18" fill="#dcfce7"/>
  <text x="122" y="370" font-family="Arial, sans-serif" font-size="24" font-weight="700" fill="#166534">PASADAS</text>
  <text x="122" y="430" font-family="Arial, sans-serif" font-size="56" font-weight="800" fill="#15803d">{pasados}</text>
  <rect x="420" y="315" width="280" height="140" rx="18" fill="#fee2e2"/>
  <text x="450" y="370" font-family="Arial, sans-serif" font-size="24" font-weight="700" fill="#991b1b">FALLIDAS</text>
  <text x="450" y="430" font-family="Arial, sans-serif" font-size="56" font-weight="800" fill="#dc2626">{fallados}</text>
  <rect x="748" y="315" width="280" height="140" rx="18" fill="#dbeafe"/>
  <text x="778" y="370" font-family="Arial, sans-serif" font-size="24" font-weight="700" fill="#1e3a8a">BLOQUEADAS</text>
  <text x="778" y="430" font-family="Arial, sans-serif" font-size="56" font-weight="800" fill="#2563eb">{bloqueados}</text>
  <text x="92" y="535" font-family="Arial, sans-serif" font-size="24" fill="#475569">Cobertura: {cobertura}%</text>
</svg>"""

def _shared_report_metadata(snapshot: models.SharedReportSnapshot) -> Dict[str, Any]:
    payload = snapshot.payload or {}
    metadata = payload.get("metadata") or {}
    return metadata if isinstance(metadata, dict) else {}

def _shared_report_group_id(snapshot: models.SharedReportSnapshot) -> str:
    metadata = _shared_report_metadata(snapshot)
    return str(metadata.get("snapshot_group_id") or f"legacy:{snapshot.id}")

def _shared_report_type(snapshot: models.SharedReportSnapshot) -> str:
    metadata = _shared_report_metadata(snapshot)
    report_type = str(metadata.get("report_type") or "executive").lower()
    return report_type if report_type in set(REPORT_BUNDLE_TYPES) else "executive"

def _derive_report_payload(base_payload: Dict[str, Any], report_type: str) -> Dict[str, Any]:
    derived = json.loads(json.dumps(base_payload, sort_keys=True, default=str, ensure_ascii=False))
    metadata = derived.setdefault("metadata", {})
    metadata["report_type"] = report_type
    if report_type == "executive":
        derived["development"] = {}
        derived["internal"] = {}
    elif report_type == "development":
        derived["internal"] = {}
    else:
        derived["internal"] = {
            "cases": _flatten_report_suite_cases(derived.get("metrics", {}).get("por_suite_tree") or []),
            "notes": "Vista interna autenticada con detalle operativo del snapshot.",
        }
    return derived

def _flatten_report_suite_cases(nodes: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    cases: List[Dict[str, Any]] = []
    stack = list(nodes or [])
    while stack:
        current = stack.pop()
        cases.extend(current.get("casos") or [])
        stack.extend(current.get("children") or [])
    return cases

async def _find_active_shared_report_bundle(
    db: AsyncSession,
    proyecto_id: UUID,
    build_id: Optional[UUID],
    componente_id: Optional[UUID],
    metrics_hash: str,
    manual_definition: Optional[Dict[str, Any]] = None,
) -> Optional[List[models.SharedReportSnapshot]]:
    query = (
        select(models.SharedReportSnapshot)
        .filter(models.SharedReportSnapshot.proyecto_id == proyecto_id)
        .filter(models.SharedReportSnapshot.build_id == build_id)
        .filter(models.SharedReportSnapshot.componente_id == componente_id)
        .filter(models.SharedReportSnapshot.metrics_hash == metrics_hash)
        .filter(models.SharedReportSnapshot.activo == True)  # noqa: E712
        .order_by(models.SharedReportSnapshot.created_at.desc())
    )
    result = await db.execute(query)
    snapshots = result.scalars().all()
    groups: Dict[str, List[models.SharedReportSnapshot]] = {}
    for snapshot in snapshots:
        group_id = _shared_report_group_id(snapshot)
        if group_id.startswith("legacy:"):
            continue
        groups.setdefault(group_id, []).append(snapshot)
    for group_snapshots in groups.values():
        report_types = {_shared_report_type(snapshot) for snapshot in group_snapshots}
        if not set(REPORT_BUNDLE_TYPES).issubset(report_types):
            continue
        if manual_definition:
            first_payload = group_snapshots[0].payload or {}
            first_manual = first_payload.get("manual_definition") or (first_payload.get("metadata") or {})
            same_definition = (
                str(first_manual.get("build_definition") or "") == str(manual_definition.get("build_definition") or "")
                and str(first_manual.get("qa_comment") or "") == str(manual_definition.get("qa_comment") or "")
                and str(first_manual.get("requested_report_type") or "") == str(manual_definition.get("requested_report_type") or "")
            )
            if not same_definition:
                continue
        return sorted(group_snapshots, key=lambda item: item.created_at)
    return None
