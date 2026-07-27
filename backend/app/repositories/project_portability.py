from .repository_context import *

def _require_import_mapping(value: Any, label: str) -> dict:
    if not isinstance(value, dict):
        raise ValueError(f"{label} debe ser un objeto")
    return value


def _require_import_list(value: Any, label: str, max_items: int) -> list:
    if not isinstance(value, list):
        raise ValueError(f"{label} debe ser una lista")
    if len(value) > max_items:
        raise ValueError(f"{label} no puede tener mas de {max_items} elementos")
    return value


def _bounded_import_text(value: Any, label: str, max_length: int, *, required: bool = False) -> Optional[str]:
    if value is None:
        if required:
            raise ValueError(f"{label} es requerido")
        return None
    if not isinstance(value, str):
        raise ValueError(f"{label} debe ser texto")
    text = value.strip()
    if required and not text:
        raise ValueError(f"{label} es requerido")
    if len(text) > max_length:
        raise ValueError(f"{label} no puede superar {max_length} caracteres")
    return text


def _bounded_import_int(value: Any, label: str, *, minimum: int, maximum: int) -> int:
    if not isinstance(value, int) or isinstance(value, bool):
        raise ValueError(f"{label} debe ser numerico")
    if value < minimum or value > maximum:
        raise ValueError(f"{label} debe estar entre {minimum} y {maximum}")
    return value


def _import_enum_value(value: Any, label: str, enum_cls: type, default: str) -> str:
    text = _bounded_import_text(value if value is not None else default, label, 30, required=True)
    allowed = {item.value for item in enum_cls}
    if text not in allowed:
        raise ValueError(f"{label} invalido")
    return text


def _normalize_import_package(package: dict) -> dict:
    package = _require_import_mapping(package, "package")
    proyecto_data = _require_import_mapping(package.get("proyecto"), "proyecto")
    suites_data = _require_import_list(package.get("suites", []), "suites", MAX_PROJECT_IMPORT_SUITES)
    cases_data = _require_import_list(package.get("casos", []), "casos", MAX_PROJECT_IMPORT_CASES)

    normalized_suites = []
    seen_suite_ids: set[str] = set()
    for index, suite in enumerate(suites_data):
        suite = _require_import_mapping(suite, f"suites[{index}]")
        suite_id = _bounded_import_text(suite.get("id"), f"suites[{index}].id", 100, required=True)
        if suite_id in seen_suite_ids:
            raise ValueError("El paquete contiene suites duplicadas")
        seen_suite_ids.add(suite_id)
        parent_id = _bounded_import_text(suite.get("parent_id"), f"suites[{index}].parent_id", 100)
        normalized_suites.append({
            "id": suite_id,
            "parent_id": parent_id,
            "nombre": _bounded_import_text(suite.get("nombre"), f"suites[{index}].nombre", schemas.MAX_SUITE_NAME_LENGTH, required=True),
            "descripcion": _bounded_import_text(suite.get("descripcion"), f"suites[{index}].descripcion", schemas.MAX_SUITE_DESCRIPTION_LENGTH),
        })

    normalized_cases = []
    for index, case in enumerate(cases_data):
        case = _require_import_mapping(case, f"casos[{index}]")
        suite_id = _bounded_import_text(case.get("suite_id"), f"casos[{index}].suite_id", 100)
        if suite_id and suite_id not in seen_suite_ids:
            raise ValueError("El paquete referencia una suite inexistente")
        steps_data = _require_import_list(case.get("pasos", []), f"casos[{index}].pasos", MAX_PROJECT_IMPORT_STEPS_PER_CASE)
        normalized_steps = []
        for step_index, step in enumerate(steps_data):
            step = _require_import_mapping(step, f"casos[{index}].pasos[{step_index}]")
            metadata_ai = step.get("metadata_ai")
            if metadata_ai is not None:
                metadata_ai = schemas.validate_preference_json_payload(
                    metadata_ai,
                    max_bytes=MAX_PROJECT_IMPORT_METADATA_BYTES,
                    label="metadata_ai",
                )
            normalized_steps.append({
                "numero_paso": _bounded_import_int(
                    step.get("numero_paso"),
                    f"casos[{index}].pasos[{step_index}].numero_paso",
                    minimum=1,
                    maximum=schemas.MAX_TEST_CASE_STEPS,
                ),
                "accion": _bounded_import_text(
                    step.get("accion"),
                    f"casos[{index}].pasos[{step_index}].accion",
                    schemas.MAX_TEST_CASE_TEXT_LENGTH,
                    required=True,
                ),
                "resultado_esperado": _bounded_import_text(
                    step.get("resultado_esperado"),
                    f"casos[{index}].pasos[{step_index}].resultado_esperado",
                    schemas.MAX_TEST_CASE_TEXT_LENGTH,
                ),
                "metadata_ai": metadata_ai,
            })
        normalized_cases.append({
            "master_id": _bounded_import_text(case.get("master_id"), f"casos[{index}].master_id", 100, required=True),
            "suite_id": suite_id,
            "titulo": _bounded_import_text(case.get("titulo"), f"casos[{index}].titulo", schemas.MAX_TEST_CASE_TITLE_LENGTH, required=True),
            "precondiciones": _bounded_import_text(case.get("precondiciones"), f"casos[{index}].precondiciones", schemas.MAX_TEST_CASE_TEXT_LENGTH),
            "version": _bounded_import_int(case.get("version", 1), f"casos[{index}].version", minimum=1, maximum=10_000),
            "prioridad": _import_enum_value(case.get("prioridad"), f"casos[{index}].prioridad", models.Prioridad, models.Prioridad.MEDIA.value),
            "tipo_prueba": _import_enum_value(case.get("tipo_prueba"), f"casos[{index}].tipo_prueba", models.TipoPrueba, models.TipoPrueba.MANUAL.value),
            "estado_caso": _import_enum_value(case.get("estado_caso"), f"casos[{index}].estado_caso", models.EstadoCaso, models.EstadoCaso.ACTIVO.value),
            "pasos": normalized_steps,
        })

    return {
        "proyecto": {
            "nombre": _bounded_import_text(proyecto_data.get("nombre"), "proyecto.nombre", schemas.MAX_PROJECT_NAME_LENGTH, required=True),
            "descripcion": _bounded_import_text(proyecto_data.get("descripcion"), "proyecto.descripcion", schemas.MAX_PROJECT_DESCRIPTION_LENGTH),
            "organizacion_id": proyecto_data.get("organizacion_id"),
        },
        "suites": normalized_suites,
        "casos": normalized_cases,
    }


