from .legacy_common import *


async def revoke_automation_runner(db: AsyncSession, runner_id: UUID):
    result = await db.execute(select(models.AutomationRunner).filter(models.AutomationRunner.id == runner_id))
    runner = result.scalar_one_or_none()
    if not runner:
        return None
    runner.activo = False
    runner.estado = "OFFLINE"
    await db.commit()
    await db.refresh(runner)
    return runner

OFFICIAL_FRAMEWORK_LANGUAGES = {
    "playwright": {"javascript", "typescript", "python", "java", "csharp"},
    "selenium": {"java", "python", "csharp", "javascript", "typescript", "ruby"},
    "cypress": {"javascript", "typescript"},
    "puppeteer": {"javascript", "typescript"},
}

LOCAL_WORKER_DEFAULT_LANGUAGES = {
    "playwright": {"javascript", "typescript"},
    "selenium": {"python"},
    "cypress": {"javascript", "typescript"},
    "puppeteer": {"javascript", "typescript"},
}

LANGUAGE_ALIASES = {
    "js": "javascript",
    "node": "javascript",
    "nodejs": "javascript",
    "ts": "typescript",
    "py": "python",
    "dotnet": "csharp",
    ".net": "csharp",
    "c#": "csharp",
    "c# (.net)": "csharp",
    "csharp (.net)": "csharp",
    "cs": "csharp",
}

def _normalize_framework(value: Optional[str]) -> str:
    return (value or "playwright").split(":", 1)[0].split("@", 1)[0].strip().lower() or "playwright"

def _default_language_for_framework(framework: str) -> str:
    if framework == "selenium":
        return "python"
    return "javascript"

def _normalize_language(value: Optional[str], framework: Optional[str] = None) -> str:
    framework_key = _normalize_framework(framework)
    language = (value or "").strip().lower()
    language = LANGUAGE_ALIASES.get(language, language)
    allowed = OFFICIAL_FRAMEWORK_LANGUAGES.get(framework_key, {"javascript"})
    if language not in allowed:
        return _default_language_for_framework(framework_key)
    return language

def _job_required_language(job: models.AutomationJob) -> str:
    payload = job.payload_congelado or {}
    return _normalize_language(
        payload.get("language") or payload.get("lenguaje") or getattr(job, "required_language", None),
        job.required_framework,
    )

def _capability_languages_for_framework(capabilities: Dict[str, Any], framework: str):
    matrix = capabilities.get("framework_languages") or capabilities.get("supported_languages")
    if isinstance(matrix, dict):
        values = matrix.get(framework) or matrix.get(framework.upper()) or matrix.get(framework.capitalize())
        if isinstance(values, str):
            values = [values]
        if isinstance(values, list):
            return {_normalize_language(str(item), framework) for item in values}
    languages = capabilities.get("languages")
    if isinstance(languages, dict):
        values = languages.get(framework)
        if isinstance(values, str):
            values = [values]
        if isinstance(values, list):
            return {_normalize_language(str(item), framework) for item in values}
    if isinstance(languages, list):
        return {_normalize_language(str(item), framework) for item in languages}
    legacy_language = capabilities.get(f"{framework}_language")
    if legacy_language:
        return {_normalize_language(str(legacy_language), framework)}
    return LOCAL_WORKER_DEFAULT_LANGUAGES.get(framework)

def _runner_supports_job(runner: models.AutomationRunner, job: models.AutomationJob) -> bool:
    capabilities = runner.capabilities or {}
    framework = _normalize_framework(job.required_framework)
    frameworks = capabilities.get("frameworks") or capabilities.get("framework") or capabilities.get("supported_frameworks")
    if isinstance(frameworks, str):
        frameworks = [frameworks]
    if frameworks and framework not in {str(item).lower() for item in frameworks}:
        return False
    required_language = _job_required_language(job)
    supported_languages = _capability_languages_for_framework(capabilities, framework)
    if supported_languages and required_language not in supported_languages:
        return False
    required_runtime = (job.required_runtime or "").strip().lower()
    if required_runtime:
        versions = capabilities.get("versions") or {}
        current = str(versions.get(framework, "") or capabilities.get(f"{framework}_version", "")).strip().lower()
        if current and required_runtime not in {"latest", "latest compatible"} and current != required_runtime:
            return False
    return True

def _parse_framework_requirement(value: Optional[str]):
    raw = (value or "playwright").strip()
    framework_part = raw.split(":", 1)[0]
    if "@" in raw:
        framework, runtime = framework_part.split("@", 1)
        return framework.strip().lower() or "playwright", runtime.strip() or None
    return framework_part.lower(), None

def _parse_framework_language(value: Optional[str]):
    raw = (value or "playwright").strip().lower()
    if ":" not in raw:
        framework = _normalize_framework(raw)
        return framework, _default_language_for_framework(framework)
    framework, language = raw.split(":", 1)
    framework = _normalize_framework(framework)
    return framework, _normalize_language(language, framework)

def _detect_automation_script_format(script: Optional[str], framework: Optional[str] = "playwright", language: Optional[str] = None) -> str:
    framework_key = _normalize_framework(framework)
    language_key = _normalize_language(language, framework_key)
    text = script or ""
    if framework_key == "cypress":
        return "cypress_spec"
    if framework_key == "puppeteer":
        return "node_script"
    if framework_key == "selenium":
        return "python_script" if language_key == "python" else f"selenium_{language_key}"
    if framework_key == "playwright" and language_key not in {"javascript", "typescript"}:
        return f"playwright_{language_key}"
    if re.search(r"@playwright/test|\btest\s*\(|\bexpect\s*\(", text):
        return "playwright_test"
    return "worker_function"

