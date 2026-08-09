from .repository_context import *
from sqlalchemy import case
from .bug_version_metrics import bug_history_version_fields
from .repository_metrics_attachment_helpers import _visible_case_filter

def _safe_percent(numerator, denominator): return round((numerator / denominator) * 100, 2) if denominator else 0.0

async def build_project_history(context):
    db = context["db"]
    proyecto_id = context["proyecto_id"]
    build = context["build"]
    project_bug_history = context["project_bug_history"]
    stats = context["stats"]
    cobertura = context["cobertura"]
    total_ejecutados = context["total_ejecutados"]
    qa_status = context["qa_status"]
    bug_metrics = context["bug_metrics"]
    result_historico = await db.execute(
        select(models.Build).filter(
            models.Build.proyecto_id == proyecto_id,
            models.Build.componente_id == build.componente_id
        ).order_by(
            # La build seleccionada siempre debe ser la referencia actual.
            # Algunas builds creadas/importadas no tienen fecha_inicio y
            # quedarían detrás de una build histórica aunque sean más nuevas.
            case((models.Build.id == build.id, 0), else_=1),
            models.Build.fecha_inicio.desc().nullslast(),
            models.Build.fecha_creacion.desc(),
            models.Build.id.desc(),
        ).limit(10)
    )
    builds_historico = result_historico.scalars().all()

    historico = []
    for b in builds_historico:
        result_bc = await db.execute(
            select(models.BuildCaso).filter(models.BuildCaso.build_id == b.id)
        )
        b_caso_ids = [bc.caso_id for bc in result_bc.scalars().all()]

        if not b_caso_ids:
            historico.append({
                "build_id": str(b.id),
                "build_name": b.nombre,
                "total_asignados": 0,
                "ejecutados": 0,
                "cobertura_porcentaje": 0.0,
                "exito_sobre_ejecutados_porcentaje": 0.0,
                "pasados": 0,
                "fallados": 0,
                "bloqueados": 0,
                "fecha": b.fecha_creacion.isoformat() if b.fecha_creacion else None
            })
            continue

        result_b_casos_info = await db.execute(
            select(models.CasoPrueba.id, models.CasoPrueba.master_id).filter(
                models.CasoPrueba.id.in_(b_caso_ids),
                *_visible_case_filter(),
            )
        )
        b_assigned_master_ids = {
            master_id
            for _, master_id in result_b_casos_info.all()
        }
        if not b_assigned_master_ids:
            historico.append({
                "build_id": str(b.id),
                "build_name": b.nombre,
                "total_asignados": 0,
                "ejecutados": 0,
                "cobertura_porcentaje": 0.0,
                "exito_sobre_ejecutados_porcentaje": 0.0,
                "pasados": 0,
                "fallados": 0,
                "bloqueados": 0,
                "fecha": b.fecha_creacion.isoformat() if b.fecha_creacion else None
            })
            continue

        result_b_versions = await db.execute(
            select(models.CasoPrueba.id, models.CasoPrueba.master_id).filter(
                models.CasoPrueba.master_id.in_(b_assigned_master_ids),
                *_visible_case_filter(),
            )
        )
        b_master_by_version_id = {
            case_id: master_id
            for case_id, master_id in result_b_versions.all()
        }
        b_version_case_ids = list(b_master_by_version_id.keys())

        result_ejec = await db.execute(
            select(models.EjecucionCaso).join(models.TestRun).filter(
                models.TestRun.build_id == b.id,
                models.EjecucionCaso.caso_id.in_(b_version_case_ids),
                models.EjecucionCaso.estado_resultado != models.EstadoResultado.SIN_CORRER,
            )
        )
        b_ejecuciones = result_ejec.scalars().all()

        b_stats = {"pasados": 0, "fallados": 0, "bloqueados": 0}
        b_caso_estado = {}
        for e in b_ejecuciones:
            master_id = b_master_by_version_id.get(e.caso_id)
            if not master_id:
                continue
            est = e.estado_resultado.value if hasattr(e.estado_resultado, 'value') else e.estado_resultado
            if master_id not in b_caso_estado or e.fecha_ejecucion > b_caso_estado[master_id]['fecha']:
                b_caso_estado[master_id] = {'estado': est, 'fecha': e.fecha_ejecucion}

        for info in b_caso_estado.values():
            if info['estado'] == "PASO":
                b_stats["pasados"] += 1
            elif info['estado'] == "FALLO":
                b_stats["fallados"] += 1
            elif info['estado'] == "BLOQUEADO":
                b_stats["bloqueados"] += 1

        historico.append({
            "build_id": str(b.id),
            "build_name": b.nombre,
            "total_asignados": len(b_assigned_master_ids),
            "ejecutados": len(b_caso_estado),
            "cobertura_porcentaje": _safe_percent(len(b_caso_estado), len(b_assigned_master_ids)),
            "exito_sobre_ejecutados_porcentaje": _safe_percent(b_stats["pasados"], len(b_caso_estado)),
            "pasados": b_stats["pasados"],
            "fallados": b_stats["fallados"],
            "bloqueados": b_stats["bloqueados"],
            **bug_history_version_fields(project_bug_history, b.id),
            "fecha": b.fecha_creacion.isoformat() if b.fecha_creacion else None
        })

    current_history_index = next(
        (idx for idx, item in enumerate(historico) if item.get("build_id") == str(build.id)),
        None,
    )
    previous_history = (
        historico[current_history_index + 1]
        if current_history_index is not None and len(historico) > current_history_index + 1
        else None
    )
    comparison = {}
    if previous_history:
        comparison = {
            "previous_build_id": previous_history.get("build_id"),
            "previous_build_name": previous_history.get("build_name"),
            "coverage_delta": round(cobertura - float(previous_history.get("cobertura_porcentaje") or 0), 2),
            "failed_delta": int(stats.get("fallados") or 0) - int(previous_history.get("fallados") or 0),
            "blocked_delta": int(stats.get("bloqueados") or 0) - int(previous_history.get("bloqueados") or 0),
            "passed_delta": int(stats.get("pasados") or 0) - int(previous_history.get("pasados") or 0),
            "success_executed_delta": round(
                _safe_percent(int(stats.get("pasados") or 0), total_ejecutados)
                - float(previous_history.get("exito_sobre_ejecutados_porcentaje") or 0),
                2,
            ),
            "execution_time_delta_hours": None,
            "qa_status_previous": None,
            "qa_status_current": qa_status.get("label"),
            "open_bugs_current": int(bug_metrics.get("open") or 0),
            "recurrent_bugs_current": int(bug_metrics.get("recurrent") or 0),
        }
    return {"historico": historico, "comparison": comparison}
