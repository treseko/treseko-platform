from .repository_context import *


def _risk_level(*, coverage, failed, blocked, pending, high_open_bugs, bugs_without_evidence=0):
    if blocked > 0 or high_open_bugs > 0 or coverage < 70:
        return "ALTO"
    if failed > 0 or pending > 0 or coverage < 90 or bugs_without_evidence > 0:
        return "MEDIO"
    return "BAJO"


def _qa_decision(risk: str, stats: Dict[str, Any], coverage: float, bug_metrics: Dict[str, Any]) -> Dict[str, Any]:
    failed = int(stats.get("fallados") or 0)
    blocked = int(stats.get("bloqueados") or 0)
    pending = int(stats.get("pendientes") or 0)
    open_bugs = int(bug_metrics.get("open") or 0)
    high_open = int(bug_metrics.get("high_open") or 0)
    reasons = []
    if coverage < 70:
        reasons.append("cobertura menor al 70%")
    elif coverage < 90:
        reasons.append("cobertura menor al 90%")
    if failed:
        reasons.append(f"{failed} casos fallidos")
    if blocked:
        reasons.append(f"{blocked} casos bloqueados")
    if high_open:
        reasons.append(f"{high_open} bugs abiertos de severidad alta/critica")
    elif open_bugs:
        reasons.append(f"{open_bugs} bugs abiertos")
    if pending:
        reasons.append(f"{pending} casos sin ejecutar")

    if blocked or high_open or coverage < 70:
        state, label = "NO_RECOMENDADO", "No recomendado"
    elif failed or open_bugs or pending or coverage < 90:
        state, label = "RECOMENDADO_CON_OBSERVACIONES", "Recomendado con observaciones"
    elif int(stats.get("pasados") or 0) == 0:
        state, label = "EN_EVALUACION", "En evaluacion"
    else:
        state, label = "APROBADO", "Aprobado"
    if blocked:
        state, label = "BLOQUEADO", "Bloqueado"
    return {
        "state": state,
        "label": label,
        "risk": risk,
        "reasons": reasons or ["Sin riesgos relevantes detectados con los datos actuales"],
        "recommend_release": state == "APROBADO",
    }
