from .repository_context import *

def _safe_iso(value): return value.isoformat() if value else None
def _seconds_to_hours(seconds): return round(float(seconds or 0) / 3600, 2)
def _safe_percent(numerator, denominator): return round((numerator / denominator) * 100, 2) if denominator else 0.0
def _risk_level(*, coverage, failed, blocked, pending, high_open_bugs, bugs_without_evidence=0):
    if blocked > 0 or high_open_bugs > 0 or coverage < 70: return "ALTO"
    if failed > 0 or pending > 0 or coverage < 90 or bugs_without_evidence > 0: return "MEDIO"
    return "BAJO"

def build_suite_tree(context):
    suites_by_id = context["suites_by_id"]
    por_suite = context["por_suite"]
    suite_breadcrumb = context["suite_breadcrumb"]
    open_bug_items = context["open_bug_items"]
    def empty_suite_node(suite_id: str):
        suite = suites_by_id.get(suite_id)
        entry = por_suite.get(suite_id, {})
        return {
            "id": suite_id,
            "nombre": entry.get("nombre") or (suite.nombre if suite else "Sin Suite"),
            "parent_id": entry.get("parent_id") or (str(suite.parent_id) if suite and suite.parent_id else None),
            "breadcrumb": entry.get("breadcrumb") or suite_breadcrumb(suite_id),
            "total": entry.get("total", 0),
            "pasados": entry.get("pasados", 0),
            "fallados": entry.get("fallados", 0),
            "bloqueados": entry.get("bloqueados", 0),
            "pendientes": entry.get("pendientes", 0),
            "duracion_segundos": entry.get("duracion_segundos", 0),
            "ultima_ejecucion": entry.get("ultima_ejecucion"),
            "casos": entry.get("casos", []),
            "children": [],
        }

    required_suite_ids = set(por_suite.keys())
    for suite_id in list(required_suite_ids):
        current = suites_by_id.get(suite_id)
        while current and current.parent_id:
            parent_id = str(current.parent_id)
            required_suite_ids.add(parent_id)
            current = suites_by_id.get(parent_id)

    suite_nodes = {suite_id: empty_suite_node(suite_id) for suite_id in required_suite_ids}
    root_nodes = []
    for suite_id, node in suite_nodes.items():
        parent_id = node.get("parent_id")
        if parent_id and parent_id in suite_nodes:
            suite_nodes[parent_id]["children"].append(node)
        else:
            root_nodes.append(node)

    def aggregate_suite_node(node):
        for child in node["children"]:
            aggregate_suite_node(child)
            node["total"] += child["total"]
            node["pasados"] += child["pasados"]
            node["fallados"] += child["fallados"]
            node["bloqueados"] += child["bloqueados"]
            node["pendientes"] += child["pendientes"]
            node["duracion_segundos"] = int(node.get("duracion_segundos") or 0) + int(child.get("duracion_segundos") or 0)
            child_last = child.get("ultima_ejecucion")
            node_last = node.get("ultima_ejecucion")
            if child_last and (not node_last or child_last > node_last):
                node["ultima_ejecucion"] = child_last
        node["children"].sort(key=lambda item: (item["breadcrumb"], item["nombre"]))

    for node in root_nodes:
        aggregate_suite_node(node)
    root_nodes.sort(key=lambda item: (item["breadcrumb"], item["nombre"]))

    suite_open_bug_counts: Dict[str, int] = {}
    suite_high_open_bug_counts: Dict[str, int] = {}
    for bug in open_bug_items:
        suite_name = bug.get("suite") or "Sin Suite"
        suite_open_bug_counts[suite_name] = suite_open_bug_counts.get(suite_name, 0) + 1
        if str(bug.get("severidad") or "").upper() in {"CRITICA", "ALTA"}:
            suite_high_open_bug_counts[suite_name] = suite_high_open_bug_counts.get(suite_name, 0) + 1

    def enrich_suite_node(node):
        executed = int(node.get("pasados") or 0) + int(node.get("fallados") or 0) + int(node.get("bloqueados") or 0)
        total = int(node.get("total") or 0)
        breadcrumb = node.get("breadcrumb") or node.get("nombre") or "Sin Suite"
        last_execution = node.get("ultima_ejecucion")
        node["ejecutados"] = executed
        node["cobertura_porcentaje"] = _safe_percent(executed, total)
        node["exito_sobre_ejecutados_porcentaje"] = _safe_percent(int(node.get("pasados") or 0), executed)
        node["exito_sobre_total_porcentaje"] = _safe_percent(int(node.get("pasados") or 0), total)
        node["bugs_abiertos"] = suite_open_bug_counts.get(breadcrumb, 0)
        node["riesgo"] = _risk_level(
            coverage=node["cobertura_porcentaje"],
            failed=int(node.get("fallados") or 0),
            blocked=int(node.get("bloqueados") or 0),
            pending=int(node.get("pendientes") or 0),
            high_open_bugs=suite_high_open_bug_counts.get(breadcrumb, 0),
        )
        node["ultima_ejecucion"] = _safe_iso(last_execution) if hasattr(last_execution, "isoformat") else last_execution
        node["duracion_horas"] = _seconds_to_hours(int(node.get("duracion_segundos") or 0))
        for child in node.get("children") or []:
            enrich_suite_node(child)

    for node in root_nodes:
        enrich_suite_node(node)

    for suite in por_suite.values():
        last_execution = suite.get("ultima_ejecucion")
        executed = int(suite.get("pasados") or 0) + int(suite.get("fallados") or 0) + int(suite.get("bloqueados") or 0)
        total = int(suite.get("total") or 0)
        suite["ejecutados"] = executed
        suite["cobertura_porcentaje"] = _safe_percent(executed, total)
        suite["exito_sobre_ejecutados_porcentaje"] = _safe_percent(int(suite.get("pasados") or 0), executed)
        suite["exito_sobre_total_porcentaje"] = _safe_percent(int(suite.get("pasados") or 0), total)
        suite["bugs_abiertos"] = suite_open_bug_counts.get(suite.get("breadcrumb") or suite.get("nombre") or "Sin Suite", 0)
        suite["riesgo"] = _risk_level(
            coverage=suite["cobertura_porcentaje"],
            failed=int(suite.get("fallados") or 0),
            blocked=int(suite.get("bloqueados") or 0),
            pending=int(suite.get("pendientes") or 0),
            high_open_bugs=suite_high_open_bug_counts.get(suite.get("breadcrumb") or suite.get("nombre") or "Sin Suite", 0),
        )
        suite["ultima_ejecucion"] = _safe_iso(last_execution) if hasattr(last_execution, "isoformat") else last_execution
        suite["duracion_horas"] = _seconds_to_hours(int(suite.get("duracion_segundos") or 0))

    return {"root_nodes": root_nodes, "por_suite": por_suite}
