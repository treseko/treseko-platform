from .legacy_common import *


async def validate_script(
    script: str,
    framework: str,
    db: Optional[AsyncSession] = None,
    tipo_prueba: Optional[str] = None,
    titulo: Optional[str] = None,
    datos_caso: Optional[str] = None,
    pasos: Optional[List[Dict[str, Any]]] = None,
    proyecto_id: Optional[UUID] = None,
    component_id: Optional[UUID] = None,
    entorno_id: Optional[UUID] = None,
    dataset_id: Optional[UUID] = None,
) -> dict:
    import ast
    import subprocess
    import tempfile

    checks: List[str] = []
    warnings: List[str] = []
    errors: List[str] = []
    pasos = pasos or []
    framework_key, language_key = _parse_framework_language(framework)
    script_text = script or ""
    script_format = _detect_automation_script_format(script_text, framework_key, language_key)

    if not script_text.strip():
        errors.append("El caso automatizado necesita un script.")
    if not framework_key:
        errors.append("Selecciona un framework de automatizacion.")
    elif framework_key not in OFFICIAL_FRAMEWORK_LANGUAGES:
        errors.append(f"Framework no soportado: {framework}")
    elif language_key not in OFFICIAL_FRAMEWORK_LANGUAGES.get(framework_key, set()):
        errors.append(f"Lenguaje no soportado por {framework_key}: {language_key}")
    else:
        checks.append(f"Framework reconocido: {framework_key}")
        checks.append(f"Lenguaje reconocido: {language_key}")
        if language_key not in LOCAL_WORKER_DEFAULT_LANGUAGES.get(framework_key, set()):
            warnings.append(
                f"{framework_key} + {language_key} es oficial, pero requiere un worker especializado compatible para ejecutar dry-run o ejecuciones automatizadas."
            )
        if framework_key == "playwright":
            if language_key in {"javascript", "typescript"}:
                checks.append(
                    "Formato detectado: Playwright Test Runner"
                    if script_format == "playwright_test"
                    else "Formato detectado: Funcion worker"
                )
            else:
                checks.append(f"Formato detectado: Playwright {language_key}")
        elif framework_key == "cypress":
            checks.append("Formato detectado: Spec Cypress")
        elif framework_key == "puppeteer":
            checks.append("Formato detectado: Script Node/Puppeteer")
        elif framework_key == "selenium":
            checks.append(f"Formato detectado: Selenium {language_key}")

    if not (titulo or "").strip():
        warnings.append("El caso no tiene titulo.")
    elif len((titulo or "").strip()) < 3:
        warnings.append("El titulo del caso es muy corto.")
    else:
        checks.append("Titulo del caso revisado.")

    tipo_normalizado = (tipo_prueba or "").strip().upper()
    if tipo_normalizado and tipo_normalizado not in ["AUTOMATIZADA", "AUTOMATIZADA_AI", "AI AGENT", "AUTOMATIZADA WORKER", "AUTOMATIZADA_WORKER", "MANUAL"]:
        warnings.append(f"Tipo de prueba no reconocido en la validacion: {tipo_prueba}")
    if tipo_normalizado == "MANUAL":
        warnings.append("El caso figura como manual; cambia el metodo de ejecucion a Automatizada para enviarlo al worker.")

    if pasos:
        checks.append(f"{len(pasos)} paso(s) revisado(s).")
    else:
        warnings.append("El caso no tiene pasos definidos; el worker ejecutara solo lo que haga el script.")

    placeholder_pattern = re.compile(r"\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}")
    invalid_placeholder_pattern = re.compile(r"\{\{([^}]*)\}\}")
    placeholder_usages: Dict[str, set[str]] = {}
    js_call_pattern = re.compile(r"(?<![\.\w$])([A-Za-z_$][A-Za-z0-9_$]*)\s*\(")
    js_function_declaration_pattern = re.compile(r"\bfunction\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(")
    js_arrow_declaration_pattern = re.compile(r"\b(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][A-Za-z0-9_$]*)\s*=>")
    allowed_js_calls = {
        "Array",
        "Boolean",
        "Date",
        "Error",
        "JSON",
        "Map",
        "Math",
        "Number",
        "Object",
        "Promise",
        "RegExp",
        "Set",
        "String",
        "afterAll",
        "afterEach",
        "assert",
        "async",
        "beforeAll",
        "beforeEach",
        "clearInterval",
        "clearTimeout",
        "console",
        "describe",
        "expect",
        "import",
        "isFinite",
        "isNaN",
        "log",
        "parseFloat",
        "parseInt",
        "require",
        "setInterval",
        "setTimeout",
        "test",
    }

    def validate_placeholders(label: str, value: Any):
        text = "" if value is None else str(value)
        if not text:
            return
        if text.count("{{") != text.count("}}"):
            errors.append(f"{label}: hay placeholders sin cerrar.")
            return
        for raw in invalid_placeholder_pattern.findall(text):
            token = raw.strip()
            if not placeholder_pattern.fullmatch("{{" + token + "}}"):
                errors.append(f"{label}: placeholder invalido '{{{{{token}}}}}'. Usa letras, numeros, punto, guion o guion bajo.")
        matches = list(placeholder_pattern.finditer(text))
        for match in matches:
            token = match.group(1).strip()
            placeholder_usages.setdefault(token, set()).add(label)
        if matches:
            checks.append(f"{label}: placeholders validos.")

    def parse_key_value_text(text: Optional[str]) -> Dict[str, str]:
        if not text:
            return {}
        result: Dict[str, str] = {}
        pattern = re.compile(r"([A-Za-z0-9_.-]+)\s*=\s*(.*?)(?=\s+[A-Za-z0-9_.-]+\s*=|\r?\n|;|$)", re.S)
        for match in pattern.finditer(str(text)):
            key = match.group(1).strip()
            value = match.group(2).strip()
            if key:
                result[key] = value
        return result

    def normalize_variable_map(values: Any) -> Dict[str, str]:
        if not isinstance(values, dict):
            return {}
        return {str(key): "" if value is None else str(value) for key, value in values.items() if key is not None}

    def has_variable_key(values: Dict[str, str], key: str) -> bool:
        if key in values:
            return True
        lowered = key.lower()
        return any(existing.lower() == lowered for existing in values.keys())

    validate_placeholders("Script", script_text)
    validate_placeholders("Datos especificos del caso", datos_caso)
    for index, paso in enumerate(pasos, start=1):
        validate_placeholders(f"Paso {index} accion", paso.get("accion") or paso.get("action"))
        validate_placeholders(f"Paso {index} datos", paso.get("datos") or paso.get("data"))
        validate_placeholders(f"Paso {index} resultado esperado", paso.get("resultado_esperado") or paso.get("expected"))

    if placeholder_usages:
        checks.append(f"{len(placeholder_usages)} variable(s)/placeholder(s) detectada(s).")
        if db is None or proyecto_id is None:
            warnings.append("No se pudo validar si las variables existen porque falta el contexto del proyecto.")
        else:
            try:
                available_variables: Dict[str, str] = {}
                env_variables: Dict[str, str] = {}
                dataset_variables: Dict[str, str] = {}
                component_variables: Dict[str, str] = {}
                case_variables = parse_key_value_text(datos_caso)

                entorno = None
                if entorno_id:
                    entorno_result = await db.execute(
                        select(models.Entorno).filter(
                            models.Entorno.id == entorno_id,
                            models.Entorno.proyecto_id == proyecto_id,
                            models.Entorno.activo == True,
                        )
                    )
                    entorno = entorno_result.scalar_one_or_none()
                    if entorno is None:
                        errors.append("El ambiente seleccionado para validar variables no existe o esta inactivo.")
                else:
                    entorno_result = await db.execute(
                        select(models.Entorno)
                        .filter(models.Entorno.proyecto_id == proyecto_id, models.Entorno.activo == True)
                        .limit(1)
                    )
                    entorno = entorno_result.scalar_one_or_none()

                if entorno is not None:
                    raw_env_variables = normalize_variable_map(entorno.variables)
                    env_variables.update({
                        "ENV.ID": str(entorno.id),
                        "ENV.NAME": entorno.nombre or "",
                        "ENV.BASE_URL": entorno.url or "",
                        "ENV.URL": entorno.url or "",
                        "ENV.VERSION": entorno.version or "",
                        "ENV.STATUS": entorno.status or "",
                    })
                    env_variables.update(raw_env_variables)
                    env_variables.update({f"ENV.{key}": value for key, value in raw_env_variables.items()})
                    if entorno.url:
                        env_variables.setdefault("base_url", entorno.url)
                        env_variables.setdefault("BASE_URL", entorno.url)

                    dataset = None
                    if dataset_id:
                        dataset_result = await db.execute(
                            select(models.EntornoDataset).filter(
                                models.EntornoDataset.id == dataset_id,
                                models.EntornoDataset.entorno_id == entorno.id,
                                models.EntornoDataset.activo == True,
                            )
                        )
                        dataset = dataset_result.scalar_one_or_none()
                        if dataset is None:
                            errors.append("El dataset seleccionado para validar variables no existe o esta inactivo.")
                    else:
                        dataset_result = await db.execute(
                            select(models.EntornoDataset)
                            .filter(models.EntornoDataset.entorno_id == entorno.id, models.EntornoDataset.activo == True)
                            .order_by(models.EntornoDataset.es_default.desc(), models.EntornoDataset.fecha_creacion.asc())
                            .limit(1)
                        )
                        dataset = dataset_result.scalar_one_or_none()
                    if dataset is not None:
                        raw_dataset_variables = normalize_variable_map(dataset.variables)
                        dataset_variables.update(raw_dataset_variables)
                        dataset_variables.update({f"DATASET.{key}": value for key, value in raw_dataset_variables.items()})

                if component_id:
                    component_result = await db.execute(
                        select(models.Componente).filter(
                            models.Componente.id == component_id,
                            models.Componente.proyecto_id == proyecto_id,
                            models.Componente.activo == True,
                        )
                    )
                    componente = component_result.scalar_one_or_none()
                    if componente is None:
                        errors.append("El componente seleccionado para validar variables no existe o esta inactivo.")
                    else:
                        raw_component_variables = normalize_variable_map(getattr(componente, "variables", None))
                        component_variables.update(raw_component_variables)
                        component_variables.update({
                            "COMPONENT.ID": str(componente.id),
                            "COMPONENT.CODE": getattr(componente, "codigo", "") or "",
                            "COMPONENT.NAME": componente.nombre or "",
                        })
                        component_variables.update({f"COMPONENT.{key}": value for key, value in raw_component_variables.items()})

                available_variables.update(env_variables)
                available_variables.update(component_variables)
                available_variables.update(dataset_variables)
                available_variables.update(case_variables)

                missing_variables = sorted(
                    token for token in placeholder_usages.keys()
                    if not has_variable_key(available_variables, token)
                )
                if missing_variables:
                    details = [
                        f"{token} ({', '.join(sorted(placeholder_usages[token]))})"
                        for token in missing_variables
                    ]
                    checks.append("Variables faltantes en el contexto: " + ", ".join(missing_variables))
                    errors.append(
                        "Variables no disponibles para esta prueba: "
                        + "; ".join(details)
                        + ". Crealas en el ambiente/dataset, variables tecnicas del componente o datos especificos del caso."
                    )
                else:
                    checks.append("Variables disponibles en ambiente, dataset, componente o datos del caso.")
            except Exception:
                warnings.append("No se pudieron revisar variables disponibles; la sintaxis se valido igualmente.")

    if db is not None and proyecto_id is not None:
        try:
            funciones = await get_funciones_proyecto(
                db,
                proyecto_id=proyecto_id,
                component_id=component_id,
                include_componentes=component_id is None,
                limit=500,
            )
            function_names = sorted({f.nombre for f in funciones if f.nombre})
            used_functions = [
                name for name in function_names
                if re.search(rf"\b{re.escape(name)}\s*\(", script_text)
            ]
            declared_functions = set(js_function_declaration_pattern.findall(script_text))
            declared_functions.update(js_arrow_declaration_pattern.findall(script_text))
            called_functions = set(js_call_pattern.findall(script_text))
            missing_functions = sorted(
                called_functions
                - set(function_names)
                - declared_functions
                - allowed_js_calls
            )
            if function_names:
                checks.append(f"{len(function_names)} funcion(es) reutilizable(s) disponibles para este contexto.")
            if used_functions:
                checks.append("Funciones detectadas en el script: " + ", ".join(used_functions))
            if missing_functions:
                checks.append("Funciones faltantes en el contexto: " + ", ".join(missing_functions))
                errors.append(
                    "Funciones no disponibles en este proyecto/componente: "
                    + ", ".join(missing_functions)
                    + ". Crea la funcion reutilizable, cambia el alcance o corrige el nombre antes de ejecutar."
                )
        except Exception:
            warnings.append("No se pudieron revisar funciones reutilizables; la sintaxis se valido igualmente.")

    if errors:
        return {
            "valid": False,
            "error": " ".join(errors),
            "warnings": warnings,
            "checks": checks,
        }

    if framework_key == "selenium":
        try:
            ast.parse(script_text)
            checks.append("Sintaxis Python valida.")
        except SyntaxError as e:
            return {
                "valid": False,
                "error": f"Error de sintaxis: {e.msg} (linea {e.lineno})",
                "warnings": warnings,
                "checks": checks,
            }
    elif framework_key in ["playwright", "cypress", "puppeteer"]:
        temp_path = None
        try:
            with tempfile.NamedTemporaryFile(mode='w', suffix='.js', delete=False) as f:
                f.write(script_text)
                temp_path = f.name

            result = subprocess.run(
                ['node', '--check', temp_path],
                capture_output=True,
                text=True,
                timeout=5
            )

            if result.returncode == 0:
                checks.append("Sintaxis JavaScript valida.")
            else:
                return {
                    "valid": False,
                    "error": result.stderr.strip() or "Error de sintaxis",
                    "warnings": warnings,
                    "checks": checks,
                }
        except subprocess.TimeoutExpired:
            return {"valid": False, "error": "Timeout al validar script", "warnings": warnings, "checks": checks}
        except FileNotFoundError:
            return {"valid": False, "error": "Node.js no disponible para validacion", "warnings": warnings, "checks": checks}
        except Exception as e:
            return {"valid": False, "error": str(e), "warnings": warnings, "checks": checks}
        finally:
            if temp_path and os.path.exists(temp_path):
                os.unlink(temp_path)

    return {
        "valid": True,
        "message": "Script y prueba validos" if not warnings else "Script valido con advertencias",
        "warnings": warnings,
        "checks": checks,
    }