async def _find_compatible_runner_for_job(db: AsyncSession, job: models.AutomationJob):
    runners_result = await db.execute(
        select(models.AutomationRunner).filter(
            models.AutomationRunner.activo == True,
            models.AutomationRunner.estado.in_(["ONLINE", "BUSY"]),
        )
    )
    return next(
        (runner for runner in runners_result.scalars().all() if _runner_supports_job(runner, job)),
        None,
    )

def _parse_key_value_text(value: Optional[str]) -> Dict[str, str]:
    parsed: Dict[str, str] = {}
    raw = (value or "").replace("\r", "\n")
    for chunk in raw.replace("/", "\n").split("\n"):
        for part in chunk.split():
            if "=" not in part:
                continue
            key, item_value = part.split("=", 1)
            key = key.strip()
            if key:
                parsed[key] = item_value.strip()
    return parsed

def _automation_steps_for_payload(steps: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    normalized = []
    for index, step in enumerate(steps or []):
        normalized.append({
            "number": step.get("numero_paso") or step.get("number") or index + 1,
            "action": step.get("accion") or step.get("action") or "",
            "data": step.get("datos") or step.get("data") or "",
            "expected": step.get("resultado_esperado") or step.get("expected") or "",
        })
    return normalized

async def _resolve_dry_run_variables(db: AsyncSession, payload: schemas.AutomationDryRunRequest):
    variables: Dict[str, str] = {}
    environment_name = None
    dataset_name = None
    dataset_vars: Dict[str, str] = {}

    if payload.entorno_id:
        entorno_result = await db.execute(
            select(models.Entorno).filter(
                models.Entorno.id == payload.entorno_id,
                models.Entorno.proyecto_id == payload.proyecto_id,
                models.Entorno.activo == True,
            )
        )
        entorno = entorno_result.scalar_one_or_none()
        if not entorno:
            raise ValueError("El ambiente seleccionado no existe o esta inactivo")
        environment_name = entorno.nombre
        variables.update({str(key): str(value) for key, value in (entorno.variables or {}).items()})
        if entorno.url and "base_url" not in variables:
            variables["base_url"] = entorno.url

    if payload.componente_id:
        componente_result = await db.execute(
            select(models.Componente).filter(
                models.Componente.id == payload.componente_id,
                models.Componente.proyecto_id == payload.proyecto_id,
            )
        )
        componente = componente_result.scalar_one_or_none()
        if not componente:
            raise ValueError("El componente seleccionado no existe en el proyecto")
        for key, value in (componente.variables or {}).items():
            variables[f"COMPONENT.{key}"] = str(value)

    dataset_id = payload.dataset_id
    if not dataset_id and payload.entorno_id:
        default_dataset_result = await db.execute(
            select(models.EntornoDataset)
            .filter(
                models.EntornoDataset.entorno_id == payload.entorno_id,
                models.EntornoDataset.activo == True,
                models.EntornoDataset.es_default == True,
            )
            .limit(1)
        )
        default_dataset = default_dataset_result.scalar_one_or_none()
        dataset_id = default_dataset.id if default_dataset else None

    if dataset_id:
        dataset_result = await db.execute(
            select(models.EntornoDataset).join(models.Entorno).filter(
                models.EntornoDataset.id == dataset_id,
                models.EntornoDataset.activo == True,
                models.Entorno.proyecto_id == payload.proyecto_id,
            )
        )
        dataset = dataset_result.scalar_one_or_none()
        if not dataset:
            raise ValueError("El dataset seleccionado no existe o esta inactivo")
        dataset_name = dataset.nombre
        dataset_vars = {str(key): str(value) for key, value in (dataset.variables or {}).items()}
        variables.update(dataset_vars)
        for key, value in dataset_vars.items():
            variables[f"DATASET.{key}"] = value

    case_vars = _parse_key_value_text(payload.datos_caso)
    variables.update(case_vars)
    variables.update(_case_variable_aliases(case_vars))
    return variables, environment_name, dataset_name, dataset_vars, case_vars

async def prepare_automation_script_for_case(db: AsyncSession, case: models.CasoPrueba):
    return await prepare_automation_script_for_context(
        db,
        script=case.script_automatizado or "",
        proyecto_id=case.proyecto_id,
        componente_id=case.componente_id,
        framework=case.framework or "playwright",
    )

async def prepare_automation_script_for_context(
    db: AsyncSession,
    script: str,
    proyecto_id: UUID,
    componente_id: Optional[UUID],
    framework: Optional[str] = "playwright",
):
    framework = (framework or "playwright").split(":", 1)[0].split("@", 1)[0].strip().lower()
    funciones = await get_funciones_proyecto(
        db,
        proyecto_id=proyecto_id,
        component_id=componente_id,
        skip=0,
        limit=500,
    )
    compatible = [
        funcion for funcion in funciones
        if (funcion.codigo or "").strip()
        and (funcion.framework or "playwright").split(":", 1)[0].split("@", 1)[0].strip().lower() == framework
    ]
    if not compatible:
        return script, []

    header = "\n\n".join(
        f"// Funcion reutilizable: {funcion.nombre} ({funcion.scope or 'PROYECTO'})\n{funcion.codigo.strip()}"
        for funcion in compatible
    )
    references = [
        {
            "master_id": str(funcion.master_id),
            "nombre": funcion.nombre,
            "scope": funcion.scope or "PROYECTO",
            "componente_id": str(funcion.componente_id) if funcion.componente_id else None,
            "version": funcion.version,
            "framework": funcion.framework,
        }
        for funcion in compatible
    ]
    return f"{header}\n\n// Script del caso\n{script}", references
