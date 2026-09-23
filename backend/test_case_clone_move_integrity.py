import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app import crud, models, schemas


CASE_DEFINITION_FIELDS = (
    "proyecto_id",
    "componente_id",
    "titulo",
    "descripcion",
    "precondiciones",
    "postcondiciones",
    "prioridad",
    "criticidad",
    "tipo_prueba",
    "estado_caso",
    "dataset",
    "etiquetas",
    "script_automatizado",
    "framework",
    "creado_por",
)

CASE_DEFINITION_FIELDS_WITHOUT_TITLE = tuple(
    field for field in CASE_DEFINITION_FIELDS if field != "titulo"
)

STEP_DEFINITION_FIELDS = (
    "numero_paso",
    "accion",
    "datos",
    "resultado_esperado",
    "metadata_ai",
)


async def _isolated_session():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    tables = (
        models.Organizacion.__table__,
        models.Proyecto.__table__,
        models.Componente.__table__,
        models.Suite.__table__,
        models.CasoPrueba.__table__,
        models.PasoPrueba.__table__,
        models.EjecucionCaso.__table__,
        models.Attachment.__table__,
        models.PasoAttachment.__table__,
        models.Requisito.__table__,
        models.HistoriaUsuario.__table__,
        models.AcceptanceCriterion.__table__,
        models.CasoHistoria.__table__,
        models.AcceptanceCriterionCase.__table__,
    )
    async with engine.begin() as connection:
        for table in tables:
            await connection.run_sync(table.create)
    return engine, async_sessionmaker(engine, expire_on_commit=False)


async def _seed_complete_case(db):
    actor_id = uuid.uuid4()
    organization = models.Organizacion(nombre="Auditoría de casos", tipo="Cliente")
    project = models.Proyecto(nombre="Proyecto aislado", organizacion=organization)
    component = models.Componente(nombre="Portal web", proyecto=project)
    db.add_all((organization, project, component))
    await db.flush()
    source_suite = models.Suite(
        nombre="Origen",
        proyecto_id=project.id,
        componente_id=component.id,
    )
    target_suite = models.Suite(
        nombre="Destino",
        proyecto_id=project.id,
        componente_id=component.id,
    )
    db.add_all((source_suite, target_suite))
    await db.flush()

    case = models.CasoPrueba(
        master_id=uuid.uuid4(),
        codigo="TC-INTEGRITY-001",
        proyecto_id=project.id,
        suite_id=source_suite.id,
        componente_id=component.id,
        titulo="Compra completa",
        descripcion="Valida una compra integral.",
        precondiciones="Usuario autenticado y con carrito activo.",
        postcondiciones="La orden queda registrada.",
        version=3,
        prioridad=models.Prioridad.ALTA,
        criticidad=models.Criticidad.CRITICA,
        tipo_prueba=models.TipoPrueba.AUTOMATIZADA,
        estado_caso=models.EstadoCaso.ACTIVO,
        dataset=[
            {"key": "sku", "value": "SKU-001"},
            {"key": "cantidad", "value": "2"},
        ],
        etiquetas=["regresión", "checkout"],
        script_automatizado='await page.goto("{{BASE_URL}}")',
        framework="playwright",
        creado_por=actor_id,
        ultimo_resultado="PASO",
        ultima_ejecucion_por=actor_id,
    )
    db.add(case)
    await db.flush()

    steps = (
        models.PasoPrueba(
            caso_id=case.id,
            numero_paso=1,
            accion="Abrir el carrito",
            datos="sku=SKU-001",
            resultado_esperado="El carrito queda visible",
            metadata_ai={"intent": "navigate", "confidence": 0.99},
        ),
        models.PasoPrueba(
            caso_id=case.id,
            numero_paso=2,
            accion="Confirmar la compra",
            datos="cantidad=2",
            resultado_esperado="La orden queda creada",
            metadata_ai={"intent": "submit", "confidence": 0.98},
        ),
    )
    db.add_all(steps)
    await db.flush()

    for index, step in enumerate(steps, start=1):
        attachment = models.Attachment(
            filename_original=f"referencia-{index}.png",
            content_type="image/png",
            size=100 + index,
            sha256=f"{index:064x}",
            storage_path=f"isolated/{index}.png",
            public_url=f"/static/isolated/{index}.png",
            scope="step",
            proyecto_id=project.id,
            created_by=actor_id,
        )
        db.add(attachment)
        await db.flush()
        db.add(
            models.PasoAttachment(
                paso_id=step.id,
                attachment_id=attachment.id,
                tipo="reference",
            )
        )

    requirement = models.Requisito(
        proyecto_id=project.id,
        codigo="REQ-001",
        titulo="Compra en línea",
    )
    db.add(requirement)
    await db.flush()
    story = models.HistoriaUsuario(
        requisito_id=requirement.id,
        proyecto_id=project.id,
        codigo="US-001",
        titulo="Comprar productos",
    )
    db.add(story)
    await db.flush()
    criterion = models.AcceptanceCriterion(
        historia_id=story.id,
        codigo="AC-001",
        tipo="SCENARIO",
        titulo="Orden confirmada",
        observable_result="La orden existe",
    )
    db.add(criterion)
    await db.flush()
    db.add_all((
        models.CasoHistoria(
            caso_master_id=case.master_id,
            historia_id=story.id,
            requiere_revision=True,
        ),
        models.AcceptanceCriterionCase(
            acceptance_criterion_id=criterion.id,
            caso_master_id=case.master_id,
        ),
    ))
    await db.commit()
    return case, source_suite, target_suite


