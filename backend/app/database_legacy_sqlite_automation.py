import json

from sqlalchemy import inspect, text


async def migrate_automation_schema(conn, get_columns, get_column_info, backend_dir):
    build_columns = await conn.run_sync(get_columns, "builds")
    if build_columns and "codigo" not in build_columns:
        await conn.execute(text("ALTER TABLE builds ADD COLUMN codigo VARCHAR(20)"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_builds_codigo ON builds (codigo)"))
    if build_columns:
        await conn.execute(text(
            "UPDATE builds "
            "SET codigo = 'BLD-' || lower(substr(replace(id, '-', ''), 1, 8)) "
            "WHERE codigo IS NULL OR codigo = ''"
        ))
    if build_columns and "componente_id" not in build_columns:
        await conn.execute(text("ALTER TABLE builds ADD COLUMN componente_id CHAR(32)"))
        await conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_builds_componente_id "
                "ON builds (componente_id)"
            )
        )
    if build_columns and "oculto" not in build_columns:
        await conn.execute(text("ALTER TABLE builds ADD COLUMN oculto BOOLEAN DEFAULT 0 NOT NULL"))

    build_caso_columns = await conn.run_sync(get_columns, "build_casos")
    if not build_caso_columns:
        await conn.execute(text(
            "CREATE TABLE IF NOT EXISTS build_casos ("
            "id CHAR(32) PRIMARY KEY, "
            "build_id CHAR(32) NOT NULL, "
            "caso_id CHAR(32) NOT NULL, "
            "fecha_inclusion DATETIME DEFAULT CURRENT_TIMESTAMP, "
            "UNIQUE(build_id, caso_id), "
            "FOREIGN KEY(build_id) REFERENCES builds(id) ON DELETE CASCADE, "
            "FOREIGN KEY(caso_id) REFERENCES casos_prueba(id) ON DELETE CASCADE"
            ")"
        ))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_build_casos_build_id ON build_casos (build_id)"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_build_casos_caso_id ON build_casos (caso_id)"))

    test_run_columns = await conn.run_sync(get_columns, "test_runs")
    if test_run_columns and "build_id" not in test_run_columns:
        await conn.execute(text("ALTER TABLE test_runs ADD COLUMN build_id CHAR(32)"))
        await conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_test_runs_build_id "
                "ON test_runs (build_id)"
            )
        )
    if test_run_columns and "origen" not in test_run_columns:
        await conn.execute(text("ALTER TABLE test_runs ADD COLUMN origen VARCHAR(30) DEFAULT 'MANUAL' NOT NULL"))
    if test_run_columns and "external_run_id" not in test_run_columns:
        await conn.execute(text("ALTER TABLE test_runs ADD COLUMN external_run_id VARCHAR(255)"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_test_runs_external_run_id ON test_runs (external_run_id)"))

    api_key_columns = await conn.run_sync(get_columns, "api_keys")
    if not api_key_columns:
        await conn.execute(text(
            "CREATE TABLE IF NOT EXISTS api_keys ("
            "id CHAR(32) NOT NULL PRIMARY KEY, "
            "usuario_id CHAR(32) NOT NULL, "
            "nombre VARCHAR(100) NOT NULL, "
            "key_hash VARCHAR(128) NOT NULL UNIQUE, "
            "key_prefix VARCHAR(20) NOT NULL, "
            "activo BOOLEAN DEFAULT 1 NOT NULL, "
            "fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP, "
            "ultimo_uso DATETIME, "
            "FOREIGN KEY(usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE"
            ")"
        ))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_api_keys_usuario_id ON api_keys (usuario_id)"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_api_keys_key_hash ON api_keys (key_hash)"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_api_keys_key_prefix ON api_keys (key_prefix)"))

    caso_columns = await conn.run_sync(get_columns, "casos_prueba")
    if caso_columns:
        if "script_automatizado" not in caso_columns:
            await conn.execute(text("ALTER TABLE casos_prueba ADD COLUMN script_automatizado TEXT"))
        if "framework" not in caso_columns:
            await conn.execute(text("ALTER TABLE casos_prueba ADD COLUMN framework VARCHAR(50)"))

    funciones_columns = await conn.run_sync(get_columns, "funciones_automatizadas")
    if not funciones_columns:
        await conn.execute(text(
            "CREATE TABLE IF NOT EXISTS funciones_automatizadas ("
            "id CHAR(32) PRIMARY KEY, "
            "master_id CHAR(32) NOT NULL, "
            "proyecto_id CHAR(32) NOT NULL, "
            "suite_id CHAR(32), "
            "componente_id CHAR(32), "
            "scope VARCHAR(20) DEFAULT 'PROYECTO' NOT NULL, "
            "nombre VARCHAR(100) NOT NULL, "
            "descripcion TEXT, "
            "codigo TEXT NOT NULL, "
            "parametros JSON DEFAULT '[]', "
            "framework VARCHAR(50) DEFAULT 'playwright' NOT NULL, "
            "version INTEGER DEFAULT 1 NOT NULL, "
            "creado_por CHAR(32) NOT NULL, "
            "fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP, "
            "FOREIGN KEY(proyecto_id) REFERENCES proyectos(id) ON DELETE CASCADE, "
            "FOREIGN KEY(suite_id) REFERENCES suites(id) ON DELETE CASCADE, "
            "FOREIGN KEY(componente_id) REFERENCES componentes(id) ON DELETE CASCADE"
            ")"
        ))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_funciones_automatizadas_master_id ON funciones_automatizadas (master_id)"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_funciones_automatizadas_proyecto_id ON funciones_automatizadas (proyecto_id)"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_funciones_automatizadas_suite_id ON funciones_automatizadas (suite_id)"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_funciones_automatizadas_componente_id ON funciones_automatizadas (componente_id)"))
    else:
        if funciones_columns and "componente_id" not in funciones_columns:
            await conn.execute(text("ALTER TABLE funciones_automatizadas ADD COLUMN componente_id CHAR(32)"))
            await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_funciones_automatizadas_componente_id ON funciones_automatizadas (componente_id)"))
        if funciones_columns and "scope" not in funciones_columns:
            await conn.execute(text("ALTER TABLE funciones_automatizadas ADD COLUMN scope VARCHAR(20) DEFAULT 'PROYECTO' NOT NULL"))

    variables_columns = await conn.run_sync(get_columns, "variables_ejecucion")
    if variables_columns:
        result = await conn.execute(text("SELECT * FROM variables_ejecucion"))
        legacy_rows = [dict(row) for row in result.mappings().all()]
        if legacy_rows:
            export_path = BACKEND_DIR / "legacy_variables_export.json"
            export_path.write_text(
                json.dumps(legacy_rows, ensure_ascii=False, indent=2, default=str),
                encoding="utf-8",
            )
        await conn.execute(text("DROP TABLE IF EXISTS variables_ejecucion"))

    await conn.execute(text(
        "CREATE TABLE IF NOT EXISTS automation_runners ("
        "id CHAR(32) NOT NULL PRIMARY KEY, "
        "nombre VARCHAR(150) NOT NULL, "
        "tipo VARCHAR(30) DEFAULT 'LOCAL' NOT NULL, "
        "token_hash VARCHAR(128) NOT NULL UNIQUE, "
        "estado VARCHAR(30) DEFAULT 'ONLINE' NOT NULL, "
        "capabilities JSON DEFAULT '{}', "
        "activo BOOLEAN DEFAULT 1 NOT NULL, "
        "ultimo_heartbeat DATETIME DEFAULT CURRENT_TIMESTAMP, "
        "fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP"
        ")"
    ))
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_automation_runners_token_hash ON automation_runners (token_hash)"))
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_automation_runners_estado ON automation_runners (estado)"))
    await conn.execute(text(
        "CREATE TABLE IF NOT EXISTS automation_runner_registration_tokens ("
        "id CHAR(32) NOT NULL PRIMARY KEY, "
        "token_hash VARCHAR(128) NOT NULL UNIQUE, "
        "nombre VARCHAR(150) NOT NULL, "
        "tipo VARCHAR(30) DEFAULT 'LOCAL' NOT NULL, "
        "expires_at DATETIME NOT NULL, "
        "used_at DATETIME, "
        "used_runner_id CHAR(32), "
        "creado_por CHAR(32) NOT NULL, "
        "fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP, "
        "FOREIGN KEY(used_runner_id) REFERENCES automation_runners(id) ON DELETE SET NULL"
        ")"
    ))
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_automation_runner_registration_tokens_token_hash ON automation_runner_registration_tokens (token_hash)"))
    await conn.execute(text(
        "CREATE TABLE IF NOT EXISTS automation_runner_pairing_requests ("
        "id CHAR(32) NOT NULL PRIMARY KEY, "
        "code VARCHAR(20) NOT NULL UNIQUE, "
        "pairing_token_hash VARCHAR(128) NOT NULL, "
        "nombre VARCHAR(150) NOT NULL, "
        "tipo VARCHAR(30) DEFAULT 'LOCAL' NOT NULL, "
        "capabilities JSON DEFAULT '{}', "
        "estado VARCHAR(30) DEFAULT 'PENDING' NOT NULL, "
        "expires_at DATETIME NOT NULL, "
        "approved_at DATETIME, "
        "denied_at DATETIME, "
        "approved_by CHAR(32), "
        "runner_id CHAR(32), "
        "runner_token VARCHAR(300), "
        "fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP, "
        "FOREIGN KEY(runner_id) REFERENCES automation_runners(id) ON DELETE SET NULL"
        ")"
    ))
    pairing_columns = await conn.run_sync(get_columns, "automation_runner_pairing_requests")
    if pairing_columns and "runner_token" not in pairing_columns:
        await conn.execute(text("ALTER TABLE automation_runner_pairing_requests ADD COLUMN runner_token VARCHAR(300)"))
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_automation_runner_pairing_requests_code ON automation_runner_pairing_requests (code)"))
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_automation_runner_pairing_requests_pairing_token_hash ON automation_runner_pairing_requests (pairing_token_hash)"))
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_automation_runner_pairing_requests_estado ON automation_runner_pairing_requests (estado)"))
    await conn.execute(text(
        "CREATE TABLE IF NOT EXISTS automation_jobs ("
        "id CHAR(32) NOT NULL PRIMARY KEY, "
        "job_type VARCHAR(30) DEFAULT 'EXECUTION' NOT NULL, "
        "test_run_id CHAR(32), "
        "ejecucion_id CHAR(32), "
        "caso_id CHAR(32), "
        "build_id CHAR(32), "
        "runner_id CHAR(32), "
        "estado VARCHAR(30) DEFAULT 'PENDING' NOT NULL, "
        "required_framework VARCHAR(50) DEFAULT 'playwright' NOT NULL, "
        "required_language VARCHAR(30) DEFAULT 'javascript' NOT NULL, "
        "required_runtime VARCHAR(100), "
        "timeout_seconds INTEGER DEFAULT 300 NOT NULL, "
        "payload_congelado JSON DEFAULT '{}', "
        "logs TEXT, "
        "error_message TEXT, "
        "metadata_resultado JSON DEFAULT '{}', "
        "creado_por CHAR(32) NOT NULL, "
        "fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP, "
        "fecha_claim DATETIME, "
        "fecha_inicio DATETIME, "
        "fecha_fin DATETIME, "
        "FOREIGN KEY(test_run_id) REFERENCES test_runs(id) ON DELETE CASCADE, "
        "FOREIGN KEY(ejecucion_id) REFERENCES ejecuciones_casos(id) ON DELETE CASCADE, "
        "FOREIGN KEY(caso_id) REFERENCES casos_prueba(id), "
        "FOREIGN KEY(build_id) REFERENCES builds(id) ON DELETE SET NULL, "
        "FOREIGN KEY(runner_id) REFERENCES automation_runners(id) ON DELETE SET NULL"
        ")"
    ))
    automation_job_columns = await conn.run_sync(get_column_info, "automation_jobs")
    automation_job_column_map = {column["name"]: column for column in automation_job_columns}
    needs_automation_job_rebuild = (
        "job_type" not in automation_job_column_map
        or any(
            automation_job_column_map.get(column_name, {}).get("nullable") is False
            for column_name in ("test_run_id", "ejecucion_id", "caso_id")
        )
    )
    if needs_automation_job_rebuild:
        has_job_type = "job_type" in automation_job_column_map
        await conn.execute(text("PRAGMA foreign_keys=OFF"))
        await conn.execute(text("ALTER TABLE automation_jobs RENAME TO automation_jobs_old"))
        await conn.execute(text(
            "CREATE TABLE automation_jobs ("
            "id CHAR(32) NOT NULL PRIMARY KEY, "
            "job_type VARCHAR(30) DEFAULT 'EXECUTION' NOT NULL, "
            "test_run_id CHAR(32), "
            "ejecucion_id CHAR(32), "
            "caso_id CHAR(32), "
            "build_id CHAR(32), "
            "runner_id CHAR(32), "
            "estado VARCHAR(30) DEFAULT 'PENDING' NOT NULL, "
            "required_framework VARCHAR(50) DEFAULT 'playwright' NOT NULL, "
            "required_language VARCHAR(30) DEFAULT 'javascript' NOT NULL, "
            "required_runtime VARCHAR(100), "
            "timeout_seconds INTEGER DEFAULT 300 NOT NULL, "
            "payload_congelado JSON DEFAULT '{}', "
            "logs TEXT, "
            "error_message TEXT, "
            "metadata_resultado JSON DEFAULT '{}', "
            "creado_por CHAR(32) NOT NULL, "
            "fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP, "
            "fecha_claim DATETIME, "
            "fecha_inicio DATETIME, "
            "fecha_fin DATETIME, "
            "FOREIGN KEY(test_run_id) REFERENCES test_runs(id) ON DELETE CASCADE, "
            "FOREIGN KEY(ejecucion_id) REFERENCES ejecuciones_casos(id) ON DELETE CASCADE, "
            "FOREIGN KEY(caso_id) REFERENCES casos_prueba(id), "
            "FOREIGN KEY(build_id) REFERENCES builds(id) ON DELETE SET NULL, "
            "FOREIGN KEY(runner_id) REFERENCES automation_runners(id) ON DELETE SET NULL"
            ")"
        ))
        old_job_type_expression = "COALESCE(job_type, 'EXECUTION')" if has_job_type else "'EXECUTION'"
        old_language_expression = "COALESCE(required_language, 'javascript')" if "required_language" in automation_job_column_map else "'javascript'"
        await conn.execute(text(
            "INSERT INTO automation_jobs "
            "(id, job_type, test_run_id, ejecucion_id, caso_id, build_id, runner_id, estado, "
            "required_framework, required_language, required_runtime, timeout_seconds, payload_congelado, logs, "
            "error_message, metadata_resultado, creado_por, fecha_creacion, fecha_claim, fecha_inicio, fecha_fin) "
            f"SELECT id, {old_job_type_expression}, test_run_id, ejecucion_id, caso_id, build_id, runner_id, estado, "
            f"required_framework, {old_language_expression}, required_runtime, timeout_seconds, payload_congelado, logs, "
            "error_message, metadata_resultado, creado_por, fecha_creacion, fecha_claim, fecha_inicio, fecha_fin "
            "FROM automation_jobs_old"
        ))
        await conn.execute(text("DROP TABLE automation_jobs_old"))
        await conn.execute(text("PRAGMA foreign_keys=ON"))
    elif "required_language" not in automation_job_column_map:
        await conn.execute(text("ALTER TABLE automation_jobs ADD COLUMN required_language VARCHAR(30) DEFAULT 'javascript' NOT NULL"))
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_automation_jobs_test_run_id ON automation_jobs (test_run_id)"))
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_automation_jobs_ejecucion_id ON automation_jobs (ejecucion_id)"))
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_automation_jobs_caso_id ON automation_jobs (caso_id)"))
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_automation_jobs_build_id ON automation_jobs (build_id)"))
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_automation_jobs_runner_id ON automation_jobs (runner_id)"))
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_automation_jobs_estado ON automation_jobs (estado)"))
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_automation_jobs_job_type ON automation_jobs (job_type)"))
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_automation_jobs_required_language ON automation_jobs (required_language)"))

    if await conn.run_sync(lambda sync_conn: inspect(sync_conn).has_table("organizacion_miembros")) and await conn.run_sync(lambda sync_conn: inspect(sync_conn).has_table("proyecto_miembros")):
        await conn.execute(text(
            "INSERT OR IGNORE INTO organizacion_miembros "
            "(id, organizacion_id, usuario_id, rol_cliente, fecha_asignacion) "
            "SELECT lower(hex(randomblob(16))), p.organizacion_id, pm.usuario_id, "
            "'MEMBER', "
            "CURRENT_TIMESTAMP "
            "FROM proyecto_miembros pm "
            "JOIN proyectos p ON p.id = pm.proyecto_id "
            "WHERE p.organizacion_id IS NOT NULL"
        ))

    if (
        await conn.run_sync(lambda sync_conn: inspect(sync_conn).has_table("ejecuciones_casos"))
        and await conn.run_sync(lambda sync_conn: inspect(sync_conn).has_table("test_runs"))
        and await conn.run_sync(lambda sync_conn: inspect(sync_conn).has_table("snapshots_pasos"))
    ):
        await conn.execute(text(
            "UPDATE ejecuciones_casos "
            "SET estado_resultado = 'BLOQUEADO', "
            "observaciones = COALESCE(observaciones, 'Ejecución IA interrumpida antes de enviar al engine') "
            "WHERE estado_resultado = 'EJECUTANDO_AI' "
            "AND test_run_id IN (SELECT id FROM test_runs WHERE origen = 'IA') "
            "AND NOT EXISTS ("
            "  SELECT 1 FROM snapshots_pasos sp "
            "  WHERE sp.ejecucion_caso_id = ejecuciones_casos.id "
            "  AND sp.estado_paso IN ('PASO', 'FALLO', 'BLOQUEADO')"
            ")"
        ))
