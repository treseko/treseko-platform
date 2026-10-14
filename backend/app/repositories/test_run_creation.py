from .repository_context import *
from ..services.edition.entitlement_service import enforce_limit
from ..services.api_dynamic_variables import (
    DynamicVariableContext,
    derive_case_dynamic_seed,
    extract_unsupported_dynamic_variable_names,
    safe_dynamic_values,
)
from ..services.api_test_runner import resolve_variables
from ..services.api_evidence_policy import evidence_policy_marker, public_test_data_evidence_enabled


async def create_test_run(db: AsyncSession, run: schemas.TestRunCreate, user_id: UUID, *, commit: bool = True):
    run_data = run.model_dump(exclude={"caso_ids"})
    db_entorno = None
    if not run.build_id:
        raise ValueError("Toda ejecución debe pertenecer a una build activa")
    db_build = await db.get(models.Build, run.build_id)
    if not db_build or db_build.proyecto_id != run.proyecto_id:
        raise ValueError("La build no pertenece al proyecto seleccionado")
    if not access_control.is_build_active(db_build):
        raise ValueError("La build no está activa. No se pueden crear nuevas ejecuciones")
    if run.entorno_id:
        entorno_result = await db.execute(
            select(models.Entorno).filter(
                models.Entorno.id == run.entorno_id,
                models.Entorno.proyecto_id == run.proyecto_id,
                models.Entorno.activo == True,
            )
        )
        db_entorno = entorno_result.scalar_one_or_none()
        if not db_entorno:
            raise ValueError("El ambiente seleccionado no pertenece al proyecto")
        run_data["entorno"] = db_entorno.nombre
        if run.dataset_id:
            dataset_result = await db.execute(
                select(models.EntornoDataset).filter(
                    models.EntornoDataset.id == run.dataset_id,
                    models.EntornoDataset.entorno_id == run.entorno_id,
                    models.EntornoDataset.activo == True,
                )
            )
            db_dataset = dataset_result.scalar_one_or_none()
            if not db_dataset:
                raise ValueError("El dataset seleccionado no pertenece al ambiente o esta inactivo")
        else:
            dataset_result = await db.execute(
                select(models.EntornoDataset)
                .filter(
                    models.EntornoDataset.entorno_id == run.entorno_id,
                    models.EntornoDataset.activo == True,
                )
                .order_by(models.EntornoDataset.es_default.desc(), models.EntornoDataset.fecha_creacion)
            )
            db_dataset = dataset_result.scalars().first()
            if db_dataset:
                run_data["dataset_id"] = db_dataset.id
    elif run.dataset_id:
        raise ValueError("Selecciona un ambiente antes de seleccionar dataset")
    assigned_result = await db.execute(select(models.BuildCaso.caso_id).filter(models.BuildCaso.build_id == run.build_id))
    assigned_case_ids = set(assigned_result.scalars().all())
    if not assigned_case_ids:
        raise ValueError("La build no tiene casos asignados")

    if run.caso_ids:
        if any(caso_id not in assigned_case_ids for caso_id in run.caso_ids):
            raise ValueError("Solo puedes ejecutar casos asignados a la build")
        result = await db.execute(
            select(models.CasoPrueba).filter(
                models.CasoPrueba.id.in_(run.caso_ids),
                models.CasoPrueba.proyecto_id == run.proyecto_id,
                models.CasoPrueba.activo == True,
            )
        )
        casos_activos = result.scalars().all()
    else:
        build_result = await db.execute(select(models.Build).filter(models.Build.id == run.build_id))
        db_build = build_result.scalar_one_or_none()
        filtros = [
            models.CasoPrueba.id.in_(assigned_case_ids),
            models.CasoPrueba.proyecto_id == run.proyecto_id,
            models.CasoPrueba.activo == True,
        ]
        if db_build and db_build.componente_id:
            filtros.append(models.CasoPrueba.componente_id == db_build.componente_id)
        result = await db.execute(select(models.CasoPrueba).filter(*filtros))
        casos_activos = result.scalars().all()

    archived_cases = [
        caso for caso in casos_activos
        if caso.estado_caso == models.EstadoCaso.ARCHIVADO
    ]
    if archived_cases:
        case_names = ", ".join(caso.codigo or caso.titulo or str(caso.id) for caso in archived_cases)
        raise ValueError(
            "No se puede iniciar una nueva ejecución con casos archivados: "
            f"{case_names}. Restaura la prueba o quítala de la selección."
        )

    run_seed = run.dynamic_seed or DynamicVariableContext().seed
    run_data["dynamic_seed"] = run_seed
    db_run = models.TestRun(**run_data, creado_por=user_id, estado_run=models.EstadoRun.ABIERTO)
    db.add(db_run)
    await db.flush()

    datasets_resueltos = {}
    variables_resueltas = {}
    run_execution_mode = _run_origin_execution_mode(run.origen) or models.ExecutionMode.MANUAL.value
    for caso in casos_activos:
        resolved_dataset = await resolve_case_dataset(db, caso.id, run.build_id, run.entorno_id, run.dataset_id)
        case_variables = {}
        if resolved_dataset:
            datasets_resueltos[str(caso.id)] = resolved_dataset["dataset_resuelto"]
            case_variables = resolved_dataset["variables_resueltas"]
            variables_resueltas.update(case_variables)
        case_dynamic = DynamicVariableContext(derive_case_dynamic_seed(run_seed, str(caso.id)))
        public_evidence = public_test_data_evidence_enabled(environment=db_entorno, case=caso)
        db_ejecucion = models.EjecucionCaso(
            test_run_id=db_run.id,
            caso_id=caso.id,
            version_ejecutada=caso.version,
            ejecutado_por=user_id,
            estado_resultado=models.EstadoResultado.SIN_CORRER,
            execution_mode=models.ExecutionMode(run_execution_mode),
            evidence_policy={"complete_data": True, "redaction": "disabled", "scope": "authenticated_execution"} if run_execution_mode != models.ExecutionMode.MANUAL.value else evidence_policy_marker(public_evidence)["evidence_policy"],
            dynamic_seed=case_dynamic.seed,
            dynamic_variables={},
        )
        if caso.formato_prueba == models.FormatoPrueba.CONVERSACIONAL and run_execution_mode == models.ExecutionMode.MANUAL.value:
            from ..services.chatbot_manual_context import freeze_manual_context
            freeze_manual_context(db_ejecucion, caso, db_run, resolved_dataset, db_entorno)
        db.add(db_ejecucion)
        await db.flush()
        result_pasos = await db.execute(select(models.PasoPrueba).filter(models.PasoPrueba.caso_id == caso.id).order_by(models.PasoPrueba.numero_paso))
        pasos_orig = result_pasos.scalars().all()
        for p in pasos_orig:
            resolved_data = p.datos
            if caso.formato_prueba == models.FormatoPrueba.CLASICA and p.datos:
                unsupported = extract_unsupported_dynamic_variable_names(p.datos)
                if unsupported:
                    raise ValueError(
                        f"El caso {caso.codigo or caso.id} usa variables dinámicas no soportadas: "
                        f"{', '.join(sorted(unsupported))}."
                    )
                resolved_data = resolve_variables(
                    p.datos,
                    case_variables,
                    case_dynamic,
                    source=f"classic.step.{p.numero_paso}",
                )
            db_snapshot = models.SnapshotPaso(
                ejecucion_caso_id=db_ejecucion.id,
                paso_id=p.id,
                numero_paso=p.numero_paso,
                accion_congelada=p.accion,
                datos_congelados=p.datos,
                datos_resueltos=resolved_data,
                resultado_esperado_congelado=p.resultado_esperado,
                estado_paso=models.EstadoResultado.SIN_CORRER,
            )
            db.add(db_snapshot)
        db_ejecucion.dynamic_variables = safe_dynamic_values(case_dynamic)
    db_run.datasets_resueltos = datasets_resueltos
    db_run.variables_resueltas = variables_resueltas
    if commit:
        await db.commit()
        await db.refresh(db_run)
    else:
        await db.flush()
    return db_run
