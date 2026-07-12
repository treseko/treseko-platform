import json

from sqlalchemy import inspect, text


async def migrate_testing_execution_schema(conn, get_columns, get_column_info, backend_dir):
    caso_columns = await conn.run_sync(get_columns, "casos_prueba")
    if caso_columns:
        if "codigo" not in caso_columns:
            await conn.execute(text("ALTER TABLE casos_prueba ADD COLUMN codigo VARCHAR(20)"))
        if "ultimo_resultado" not in caso_columns:
            await conn.execute(text("ALTER TABLE casos_prueba ADD COLUMN ultimo_resultado VARCHAR(20)"))
        if "ultima_ejecucion_por" not in caso_columns:
            await conn.execute(text("ALTER TABLE casos_prueba ADD COLUMN ultima_ejecucion_por CHAR(32)"))
        if "ultima_ejecucion_fecha" not in caso_columns:
            await conn.execute(text("ALTER TABLE casos_prueba ADD COLUMN ultima_ejecucion_fecha DATETIME"))
        await conn.execute(text("DROP INDEX IF EXISTS ix_casos_prueba_codigo"))
        await conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_casos_prueba_codigo "
                "ON casos_prueba (codigo)"
            )
        )
        if "descripcion" not in caso_columns:
            await conn.execute(text("ALTER TABLE casos_prueba ADD COLUMN descripcion TEXT"))
        if "postcondiciones" not in caso_columns:
            await conn.execute(text("ALTER TABLE casos_prueba ADD COLUMN postcondiciones TEXT"))
        if "criticidad" not in caso_columns:
            await conn.execute(text("ALTER TABLE casos_prueba ADD COLUMN criticidad VARCHAR(10) DEFAULT 'MEDIA'"))
        if "dataset" not in caso_columns:
            await conn.execute(text("ALTER TABLE casos_prueba ADD COLUMN dataset JSON DEFAULT '[]'"))
        if "etiquetas" not in caso_columns:
            await conn.execute(text("ALTER TABLE casos_prueba ADD COLUMN etiquetas JSON DEFAULT '[]'"))
        if "activo" not in caso_columns:
            await conn.execute(text("ALTER TABLE casos_prueba ADD COLUMN activo BOOLEAN DEFAULT 1 NOT NULL"))
        if "componente_id" not in caso_columns:
            await conn.execute(text("ALTER TABLE casos_prueba ADD COLUMN componente_id CHAR(32)"))
            await conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_casos_prueba_componente_id "
                    "ON casos_prueba (componente_id)"
                )
            )

    test_run_columns = await conn.run_sync(get_columns, "test_runs")
    if test_run_columns and "entorno_id" not in test_run_columns:
        await conn.execute(text("ALTER TABLE test_runs ADD COLUMN entorno_id CHAR(32)"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_test_runs_entorno_id ON test_runs (entorno_id)"))
    if test_run_columns and "dataset_id" not in test_run_columns:
        await conn.execute(text("ALTER TABLE test_runs ADD COLUMN dataset_id CHAR(32)"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_test_runs_dataset_id ON test_runs (dataset_id)"))
    if test_run_columns and "variables_resueltas" not in test_run_columns:
        await conn.execute(text("ALTER TABLE test_runs ADD COLUMN variables_resueltas JSON DEFAULT '{}'"))
    if test_run_columns and "datasets_resueltos" not in test_run_columns:
        await conn.execute(text("ALTER TABLE test_runs ADD COLUMN datasets_resueltos JSON DEFAULT '{}'"))

    caso_columns = await conn.run_sync(get_columns, "casos_prueba")
    suite_columns = await conn.run_sync(get_columns, "suites")
    if suite_columns and "componente_id" in suite_columns and "componente_id" in caso_columns:
        await conn.execute(text(
            "UPDATE suites "
            "SET componente_id = ("
            "SELECT casos_prueba.componente_id FROM casos_prueba "
            "WHERE casos_prueba.suite_id = suites.id AND casos_prueba.componente_id IS NOT NULL LIMIT 1"
            ") "
            "WHERE componente_id IS NULL"
        ))
        for _ in range(5):
            await conn.execute(text(
                "UPDATE suites "
                "SET componente_id = ("
                "SELECT child.componente_id FROM suites child "
                "WHERE child.parent_id = suites.id AND child.componente_id IS NOT NULL LIMIT 1"
                ") "
                "WHERE componente_id IS NULL"
            ))

    caso_columns = await conn.run_sync(get_columns, "casos_prueba")
    suite_columns = await conn.run_sync(get_columns, "suites")
    build_caso_columns = await conn.run_sync(get_columns, "build_casos")
    if (
        caso_columns and suite_columns
        and "activo" in caso_columns and "suite_id" in caso_columns
        and "activo" in suite_columns
    ):
        await conn.execute(text(
            "UPDATE casos_prueba "
            "SET activo = 0 "
            "WHERE activo = 1 "
            "AND suite_id IN (SELECT id FROM suites WHERE activo = 0)"
        ))
    if build_caso_columns and caso_columns:
        await conn.execute(text(
            "DELETE FROM build_casos "
            "WHERE caso_id IN ("
            "SELECT casos_prueba.id FROM casos_prueba "
            "LEFT JOIN suites ON suites.id = casos_prueba.suite_id "
            "WHERE casos_prueba.activo = 0 "
            "OR (casos_prueba.suite_id IS NOT NULL AND COALESCE(suites.activo, 0) = 0)"
            ")"
        ))

    paso_columns = await conn.run_sync(get_columns, "pasos_prueba")
    if paso_columns and "datos" not in paso_columns:
        await conn.execute(text("ALTER TABLE pasos_prueba ADD COLUMN datos TEXT"))

    ejecucion_columns = await conn.run_sync(get_columns, "ejecuciones_casos")
    if ejecucion_columns and "observaciones" not in ejecucion_columns:
        await conn.execute(text("ALTER TABLE ejecuciones_casos ADD COLUMN observaciones TEXT"))
    if ejecucion_columns:
        if "ai_report" not in ejecucion_columns:
            await conn.execute(text("ALTER TABLE ejecuciones_casos ADD COLUMN ai_report JSON DEFAULT '{}'"))
        if "ai_confidence" not in ejecucion_columns:
            await conn.execute(text("ALTER TABLE ejecuciones_casos ADD COLUMN ai_confidence INTEGER"))
        if "ai_consensus" not in ejecucion_columns:
            await conn.execute(text("ALTER TABLE ejecuciones_casos ADD COLUMN ai_consensus VARCHAR(30)"))
        if "ai_failure_category" not in ejecucion_columns:
            await conn.execute(text("ALTER TABLE ejecuciones_casos ADD COLUMN ai_failure_category VARCHAR(80)"))
        if "ai_human_review_required" not in ejecucion_columns:
            await conn.execute(text("ALTER TABLE ejecuciones_casos ADD COLUMN ai_human_review_required BOOLEAN DEFAULT 0"))
        if "execution_mode" not in ejecucion_columns:
            await conn.execute(text("ALTER TABLE ejecuciones_casos ADD COLUMN execution_mode VARCHAR(20) DEFAULT 'MANUAL' NOT NULL"))
            await conn.execute(text(
                "UPDATE ejecuciones_casos SET execution_mode = 'IA' "
                "WHERE ai_report IS NOT NULL AND ai_report NOT IN ('{}', 'null', '')"
            ))
        if "ai_review_status" not in ejecucion_columns:
            await conn.execute(text("ALTER TABLE ejecuciones_casos ADD COLUMN ai_review_status VARCHAR(40) DEFAULT 'NO_REQUIERE_REVISION' NOT NULL"))
            await conn.execute(text(
                "UPDATE ejecuciones_casos SET ai_review_status = 'REQUIERE_REVISION' "
                "WHERE COALESCE(ai_human_review_required, 0) = 1"
            ))
        if "ai_reviewed_by" not in ejecucion_columns:
            await conn.execute(text("ALTER TABLE ejecuciones_casos ADD COLUMN ai_reviewed_by CHAR(32)"))
        if "ai_reviewed_at" not in ejecucion_columns:
            await conn.execute(text("ALTER TABLE ejecuciones_casos ADD COLUMN ai_reviewed_at DATETIME"))
        if "ai_review_note" not in ejecucion_columns:
            await conn.execute(text("ALTER TABLE ejecuciones_casos ADD COLUMN ai_review_note TEXT"))
        await conn.execute(text("UPDATE ejecuciones_casos SET estado_resultado = 'PASO' WHERE estado_resultado IN ('WIPE', 'WIP')"))

    snapshot_columns = await conn.run_sync(get_columns, "snapshots_pasos")
    if snapshot_columns:
        await conn.execute(text("UPDATE snapshots_pasos SET estado_paso = 'PASO' WHERE estado_paso IN ('WIPE', 'WIP')"))
        if "datos_congelados" not in snapshot_columns:
            await conn.execute(text("ALTER TABLE snapshots_pasos ADD COLUMN datos_congelados TEXT"))
            snapshot_columns = await conn.run_sync(get_columns, "snapshots_pasos")
    if snapshot_columns and "paso_id" not in snapshot_columns:
        await conn.execute(text("ALTER TABLE snapshots_pasos ADD COLUMN paso_id CHAR(32)"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_snapshots_pasos_paso_id ON snapshots_pasos (paso_id)"))
        await conn.execute(text(
            "UPDATE snapshots_pasos "
            "SET paso_id = ("
            "SELECT pasos_prueba.id "
            "FROM pasos_prueba "
            "JOIN ejecuciones_casos ON ejecuciones_casos.caso_id = pasos_prueba.caso_id "
            "WHERE ejecuciones_casos.id = snapshots_pasos.ejecucion_caso_id "
            "AND pasos_prueba.numero_paso = snapshots_pasos.numero_paso "
            "LIMIT 1"
            ") "
            "WHERE paso_id IS NULL"
        ))
    elif snapshot_columns:
        await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_snapshots_pasos_paso_id ON snapshots_pasos (paso_id)"))
        await conn.execute(text(
            "UPDATE snapshots_pasos "
            "SET paso_id = ("
            "SELECT pasos_prueba.id "
            "FROM pasos_prueba "
            "JOIN ejecuciones_casos ON ejecuciones_casos.caso_id = pasos_prueba.caso_id "
            "WHERE ejecuciones_casos.id = snapshots_pasos.ejecucion_caso_id "
            "AND pasos_prueba.numero_paso = snapshots_pasos.numero_paso "
            "LIMIT 1"
            ") "
            "WHERE paso_id IS NULL"
        ))

    await conn.execute(text(
        "CREATE TABLE IF NOT EXISTS app_settings ("
        "key VARCHAR(100) NOT NULL PRIMARY KEY, "
        "value JSON NOT NULL, "
        "updated_at DATETIME DEFAULT CURRENT_TIMESTAMP"
        ")"
    ))
    await conn.execute(text(
        "CREATE TABLE IF NOT EXISTS attachments ("
        "id CHAR(32) NOT NULL PRIMARY KEY, "
        "filename_original VARCHAR(255) NOT NULL, "
        "content_type VARCHAR(100) NOT NULL, "
        "size INTEGER NOT NULL, "
        "sha256 VARCHAR(64) NOT NULL, "
        "storage_path TEXT NOT NULL, "
        "public_url TEXT NOT NULL, "
        "scope VARCHAR(50) NOT NULL, "
        "created_by CHAR(32) NOT NULL, "
        "created_at DATETIME DEFAULT CURRENT_TIMESTAMP"
        ")"
    ))
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_attachments_sha256 ON attachments (sha256)"))
    await conn.execute(text(
        "CREATE TABLE IF NOT EXISTS paso_attachments ("
        "id CHAR(32) NOT NULL PRIMARY KEY, "
        "paso_id CHAR(32) NOT NULL, "
        "attachment_id CHAR(32) NOT NULL, "
        "tipo VARCHAR(50) NOT NULL, "
        "created_at DATETIME DEFAULT CURRENT_TIMESTAMP, "
        "CONSTRAINT unique_paso_attachment_tipo UNIQUE (paso_id, attachment_id, tipo), "
        "FOREIGN KEY(paso_id) REFERENCES pasos_prueba(id) ON DELETE CASCADE, "
        "FOREIGN KEY(attachment_id) REFERENCES attachments(id) ON DELETE CASCADE"
        ")"
    ))
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_paso_attachments_paso_id ON paso_attachments (paso_id)"))
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_paso_attachments_attachment_id ON paso_attachments (attachment_id)"))
    await conn.execute(text(
        "CREATE TABLE IF NOT EXISTS snapshot_attachments ("
        "id CHAR(32) NOT NULL PRIMARY KEY, "
        "snapshot_id CHAR(32) NOT NULL, "
        "attachment_id CHAR(32) NOT NULL, "
        "tipo VARCHAR(50) NOT NULL, "
        "created_at DATETIME DEFAULT CURRENT_TIMESTAMP, "
        "CONSTRAINT unique_snapshot_attachment_tipo UNIQUE (snapshot_id, attachment_id, tipo), "
        "FOREIGN KEY(snapshot_id) REFERENCES snapshots_pasos(id) ON DELETE CASCADE, "
        "FOREIGN KEY(attachment_id) REFERENCES attachments(id) ON DELETE CASCADE"
        ")"
    ))
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_snapshot_attachments_snapshot_id ON snapshot_attachments (snapshot_id)"))
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_snapshot_attachments_attachment_id ON snapshot_attachments (attachment_id)"))
