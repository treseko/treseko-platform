"""MCP case mutation handlers, including project traceability links."""
from sqlalchemy import delete, select
from .. import access_control, crud, models, schemas
from ..repositories import cases_datasets, suites_cases
from .mcp_mutation_support import (
    SUPPORTED_FORMATS, _assert_supported, _confirm, _serialize_case, _uuid,
    _validate_case_automation, _value,
)


async def create_case(db, user, project, arguments):
    _confirm(arguments, "CREATE_CASE")
    fmt = str(arguments.get("format", "CLASICA")).upper()
    if fmt not in SUPPORTED_FORMATS:
        raise ValueError("MCP solo admite casos CLASICA o API")
    steps = [schemas.PasoCreate(numero_paso=item.get("number", index), accion=item.get("action", ""), datos=item.get("data"), resultado_esperado=item.get("expected_result", ""))
             for index, item in enumerate(arguments.get("steps", []), start=1)]
    component_id = _uuid(arguments["component_id"], "component_id") if arguments.get("component_id") else None
    suite_id = _uuid(arguments["suite_id"], "suite_id") if arguments.get("suite_id") else None
    build_id = _uuid(arguments["build_id"], "build_id") if arguments.get("build_id") else None
    if component_id:
        component = await db.scalar(select(models.Componente).where(models.Componente.id == component_id, models.Componente.proyecto_id == project.id))
        if not component:
            raise ValueError("El componente no pertenece al proyecto")
    if suite_id:
        suite = await db.scalar(select(models.Suite).where(models.Suite.id == suite_id, models.Suite.proyecto_id == project.id, models.Suite.archivado == False))
        if not suite:
            raise ValueError("La suite no pertenece al proyecto o está archivada")
        if component_id and suite.componente_id not in {None, component_id}:
            raise ValueError("La suite no pertenece al componente seleccionado")
        component_id = component_id or suite.componente_id
    if build_id:
        build = await db.scalar(select(models.Build).where(models.Build.id == build_id, models.Build.proyecto_id == project.id))
        if not build or not access_control.is_build_active(build):
            raise ValueError("La build no pertenece al proyecto o está inactiva")
        if not build.componente_id:
            raise ValueError("La build no tiene un componente asociado")
        if component_id and build.componente_id != component_id:
            raise ValueError("La build pertenece a otro componente")
        component_id = component_id or build.componente_id
    test_type = str(arguments.get("test_type", "MANUAL")).upper()
    automation_script = arguments.get("automation_script")
    automation_framework = arguments.get("automation_framework")
    _validate_case_automation(fmt, test_type, automation_script, automation_framework,
                              arguments.get("api_configuration", {}))
    story_ids = [_uuid(value, "story_id") for value in arguments.get("story_ids", [])]
    criterion_ids = [_uuid(value, "acceptance_criterion_id") for value in arguments.get("acceptance_criteria_ids", [])]
    if len(set(story_ids)) != len(story_ids) or len(set(criterion_ids)) != len(criterion_ids):
        raise ValueError("No repitas historias ni criterios de aceptación")
    stories = (await db.execute(select(models.HistoriaUsuario).where(
        models.HistoriaUsuario.id.in_(story_ids), models.HistoriaUsuario.proyecto_id == project.id,
        models.HistoriaUsuario.archivado == False,
    ))).scalars().all() if story_ids else []
    if len(stories) != len(story_ids):
        raise ValueError("Una historia no pertenece al proyecto o está archivada")
    criteria = (await db.execute(select(models.AcceptanceCriterion).join(
        models.HistoriaUsuario, models.HistoriaUsuario.id == models.AcceptanceCriterion.historia_id,
    ).where(models.AcceptanceCriterion.id.in_(criterion_ids),
            models.HistoriaUsuario.proyecto_id == project.id,
            models.HistoriaUsuario.archivado == False,
            models.AcceptanceCriterion.activo == True))).scalars().all() if criterion_ids else []
    if len(criteria) != len(criterion_ids):
        raise ValueError("Un criterio no pertenece a una historia activa del proyecto")
    story_by_id = {item.id: item for item in stories}
    linked_story_ids = set(story_ids)
    for criterion in criteria:
        if linked_story_ids and criterion.historia_id not in linked_story_ids:
            raise ValueError("Los criterios deben pertenecer a las historias seleccionadas")
        linked_story_ids.add(criterion.historia_id)
        if criterion.historia_id not in story_by_id:
            story = await db.get(models.HistoriaUsuario, criterion.historia_id)
            if story:
                story_by_id[story.id] = story
    payload = schemas.CasoPruebaCreate(proyecto_id=project.id, titulo=arguments["title"], descripcion=arguments.get("description", ""), prioridad=arguments.get("priority", "MEDIA"), criticidad=arguments.get("criticality", "MEDIA"), formato_prueba=fmt, tipo_prueba=test_type, dataset=arguments.get("dataset", []), configuracion_api=arguments.get("api_configuration", {}), pasos=steps, creado_por=user.id, componente_id=component_id, suite_id=suite_id, script_automatizado=automation_script, framework=automation_framework)
    case = await suites_cases.create_caso_prueba(db, payload, commit=False)
    if build_id:
        db.add(models.BuildCaso(build_id=build_id, caso_id=case.id))
        await db.flush()
    for story_id in sorted(linked_story_ids, key=str):
        story = story_by_id[story_id]
        db.add(models.CasoHistoria(caso_master_id=case.master_id, historia_id=story_id,
                                  creado_por=user.id, historia_actualizada_en_vinculo=story.ultima_actualizacion))
    for criterion in criteria:
        db.add(models.AcceptanceCriterionCase(acceptance_criterion_id=criterion.id,
                                               caso_master_id=case.master_id, creado_por=user.id))
    if linked_story_ids or criterion_ids:
        await db.flush()
    result = _serialize_case(case)
    result.update({"component_id": str(case.componente_id) if case.componente_id else None, "suite_id": str(case.suite_id) if case.suite_id else None, "build_ids": [str(build_id)] if build_id else [], "story_ids": [str(value) for value in sorted(linked_story_ids, key=str)], "acceptance_criteria_ids": [str(value) for value in criterion_ids]})
    return result