async def export_proyecto(db: AsyncSession, proyecto_id: UUID):
    proyecto = await get_proyecto(db, proyecto_id)
    if not proyecto: return None
    suites = await get_suites_proyecto(db, proyecto_id)
    result = await db.execute(select(models.CasoPrueba).filter(models.CasoPrueba.proyecto_id == proyecto_id).order_by(models.CasoPrueba.master_id, models.CasoPrueba.version))
    casos = result.scalars().all()
    package = {"version_formato": "1.0", "proyecto": {"nombre": proyecto.nombre, "descripcion": proyecto.descripcion}, "suites": [{"id": str(s.id), "parent_id": str(s.parent_id) if s.parent_id else None, "nombre": s.nombre, "descripcion": s.descripcion} for s in suites], "casos": []}
    for c in casos:
        result_pasos = await db.execute(select(models.PasoPrueba).filter(models.PasoPrueba.caso_id == c.id).order_by(models.PasoPrueba.numero_paso))
        pasos = result_pasos.scalars().all()
        package["casos"].append({"master_id": str(c.master_id), "suite_id": str(c.suite_id) if c.suite_id else None, "titulo": c.titulo, "precondiciones": c.precondiciones, "version": c.version, "prioridad": c.prioridad, "tipo_prueba": c.tipo_prueba, "estado_caso": c.estado_caso, "pasos": [{"numero_paso": p.numero_paso, "accion": p.accion, "resultado_esperado": p.resultado_esperado, "metadata_ai": p.metadata_ai} for p in pasos]})
    return package

async def import_proyecto(db: AsyncSession, package: dict, imported_by: UUID):
    package = _normalize_import_package(package)
    proyecto_data = package["proyecto"]
    organizacion_id = await resolve_project_organizacion(db, proyecto_data.get("organizacion_id"))
    db_proyecto = models.Proyecto(
        nombre=f"{proyecto_data['nombre']} (Importado {uuid.uuid4().hex[:4]})",
        descripcion=proyecto_data["descripcion"],
        organizacion_id=organizacion_id,
    )
    db.add(db_proyecto)
    await db.flush()
    id_map_suites = {}
    suites_pendientes = package["suites"]
    intentos = 0
    while suites_pendientes and intentos < 10:
        actuales = []
        for s in suites_pendientes:
            if s["parent_id"] is None or s["parent_id"] in id_map_suites:
                db_suite = models.Suite(proyecto_id=db_proyecto.id, parent_id=id_map_suites.get(s["parent_id"]), nombre=s["nombre"], descripcion=s["descripcion"])
                db.add(db_suite)
                await db.flush()
                id_map_suites[s["id"]] = db_suite.id
            else: actuales.append(s)
        suites_pendientes = actuales
        intentos += 1
    id_map_masters = {}
    for c in package["casos"]:
        if c["master_id"] not in id_map_masters: id_map_masters[c["master_id"]] = uuid.uuid4()
        db_caso = models.CasoPrueba(master_id=id_map_masters[c["master_id"]], proyecto_id=db_proyecto.id, suite_id=id_map_suites.get(c["suite_id"]), titulo=c["titulo"], precondiciones=c.get("precondiciones"), version=c["version"], prioridad=c["prioridad"], tipo_prueba=c["tipo_prueba"], estado_caso=c.get("estado_caso", "ACTIVO"), creado_por=imported_by)
        db.add(db_caso)
        await db.flush()
        for p in c["pasos"]:
            db_paso = models.PasoPrueba(caso_id=db_caso.id, numero_paso=p["numero_paso"], accion=p["accion"], resultado_esperado=p["resultado_esperado"], metadata_ai=p.get("metadata_ai"))
            db.add(db_paso)
    await db.commit()
    await db.refresh(db_proyecto)
    return db_proyecto

# --- ENTORNOS ---