def _definition(instance, fields):
    return {field: getattr(instance, field) for field in fields}


async def _step_definitions(db, case_id):
    result = await db.execute(
        select(models.PasoPrueba)
        .where(models.PasoPrueba.caso_id == case_id)
        .order_by(models.PasoPrueba.numero_paso)
    )
    return [_definition(step, STEP_DEFINITION_FIELDS) for step in result.scalars().all()]


async def _step_attachment_definitions(db, case_id):
    result = await db.execute(
        select(
            models.PasoPrueba.numero_paso,
            models.PasoAttachment.tipo,
            models.PasoAttachment.attachment_id,
        )
        .join(models.PasoAttachment, models.PasoAttachment.paso_id == models.PasoPrueba.id)
        .where(models.PasoPrueba.caso_id == case_id)
        .order_by(models.PasoPrueba.numero_paso, models.PasoAttachment.id)
    )
    return result.all()


async def _traceability_definitions(db, master_id):
    story_result = await db.execute(
        select(
            models.CasoHistoria.historia_id,
            models.CasoHistoria.requiere_revision,
        ).where(models.CasoHistoria.caso_master_id == master_id)
    )
    criterion_result = await db.execute(
        select(models.AcceptanceCriterionCase.acceptance_criterion_id).where(
            models.AcceptanceCriterionCase.caso_master_id == master_id
        )
    )
    return {
        "stories": story_result.all(),
        "criteria": criterion_result.scalars().all(),
    }