async def update_case(db, user, project, arguments):
    _confirm(arguments, "UPDATE_CASE")
    case = await db.scalar(select(models.CasoPrueba).where(models.CasoPrueba.id == _uuid(arguments["case_id"], "case_id"), models.CasoPrueba.proyecto_id == project.id))
    if not case:
        raise LookupError("case not found")
    _assert_supported(case)
    from ..repositories.case_mutation_policy import current_case_for_write
    latest = await current_case_for_write(db, case.master_id)
    if not latest or str(latest.id) != str(case.id):
        raise ValueError("La versión del caso cambió; lee el caso vigente antes de actualizar")
    fmt = str(arguments.get("format", _value(case.formato_prueba))).upper()
    test_type = str(arguments.get("test_type", _value(case.tipo_prueba))).upper()
    automation_script = arguments.get("automation_script", getattr(case, "script_automatizado", None))
    automation_framework = arguments.get("automation_framework", getattr(case, "framework", None))
    _validate_case_automation(fmt, test_type, automation_script, automation_framework,
                              arguments.get("api_configuration", case.configuracion_api or {}))
    data = {"titulo": arguments.get("title", case.titulo), "descripcion": arguments.get("description", case.descripcion), "prioridad": arguments.get("priority", _value(case.prioridad)), "criticidad": arguments.get("criticality", _value(case.criticidad)), "formato_prueba": fmt, "tipo_prueba": test_type, "dataset": arguments.get("dataset", case.dataset or []), "configuracion_api": arguments.get("api_configuration", case.configuracion_api or {}), "suite_id": arguments.get("suite_id", case.suite_id), "componente_id": arguments.get("component_id", case.componente_id)}
    for key in ("precondiciones", "postcondiciones", "etiquetas", "estado_caso"):
        if hasattr(case, key):
            data[key] = getattr(case, key)
    if hasattr(case, "script_automatizado"):
        data["script_automatizado"] = automation_script
    if hasattr(case, "framework"):
        data["framework"] = automation_framework
    data["creado_por"] = user.id
    data["proyecto_id"] = project.id
    if "steps" in arguments:
        data["pasos"] = [schemas.PasoCreate(numero_paso=item.get("number", index), accion=item.get("action", ""), datos=item.get("data"), resultado_esperado=item.get("expected_result", ""))
                         for index, item in enumerate(arguments["steps"], start=1)]
    else:
        current_steps = await db.execute(
            select(models.PasoPrueba)
            .where(models.PasoPrueba.caso_id == case.id)
            .order_by(models.PasoPrueba.numero_paso)
        )
        data["pasos"] = [
            schemas.PasoCreate(
                numero_paso=step.numero_paso,
                accion=step.accion,
                datos=step.datos,
                resultado_esperado=step.resultado_esperado,
            )
            for step in current_steps.scalars().all()
        ]
    payload = schemas.CasoPruebaCreate(**data)
    result = await suites_cases.update_caso_prueba(db, case.master_id, payload, commit=False)
    story_ids, criterion_ids = await _replace_case_traceability(db, user, project, case, arguments)
    serialized = _serialize_case(result)
    serialized.update({"story_ids": story_ids, "acceptance_criteria_ids": criterion_ids})
    return serialized

