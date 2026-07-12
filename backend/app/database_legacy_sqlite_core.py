import json

from sqlalchemy import inspect, text


async def migrate_identity_and_project_schema(conn, get_columns, get_column_info, backend_dir):
    proyecto_columns = await conn.run_sync(get_columns, "proyectos")
    organizacion_columns = await conn.run_sync(get_columns, "organizaciones")
    if organizacion_columns and "codigo" not in organizacion_columns:
        await conn.execute(text("ALTER TABLE organizaciones ADD COLUMN codigo VARCHAR(20)"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_organizaciones_codigo ON organizaciones (codigo)"))
    if organizacion_columns and "activo" not in organizacion_columns:
        await conn.execute(text("ALTER TABLE organizaciones ADD COLUMN activo BOOLEAN DEFAULT 1 NOT NULL"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_organizaciones_activo ON organizaciones (activo)"))
    if organizacion_columns:
        await conn.execute(text(
            "UPDATE organizaciones "
            "SET codigo = 'SOL-' || lower(substr(replace(id, '-', ''), 1, 8)) "
            "WHERE codigo IS NULL OR codigo = ''"
        ))

    if proyecto_columns and "organizacion_id" not in proyecto_columns:
        await conn.execute(text("ALTER TABLE proyectos ADD COLUMN organizacion_id CHAR(32)"))
        await conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_proyectos_organizacion_id "
                "ON proyectos (organizacion_id)"
            )
        )
    if proyecto_columns and "codigo" not in proyecto_columns:
        await conn.execute(text("ALTER TABLE proyectos ADD COLUMN codigo VARCHAR(20)"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_proyectos_codigo ON proyectos (codigo)"))
    if proyecto_columns and "report_settings" not in proyecto_columns:
        await conn.execute(text("ALTER TABLE proyectos ADD COLUMN report_settings JSON DEFAULT '{}' NOT NULL"))
    if proyecto_columns:
        await conn.execute(text(
            "UPDATE proyectos "
            "SET codigo = 'PRJ-' || lower(substr(replace(id, '-', ''), 1, 8)) "
            "WHERE codigo IS NULL OR codigo = ''"
        ))

    componente_columns = await conn.run_sync(get_columns, "componentes")
    if componente_columns and "codigo" not in componente_columns:
        await conn.execute(text("ALTER TABLE componentes ADD COLUMN codigo VARCHAR(20)"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_componentes_codigo ON componentes (codigo)"))
    if componente_columns:
        await conn.execute(text(
            "UPDATE componentes "
            "SET codigo = 'CMP-' || lower(substr(replace(id, '-', ''), 1, 8)) "
            "WHERE codigo IS NULL OR codigo = ''"
        ))
    if componente_columns and "descripcion" not in componente_columns:
        await conn.execute(text("ALTER TABLE componentes ADD COLUMN descripcion TEXT"))
    if componente_columns and "tech_stack" not in componente_columns:
        await conn.execute(text("ALTER TABLE componentes ADD COLUMN tech_stack VARCHAR(255)"))
    if componente_columns and "variables" not in componente_columns:
        await conn.execute(text("ALTER TABLE componentes ADD COLUMN variables JSON DEFAULT '{}'"))

    entorno_columns = await conn.run_sync(get_columns, "entornos")
    if entorno_columns and "status" not in entorno_columns:
        await conn.execute(text("ALTER TABLE entornos ADD COLUMN status VARCHAR(50) DEFAULT 'Unknown'"))
    if entorno_columns and "version" not in entorno_columns:
        await conn.execute(text("ALTER TABLE entornos ADD COLUMN version VARCHAR(50)"))
    if entorno_columns and "variables" not in entorno_columns:
        await conn.execute(text("ALTER TABLE entornos ADD COLUMN variables JSON DEFAULT '{}'"))
    if entorno_columns and "activo" not in entorno_columns:
        await conn.execute(text("ALTER TABLE entornos ADD COLUMN activo BOOLEAN DEFAULT 1 NOT NULL"))
    if entorno_columns and "ultima_verificacion" not in entorno_columns:
        await conn.execute(text("ALTER TABLE entornos ADD COLUMN ultima_verificacion DATETIME"))
    await conn.execute(text(
        "CREATE TABLE IF NOT EXISTS entorno_datasets ("
        "id CHAR(32) NOT NULL PRIMARY KEY, "
        "entorno_id CHAR(32) NOT NULL, "
        "nombre VARCHAR(100) NOT NULL, "
        "descripcion TEXT, "
        "variables JSON DEFAULT '{}', "
        "activo BOOLEAN DEFAULT 1 NOT NULL, "
        "es_default BOOLEAN DEFAULT 0 NOT NULL, "
        "fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP, "
        "CONSTRAINT uq_entorno_dataset_nombre UNIQUE (entorno_id, nombre), "
        "FOREIGN KEY(entorno_id) REFERENCES entornos(id) ON DELETE CASCADE"
        ")"
    ))
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_entorno_datasets_entorno_id ON entorno_datasets (entorno_id)"))

    wiki_columns = await conn.run_sync(get_columns, "wiki_pages")
    if wiki_columns and "ultima_edicion_por" not in wiki_columns:
        await conn.execute(text("ALTER TABLE wiki_pages ADD COLUMN ultima_edicion_por CHAR(32)"))
    if wiki_columns and "ultima_actualizacion" not in wiki_columns:
        await conn.execute(text("ALTER TABLE wiki_pages ADD COLUMN ultima_actualizacion DATETIME"))

    usuario_columns = await conn.run_sync(get_columns, "usuarios")
    if usuario_columns and "auth_provider" not in usuario_columns:
        await conn.execute(text("ALTER TABLE usuarios ADD COLUMN auth_provider VARCHAR(50) DEFAULT 'local' NOT NULL"))
    if usuario_columns and "modulos" not in usuario_columns:
        await conn.execute(text("ALTER TABLE usuarios ADD COLUMN modulos JSON DEFAULT '[]' NOT NULL"))
    if usuario_columns and "rol_custom_id" not in usuario_columns:
        await conn.execute(text("ALTER TABLE usuarios ADD COLUMN rol_custom_id CHAR(32)"))
        await conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_usuarios_rol_custom_id "
                "ON usuarios (rol_custom_id)"
            )
        )
    if usuario_columns and "permisos" not in usuario_columns:
        await conn.execute(text("ALTER TABLE usuarios ADD COLUMN permisos JSON DEFAULT '{}' NOT NULL"))
    if usuario_columns and "permisos_detallados" not in usuario_columns:
        await conn.execute(text("ALTER TABLE usuarios ADD COLUMN permisos_detallados JSON DEFAULT '{}' NOT NULL"))
    if usuario_columns and "display_name" not in usuario_columns:
        await conn.execute(text("ALTER TABLE usuarios ADD COLUMN display_name VARCHAR(255)"))
    if usuario_columns and "avatar_provider" not in usuario_columns:
        await conn.execute(text("ALTER TABLE usuarios ADD COLUMN avatar_provider VARCHAR(30) DEFAULT 'gravatar' NOT NULL"))
    if usuario_columns and "profile_settings" not in usuario_columns:
        await conn.execute(text("ALTER TABLE usuarios ADD COLUMN profile_settings JSON DEFAULT '{}' NOT NULL"))
    if usuario_columns and "personal_theme" not in usuario_columns:
        await conn.execute(text("ALTER TABLE usuarios ADD COLUMN personal_theme VARCHAR(64) DEFAULT 'system' NOT NULL"))
    if usuario_columns and "project_theme_overrides" not in usuario_columns:
        await conn.execute(text("ALTER TABLE usuarios ADD COLUMN project_theme_overrides JSON DEFAULT '{}' NOT NULL"))

    role_columns = await conn.run_sync(get_columns, "roles_personalizados")
    if role_columns and "permisos" not in role_columns:
        await conn.execute(text("ALTER TABLE roles_personalizados ADD COLUMN permisos JSON DEFAULT '{}' NOT NULL"))
    if role_columns and "permisos_detallados" not in role_columns:
        await conn.execute(text("ALTER TABLE roles_personalizados ADD COLUMN permisos_detallados JSON DEFAULT '{}' NOT NULL"))

    build_columns = await conn.run_sync(get_columns, "builds")
    if build_columns and "contexto_cambio" not in build_columns:
        await conn.execute(text("ALTER TABLE builds ADD COLUMN contexto_cambio TEXT"))
    if build_columns and "fecha_inicio" not in build_columns:
        await conn.execute(text("ALTER TABLE builds ADD COLUMN fecha_inicio DATETIME"))
    if build_columns and "fecha_fin" not in build_columns:
        await conn.execute(text("ALTER TABLE builds ADD COLUMN fecha_fin DATETIME"))

    await conn.execute(
        text(
            "CREATE TABLE IF NOT EXISTS organizacion_miembros ("
            "id CHAR(32) NOT NULL PRIMARY KEY, "
            "organizacion_id CHAR(32) NOT NULL, "
            "usuario_id CHAR(32) NOT NULL, "
            "rol_cliente VARCHAR(50) DEFAULT 'MEMBER' NOT NULL, "
            "fecha_asignacion DATETIME DEFAULT CURRENT_TIMESTAMP, "
            "CONSTRAINT unique_organizacion_usuario UNIQUE (organizacion_id, usuario_id), "
            "FOREIGN KEY(organizacion_id) REFERENCES organizaciones (id) ON DELETE CASCADE, "
            "FOREIGN KEY(usuario_id) REFERENCES usuarios (id) ON DELETE CASCADE"
            ")"
        )
    )
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_organizacion_miembros_organizacion_id ON organizacion_miembros (organizacion_id)"))
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_organizacion_miembros_usuario_id ON organizacion_miembros (usuario_id)"))

    suite_columns = await conn.run_sync(get_columns, "suites")
    if suite_columns:
        if "componente_id" not in suite_columns:
            await conn.execute(text("ALTER TABLE suites ADD COLUMN componente_id CHAR(32)"))
            await conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_suites_componente_id "
                    "ON suites (componente_id)"
                )
            )
        if "orden" not in suite_columns:
            await conn.execute(text("ALTER TABLE suites ADD COLUMN orden INTEGER DEFAULT 0 NOT NULL"))
        if "activo" not in suite_columns:
            await conn.execute(text("ALTER TABLE suites ADD COLUMN activo BOOLEAN DEFAULT 1 NOT NULL"))
        if "color" not in suite_columns:
            await conn.execute(text("ALTER TABLE suites ADD COLUMN color VARCHAR(20) DEFAULT '#F1F5F9'"))
        if "icono" not in suite_columns:
            await conn.execute(text("ALTER TABLE suites ADD COLUMN icono VARCHAR(40) DEFAULT 'folder'"))