@pytest.mark.asyncio
async def test_clone_case_preserves_definition_steps_and_step_attachments():
    engine, session_factory = await _isolated_session()
    try:
        async with session_factory() as db:
            original, _, target_suite = await _seed_complete_case(db)
            original_definition = _definition(original, CASE_DEFINITION_FIELDS)
            original_steps = await _step_definitions(db, original.id)
            original_attachments = await _step_attachment_definitions(db, original.id)
            original_traceability = await _traceability_definitions(db, original.master_id)

            cloned = await crud.clone_caso(db, original.id, target_suite.id)

            assert cloned.id != original.id
            assert cloned.master_id != original.master_id
            assert cloned.codigo != original.codigo
            assert cloned.version == 1
            assert cloned.suite_id == target_suite.id
            assert cloned.ultimo_resultado is None
            assert cloned.ultima_ejecucion_por is None
            assert _definition(cloned, CASE_DEFINITION_FIELDS_WITHOUT_TITLE) == _definition(
                original, CASE_DEFINITION_FIELDS_WITHOUT_TITLE
            )
            assert cloned.titulo == "Copia de Compra completa"
            assert await _step_definitions(db, cloned.id) == original_steps
            assert await _step_attachment_definitions(db, cloned.id) == original_attachments
            assert await _traceability_definitions(db, cloned.master_id) == original_traceability
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_clone_case_uses_next_code_without_reusing_high_existing_code():
    engine, session_factory = await _isolated_session()
    try:
        async with session_factory() as db:
            original, _, target_suite = await _seed_complete_case(db)
            high_code_case = models.CasoPrueba(
                master_id=uuid.uuid4(),
                codigo="TC-9999",
                proyecto_id=original.proyecto_id,
                suite_id=original.suite_id,
                componente_id=original.componente_id,
                titulo="Caso de numeración alta",
                prioridad=models.Prioridad.MEDIA,
                criticidad=models.Criticidad.MEDIA,
                tipo_prueba=models.TipoPrueba.MANUAL,
                formato_prueba=models.FormatoPrueba.CLASICA,
                estado_caso=models.EstadoCaso.ACTIVO,
                creado_por=original.creado_por,
            )
            db.add(high_code_case)
            await db.commit()

            cloned = await crud.clone_caso(db, original.id, target_suite.id)

            assert cloned.codigo == "TC-10000"
            assert cloned.codigo != original.codigo
            assert cloned.codigo != high_code_case.codigo
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_repeated_clone_and_move_use_unique_titles_per_suite():
    engine, session_factory = await _isolated_session()
    try:
        async with session_factory() as db:
            original, source_suite, target_suite = await _seed_complete_case(db)

            first_clone = await crud.clone_caso(db, original.id, target_suite.id)
            second_clone = await crud.clone_caso(db, original.id, target_suite.id)

            assert first_clone.titulo == "Copia de Compra completa"
            assert second_clone.titulo == "Copia de Compra completa (2)"
            assert original.titulo == "Compra completa"

            moved = await crud.move_caso(db, original.id, target_suite.id)
            assert moved.titulo == "Compra completa"

            conflicting_case = models.CasoPrueba(
                master_id=uuid.uuid4(),
                codigo="TC-CONFLICT-001",
                proyecto_id=original.proyecto_id,
                suite_id=target_suite.id,
                componente_id=original.componente_id,
                titulo="Compra completa",
                prioridad=models.Prioridad.MEDIA,
                criticidad=models.Criticidad.MEDIA,
                tipo_prueba=models.TipoPrueba.MANUAL,
                formato_prueba=models.FormatoPrueba.CLASICA,
                estado_caso=models.EstadoCaso.ACTIVO,
                creado_por=original.creado_por,
            )
            db.add(conflicting_case)
            await db.commit()

            restored = await crud.move_caso(db, moved.id, source_suite.id)
            moved_back = await crud.move_caso(db, restored.id, target_suite.id)

            assert moved_back.titulo == "Compra completa"
            assert conflicting_case.titulo == "Compra completa"
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_create_case_allows_exact_duplicate_title_and_generates_distinct_code():
    engine, session_factory = await _isolated_session()
    try:
        async with session_factory() as db:
            original, _, _ = await _seed_complete_case(db)
            duplicate = schemas.CasoPruebaCreate(
                proyecto_id=original.proyecto_id,
                suite_id=original.suite_id,
                componente_id=original.componente_id,
                titulo=original.titulo,
                prioridad=models.Prioridad.MEDIA,
                criticidad=models.Criticidad.MEDIA,
                tipo_prueba=models.TipoPrueba.MANUAL,
                formato_prueba=models.FormatoPrueba.CLASICA,
                creado_por=original.creado_por,
            )

            created = await crud.create_caso_prueba(db, duplicate)

            cases = (
                await db.execute(
                    select(models.CasoPrueba).where(
                        models.CasoPrueba.suite_id == original.suite_id
                    )
                )
            ).scalars().all()
            assert len(cases) == 2
            assert created.titulo == original.titulo
            assert created.codigo != original.codigo
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_move_case_changes_only_its_suite():
    engine, session_factory = await _isolated_session()
    try:
        async with session_factory() as db:
            case, _, target_suite = await _seed_complete_case(db)
            original_identity = {
                "id": case.id,
                "master_id": case.master_id,
                "codigo": case.codigo,
                "version": case.version,
            }
            original_definition = _definition(case, CASE_DEFINITION_FIELDS)
            original_steps = await _step_definitions(db, case.id)
            original_attachments = await _step_attachment_definitions(db, case.id)
            original_traceability = await _traceability_definitions(db, case.master_id)

            moved = await crud.move_caso(db, case.id, target_suite.id)

            assert moved.suite_id == target_suite.id
            assert {
                "id": moved.id,
                "master_id": moved.master_id,
                "codigo": moved.codigo,
                "version": moved.version,
            } == original_identity
            assert _definition(moved, CASE_DEFINITION_FIELDS) == original_definition
            assert await _step_definitions(db, moved.id) == original_steps
            assert await _step_attachment_definitions(db, moved.id) == original_attachments
            assert await _traceability_definitions(db, moved.master_id) == original_traceability
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_copying_suite_preserves_case_steps_and_step_attachments():
    engine, session_factory = await _isolated_session()
    try:
        async with session_factory() as db:
            case, source_suite, _ = await _seed_complete_case(db)
            original_definition = _definition(case, CASE_DEFINITION_FIELDS)
            original_steps = await _step_definitions(db, case.id)
            original_attachments = await _step_attachment_definitions(db, case.id)
            original_traceability = await _traceability_definitions(db, case.master_id)

            result = await crud.clone_suite(
                db,
                source_suite.id,
                nuevo_nombre="Copia íntegra",
                include_cases=True,
            )
            cloned_suite = result["suite"]
            cloned_case = (
                await db.execute(
                    select(models.CasoPrueba).where(
                        models.CasoPrueba.suite_id == cloned_suite.id
                    )
                )
            ).scalar_one()

            assert result["suites_copiadas"] == 1
            assert result["casos_copiados"] == 1
            assert cloned_case.master_id != case.master_id
            assert cloned_case.codigo != case.codigo
            assert cloned_case.version == 1
            assert _definition(cloned_case, CASE_DEFINITION_FIELDS_WITHOUT_TITLE) == _definition(
                case, CASE_DEFINITION_FIELDS_WITHOUT_TITLE
            )
            assert cloned_case.titulo == "Copia de Compra completa"
            assert await _step_definitions(db, cloned_case.id) == original_steps
            assert await _step_attachment_definitions(db, cloned_case.id) == original_attachments
            assert await _traceability_definitions(db, cloned_case.master_id) == original_traceability
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_copy_and_move_reject_other_component_without_partial_changes():
    engine, session_factory = await _isolated_session()
    try:
        async with session_factory() as db:
            case, source_suite, _ = await _seed_complete_case(db)
            other_component = models.Componente(
                nombre="API",
                proyecto_id=case.proyecto_id,
            )
            db.add(other_component)
            await db.flush()
            incompatible_suite = models.Suite(
                nombre="Otro componente",
                proyecto_id=case.proyecto_id,
                componente_id=other_component.id,
            )
            db.add(incompatible_suite)
            await db.commit()

            with pytest.raises(ValueError, match="otro componente"):
                await crud.clone_caso(db, case.id, incompatible_suite.id)
            with pytest.raises(ValueError, match="otro componente"):
                await crud.move_caso(db, case.id, incompatible_suite.id)

            unchanged = await crud.get_caso_with_pasos(db, case.id)
            assert unchanged.suite_id == source_suite.id
            assert len(await _step_definitions(db, case.id)) == 2
            assert len(await _step_attachment_definitions(db, case.id)) == 2
    finally:
        await engine.dispose()