async def _replace_case_traceability(db, user, project, case, arguments):
    """Replace explicitly supplied case-master traceability links atomically."""
    if "story_ids" not in arguments and "acceptance_criteria_ids" not in arguments:
        stories = (await db.execute(select(models.CasoHistoria.historia_id).where(
            models.CasoHistoria.caso_master_id == case.master_id,
        ))).scalars().all()
        criteria = (await db.execute(select(models.AcceptanceCriterionCase.acceptance_criterion_id).where(
            models.AcceptanceCriterionCase.caso_master_id == case.master_id,
        ))).scalars().all()
        return sorted({str(value) for value in stories}), sorted({str(value) for value in criteria})

    story_ids = [_uuid(value, "story_id") for value in arguments.get("story_ids", [])]
    criterion_ids = [_uuid(value, "acceptance_criterion_id") for value in arguments.get("acceptance_criteria_ids", [])]
    if len(set(story_ids)) != len(story_ids) or len(set(criterion_ids)) != len(criterion_ids):
        raise ValueError("No repitas historias ni criterios de aceptación")

    if "story_ids" not in arguments:
        story_ids = (await db.execute(select(models.CasoHistoria.historia_id).where(
            models.CasoHistoria.caso_master_id == case.master_id,
        ))).scalars().all()
    if "acceptance_criteria_ids" not in arguments:
        criterion_ids = (await db.execute(select(models.AcceptanceCriterionCase.acceptance_criterion_id).where(
            models.AcceptanceCriterionCase.caso_master_id == case.master_id,
        ))).scalars().all()

    criteria = (await db.execute(select(models.AcceptanceCriterion).join(
        models.HistoriaUsuario, models.HistoriaUsuario.id == models.AcceptanceCriterion.historia_id,
    ).where(models.AcceptanceCriterion.id.in_(criterion_ids),
            models.HistoriaUsuario.proyecto_id == project.id,
            models.HistoriaUsuario.archivado.is_(False),
            models.AcceptanceCriterion.activo.is_(True)))).scalars().all() if criterion_ids else []
    if len(criteria) != len(criterion_ids):
        raise ValueError("Un criterio de aceptación no pertenece a una historia activa del proyecto")
    criterion_story_ids = {criterion.historia_id for criterion in criteria}
    if "story_ids" in arguments and not criterion_story_ids.issubset(set(story_ids)):
        raise ValueError("Cada criterio debe pertenecer a una historia seleccionada")
    story_ids = list(set(story_ids) | criterion_story_ids)
    stories = (await db.execute(select(models.HistoriaUsuario).where(
        models.HistoriaUsuario.id.in_(story_ids),
        models.HistoriaUsuario.proyecto_id == project.id,
        models.HistoriaUsuario.archivado.is_(False),
    ))).scalars().all() if story_ids else []
    if len(stories) != len(story_ids):
        raise ValueError("Una historia no pertenece al proyecto o está archivada")

    await db.execute(delete(models.CasoHistoria).where(models.CasoHistoria.caso_master_id == case.master_id))
    await db.execute(delete(models.AcceptanceCriterionCase).where(
        models.AcceptanceCriterionCase.caso_master_id == case.master_id,
    ))
    for story in stories:
        db.add(models.CasoHistoria(
            caso_master_id=case.master_id,
            historia_id=story.id,
            creado_por=user.id,
            historia_actualizada_en_vinculo=story.ultima_actualizacion,
        ))
    for criterion in criteria:
        db.add(models.AcceptanceCriterionCase(
            acceptance_criterion_id=criterion.id,
            caso_master_id=case.master_id,
            creado_por=user.id,
        ))
    await db.flush()
    return sorted(str(value) for value in story_ids), sorted(str(value) for value in criterion_ids)

async def archive_case(db, user, project, arguments):
    _confirm(arguments, "ARCHIVE_CASE")
    case = await db.scalar(select(models.CasoPrueba).where(models.CasoPrueba.id == _uuid(arguments["case_id"], "case_id"), models.CasoPrueba.proyecto_id == project.id))
    if not case:
        raise LookupError("case not found")
    _assert_supported(case)
    case = await cases_datasets.update_caso_metadata(db, case.id, schemas.CasoPruebaUpdateMetadata(estado_caso=models.EstadoCaso.ARCHIVADO))
    return _serialize_case(case)
