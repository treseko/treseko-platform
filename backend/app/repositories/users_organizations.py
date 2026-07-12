from .legacy_common import *


async def get_roles_personalizados(db: AsyncSession, include_inactive: bool = False, skip: int = 0, limit: int = 100):
    query = select(models.RolPersonalizado).order_by(models.RolPersonalizado.nombre)
    if not include_inactive:
        query = query.filter(models.RolPersonalizado.activo == True)
    query = query.offset(skip).limit(limit)
    result = await db.execute(query)
    return result.scalars().all()

async def get_rol_personalizado(db: AsyncSession, role_id: UUID):
    result = await db.execute(select(models.RolPersonalizado).filter(models.RolPersonalizado.id == role_id))
    return result.scalar_one_or_none()

async def get_rol_personalizado_by_name(db: AsyncSession, nombre: str):
    result = await db.execute(select(models.RolPersonalizado).filter(models.RolPersonalizado.nombre == nombre))
    return result.scalar_one_or_none()

async def create_rol_personalizado(db: AsyncSession, role: schemas.RolPersonalizadoCreate):
    from .auth import modules_from_permissions, normalize_capability_permissions, normalize_modules, normalize_permissions
    permisos = _strip_non_assignable_user_permissions(normalize_permissions(models.Rol.TESTER, role.permisos))
    permisos_detallados = _strip_non_assignable_user_capabilities(normalize_capability_permissions(models.Rol.TESTER, role.permisos_detallados))
    modulos = _modules_from_permissions_and_capabilities(permisos, permisos_detallados) if (permisos or permisos_detallados) else _strip_non_assignable_user_modules(normalize_modules(models.Rol.TESTER, role.modulos))
    db_role = models.RolPersonalizado(
        nombre=role.nombre,
        descripcion=role.descripcion,
        modulos=modulos,
        permisos=permisos or {module: "read" for module in modulos},
        permisos_detallados=permisos_detallados,
        activo=role.activo,
    )
    db.add(db_role)
    await db.commit()
    await db.refresh(db_role)
    return db_role

async def update_rol_personalizado(db: AsyncSession, role_id: UUID, role_update: schemas.RolPersonalizadoUpdate):
    from .auth import modules_from_permissions, normalize_capability_permissions, normalize_modules, normalize_permissions
    db_role = await get_rol_personalizado(db, role_id)
    if not db_role:
        return None
    update_data = role_update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        if field == "permisos":
            permisos = _strip_non_assignable_user_permissions(normalize_permissions(models.Rol.TESTER, value))
            db_role.permisos = permisos
            db_role.modulos = _modules_from_permissions_and_capabilities(permisos, db_role.permisos_detallados)
        elif field == "permisos_detallados":
            db_role.permisos_detallados = _strip_non_assignable_user_capabilities(
                normalize_capability_permissions(models.Rol.TESTER, value)
            )
            db_role.modulos = _modules_from_permissions_and_capabilities(db_role.permisos, db_role.permisos_detallados)
        elif field == "modulos":
            db_role.modulos = _strip_non_assignable_user_modules(normalize_modules(models.Rol.TESTER, value))
            db_role.permisos = {module: "read" for module in db_role.modulos}
        else:
            setattr(db_role, field, value)
    await db.commit()
    await db.refresh(db_role)
    return db_role

async def deactivate_rol_personalizado(db: AsyncSession, role_id: UUID):
    db_role = await get_rol_personalizado(db, role_id)
    if not db_role:
        return None
    db_role.activo = False
    await db.commit()
    await db.refresh(db_role)
    return db_role

# --- USUARIOS ---
async def get_user_by_email(db: AsyncSession, email: str):
    result = await db.execute(
        select(models.Usuario)
        .options(selectinload(models.Usuario.rol_personalizado))
        .filter(models.Usuario.email == email)
    )
    return result.scalar_one_or_none()

async def create_user(db: AsyncSession, user: schemas.UsuarioCreate, hashed_password: str):
    from .auth import modules_from_permissions, normalize_capability_permissions, normalize_modules, normalize_permissions
    custom_role = await get_rol_personalizado(db, user.rol_custom_id) if user.rol_custom_id else None
    if user.rol_custom_id and not custom_role:
        raise ValueError("El rol personalizado indicado no existe")
    permisos = _strip_non_assignable_user_permissions(custom_role.permisos if custom_role else normalize_permissions(user.rol, user.permisos))
    permisos_detallados = _strip_non_assignable_user_capabilities(
        custom_role.permisos_detallados if custom_role else normalize_capability_permissions(user.rol, user.permisos_detallados)
    )
    modulos = _strip_non_assignable_user_modules(custom_role.modulos) if custom_role else (
        _modules_from_permissions_and_capabilities(permisos, permisos_detallados) if (permisos or permisos_detallados) else normalize_modules(user.rol, user.modulos)
    )
    db_user = models.Usuario(
        email=user.email,
        hashed_password=hashed_password,
        nombre_completo=user.nombre_completo,
        rol=user.rol,
        rol_custom_id=user.rol_custom_id,
        auth_provider=user.auth_provider,
        modulos=modulos,
        permisos=permisos or {module: "read" for module in modulos},
        permisos_detallados=permisos_detallados
    )
    db.add(db_user)
    await db.commit()
    return await get_user(db, db_user.id)

async def create_user_admin(db: AsyncSession, user: schemas.UsuarioAdminCreate, hashed_password: Optional[str] = None):
    from .auth import modules_from_permissions, normalize_capability_permissions, normalize_modules, normalize_permissions
    custom_role = await get_rol_personalizado(db, user.rol_custom_id) if user.rol_custom_id else None
    if user.rol_custom_id and not custom_role:
        raise ValueError("El rol personalizado indicado no existe")
    permisos = _strip_non_assignable_user_permissions(custom_role.permisos if custom_role else normalize_permissions(user.rol, user.permisos))
    permisos_detallados = _strip_non_assignable_user_capabilities(
        custom_role.permisos_detallados if custom_role else normalize_capability_permissions(user.rol, user.permisos_detallados)
    )
    modulos = _strip_non_assignable_user_modules(custom_role.modulos) if custom_role else (
        _modules_from_permissions_and_capabilities(permisos, permisos_detallados) if (permisos or permisos_detallados) else normalize_modules(user.rol, user.modulos)
    )
    db_user = models.Usuario(
        email=user.email,
        hashed_password=hashed_password,
        nombre_completo=user.nombre_completo,
        rol=user.rol,
        rol_custom_id=user.rol_custom_id,
        activo=user.activo,
        auth_provider=user.auth_provider,
        modulos=modulos,
        permisos=permisos or {module: "read" for module in modulos},
        permisos_detallados=permisos_detallados,
    )
    db.add(db_user)
    await db.commit()
    return await get_user(db, db_user.id)

async def get_users(db: AsyncSession, skip: int = 0, limit: int = 100):
    result = await db.execute(
        select(models.Usuario)
        .options(selectinload(models.Usuario.rol_personalizado))
        .offset(skip)
        .limit(limit)
    )
    return result.scalars().all()

async def get_user(db: AsyncSession, user_id: UUID):
    result = await db.execute(
        select(models.Usuario)
        .options(selectinload(models.Usuario.rol_personalizado))
        .filter(models.Usuario.id == user_id)
    )
    return result.scalar_one_or_none()

async def update_user(db: AsyncSession, user_id: UUID, user_update: schemas.UsuarioUpdate, hashed_password: Optional[str] = None):
    from .auth import modules_from_permissions, normalize_capability_permissions, normalize_modules, normalize_permissions
    db_user = await get_user(db, user_id)
    if not db_user:
        return None
    update_data = user_update.model_dump(exclude_unset=True, exclude={"password"})
    custom_role = None
    if "rol_custom_id" in update_data and update_data["rol_custom_id"]:
        custom_role = await get_rol_personalizado(db, update_data["rol_custom_id"])
        if not custom_role:
            raise ValueError("El rol personalizado indicado no existe")
    for field, value in update_data.items():
        if field in {"modulos", "permisos", "permisos_detallados"}:
            continue
        setattr(db_user, field, value)
    if "rol_custom_id" in update_data and update_data["rol_custom_id"]:
        db_user.modulos = _strip_non_assignable_user_modules(custom_role.modulos)
        db_user.permisos = _strip_non_assignable_user_permissions(custom_role.permisos)
        db_user.permisos_detallados = _strip_non_assignable_user_capabilities(custom_role.permisos_detallados)
    elif "permisos" in update_data:
        role = update_data.get("rol", db_user.rol)
        permisos = _strip_non_assignable_user_permissions(normalize_permissions(role, update_data["permisos"]))
        db_user.permisos = permisos
        if "permisos_detallados" in update_data:
            db_user.permisos_detallados = _strip_non_assignable_user_capabilities(
                normalize_capability_permissions(role, update_data["permisos_detallados"])
            )
        db_user.modulos = _modules_from_permissions_and_capabilities(db_user.permisos, db_user.permisos_detallados)
    elif "modulos" in update_data:
        role = update_data.get("rol", db_user.rol)
        db_user.modulos = _strip_non_assignable_user_modules(normalize_modules(role, update_data["modulos"]))
        db_user.permisos = {module: "read" for module in db_user.modulos}
        if "permisos_detallados" in update_data:
            db_user.permisos_detallados = _strip_non_assignable_user_capabilities(
                normalize_capability_permissions(role, update_data["permisos_detallados"])
            )
    elif "permisos_detallados" in update_data:
        role = update_data.get("rol", db_user.rol)
        db_user.permisos_detallados = _strip_non_assignable_user_capabilities(
            normalize_capability_permissions(role, update_data["permisos_detallados"])
        )
        db_user.modulos = _modules_from_permissions_and_capabilities(db_user.permisos, db_user.permisos_detallados)
    elif "rol" in update_data:
        db_user.modulos = _strip_non_assignable_user_modules(normalize_modules(db_user.rol, None))
        db_user.permisos = _strip_non_assignable_user_permissions(normalize_permissions(db_user.rol, None))
        db_user.permisos_detallados = {}
    if hashed_password:
        db_user.hashed_password = hashed_password
    await db.commit()
    return await get_user(db, db_user.id)

async def update_my_profile(db: AsyncSession, user: models.Usuario, profile: schemas.UserProfileUpdate):
    update_data = profile.model_dump(exclude_unset=True)
    allowed_avatar_providers = {"gravatar", "none"}
    if "avatar_provider" in update_data and update_data["avatar_provider"] not in allowed_avatar_providers:
        raise ValueError("Proveedor de avatar no soportado")
    for field, value in update_data.items():
        setattr(user, field, value)
    await db.commit()
    await db.refresh(user)
    return user

async def update_my_preferences(db: AsyncSession, user: models.Usuario, preferences: schemas.UserPreferencesUpdate):
    update_data = preferences.model_dump(exclude_unset=True)
    if "personal_theme" in update_data:
        update_data["personal_theme"] = schemas.validate_personal_theme_id(update_data["personal_theme"])
    if "profile_settings" in update_data:
        current = user.profile_settings or {}
        merged = {**current, **(update_data.pop("profile_settings") or {})}
        schemas.validate_preference_json_payload(
            merged,
            max_bytes=schemas.MAX_PROFILE_SETTINGS_BYTES,
            label="La configuracion de perfil",
        )
        user.profile_settings = merged
    if "project_theme_overrides" in update_data:
        project_theme_overrides = update_data.pop("project_theme_overrides") or {}
        schemas.validate_preference_json_payload(
            project_theme_overrides,
            max_bytes=schemas.MAX_PROJECT_THEME_OVERRIDES_BYTES,
            label="La configuracion de temas por proyecto",
        )
        user.project_theme_overrides = project_theme_overrides
    for field, value in update_data.items():
        setattr(user, field, value)
    await db.commit()
    await db.refresh(user)
    return schemas.UserPreferences(
        personal_theme=user.personal_theme or "system",
        profile_settings=user.profile_settings or {},
        project_theme_overrides=user.project_theme_overrides or {},
    )

async def change_my_password(db: AsyncSession, user: models.Usuario, new_hashed_password: str):
    profile_settings = dict(user.profile_settings or {})
    security = dict(profile_settings.get("security") or {})
    security["force_password_change"] = False
    security.pop("force_password_change_reason", None)
    security["password_changed_at"] = datetime.utcnow().isoformat() + "Z"
    profile_settings["security"] = security
    user.hashed_password = new_hashed_password
    user.profile_settings = profile_settings
    await db.commit()
    await db.refresh(user)
    return schemas.UserPreferences(
        personal_theme=user.personal_theme or "system",
        profile_settings=user.profile_settings or {},
        project_theme_overrides=user.project_theme_overrides or {},
    )

async def deactivate_user(db: AsyncSession, user_id: UUID):
    db_user = await get_user(db, user_id)
    if not db_user:
        return None
    db_user.activo = False
    await db.commit()
    return await get_user(db, db_user.id)

MAX_API_KEY_LOOKUP_LENGTH = 128


def _normalize_api_key_for_lookup(api_key: str | None) -> str | None:
    value = str(api_key or "").strip()
    if (
        not value
        or len(value) > MAX_API_KEY_LOOKUP_LENGTH
        or any(char.isspace() for char in value)
        or "\x00" in value
    ):
        return None
    return value


def _hash_api_key(api_key: str) -> str:
    return hashlib.sha256(api_key.encode("utf-8")).hexdigest()

def generate_raw_api_key() -> str:
    return f"treseko_{secrets.token_urlsafe(32)}"

async def generate_short_code(db: AsyncSession, model, prefix: str, filters: Optional[list] = None) -> str:
    filters = filters or []
    for _ in range(20):
        code = f"{prefix}-{secrets.token_hex(4)}"
        query = select(model).filter(model.codigo == code, *filters)
        result = await db.execute(query)
        if not result.scalar_one_or_none():
            return code
    raise RuntimeError("No se pudo generar un codigo corto unico")

async def create_api_key(db: AsyncSession, user_id: UUID, payload: schemas.ApiKeyCreate):
    active_count_result = await db.execute(
        select(func.count())
        .select_from(models.ApiKey)
        .filter(models.ApiKey.usuario_id == user_id, models.ApiKey.activo == True)
    )
    active_count = int(active_count_result.scalar() or 0)
    if active_count >= schemas.MAX_ACTIVE_API_KEYS_PER_USER:
        raise ValueError(f"No puedes tener mas de {schemas.MAX_ACTIVE_API_KEYS_PER_USER} API keys activas")
    raw_key = generate_raw_api_key()
    db_key = models.ApiKey(
        usuario_id=user_id,
        nombre=payload.nombre,
        key_hash=_hash_api_key(raw_key),
        key_prefix=raw_key[:12],
    )
    db.add(db_key)
    await db.commit()
    await db.refresh(db_key)
    return db_key, raw_key

async def get_api_keys_for_user(db: AsyncSession, user_id: UUID):
    result = await db.execute(
        select(models.ApiKey)
        .filter(models.ApiKey.usuario_id == user_id)
        .order_by(models.ApiKey.fecha_creacion.desc())
    )
    return result.scalars().all()

async def revoke_api_key(db: AsyncSession, user_id: UUID, api_key_id: UUID):
    result = await db.execute(
        select(models.ApiKey).filter(
            models.ApiKey.id == api_key_id,
            models.ApiKey.usuario_id == user_id,
        )
    )
    db_key = result.scalar_one_or_none()
    if not db_key:
        return None
    db_key.activo = False
    await db.commit()
    await db.refresh(db_key)
    return db_key

async def get_user_by_api_key(db: AsyncSession, api_key: str):
    normalized_api_key = _normalize_api_key_for_lookup(api_key)
    if not normalized_api_key:
        return None
    result = await db.execute(
        select(models.ApiKey).filter(
            models.ApiKey.key_hash == _hash_api_key(normalized_api_key),
            models.ApiKey.activo == True,
        )
    )
    db_key = result.scalar_one_or_none()
    if not db_key:
        return None
    user = await get_user(db, db_key.usuario_id)
    if not user or not user.activo:
        return None
    db_key.ultimo_uso = utc_now()
    await db.commit()
    return user

# --- ORGANIZACIONES ---
async def create_organizacion(db: AsyncSession, org: schemas.OrganizacionCreate):
    org_data = org.model_dump()
    if not org_data.get("nombre"):
        raise ValueError("El nombre de la organizacion es obligatorio")
    existing = await db.execute(select(models.Organizacion).filter(models.Organizacion.nombre == org_data["nombre"]))
    if existing.scalar_one_or_none():
        raise ValueError("Ya existe una organizacion con ese nombre")
    db_org = models.Organizacion(
        **org_data,
        codigo=await generate_short_code(db, models.Organizacion, "SOL"),
    )
    db.add(db_org)
    await db.commit()
    await db.refresh(db_org)
    return db_org

async def get_organizaciones(db: AsyncSession, skip: int = 0, limit: int = 100, include_inactive: bool = False):
    query = select(models.Organizacion).order_by(models.Organizacion.nombre)
    if not include_inactive:
        query = query.filter(models.Organizacion.activo.is_(True))
    result = await db.execute(query.offset(skip).limit(limit))
    return result.scalars().all()

async def get_organizacion(db: AsyncSession, org_id: UUID):
    result = await db.execute(select(models.Organizacion).filter(models.Organizacion.id == org_id))
    return result.scalar_one_or_none()

async def get_or_create_default_organizacion(db: AsyncSession):
    result = await db.execute(
        select(models.Organizacion).filter(models.Organizacion.nombre == "Organizacion Interna")
    )
    db_org = result.scalar_one_or_none()
    if db_org:
        if db_org.activo is not True:
            raise ValueError("La organización por defecto está inactiva")
        return db_org
    db_org = models.Organizacion(
        nombre="Organizacion Interna",
        descripcion="Organización por defecto para proyectos creados sin contexto organizacional explícito.",
        tipo="Interna",
        codigo=await generate_short_code(db, models.Organizacion, "SOL"),
    )
    db.add(db_org)
    await db.flush()
    return db_org

async def resolve_project_organizacion(db: AsyncSession, organizacion_id: Optional[UUID]):
    if organizacion_id:
        db_org = await get_organizacion(db, organizacion_id)
        if not db_org:
            raise ValueError("La organización indicada no existe")
        if db_org.activo is not True:
            raise ValueError("La organización indicada está inactiva")
        return db_org.id
    db_org = await get_or_create_default_organizacion(db)
    return db_org.id

async def update_organizacion(db: AsyncSession, org_id: UUID, org_update: schemas.OrganizacionUpdate):
    db_org = await get_organizacion(db, org_id)
    if not db_org:
        return None
    update_data = org_update.model_dump(exclude_unset=True)
    if update_data.get("nombre") is None and "nombre" in update_data:
        raise ValueError("El nombre de la organizacion es obligatorio")
    if update_data.get("nombre"):
        existing = await db.execute(
            select(models.Organizacion).filter(
                models.Organizacion.nombre == update_data["nombre"],
                models.Organizacion.id != org_id,
            )
        )
        if existing.scalar_one_or_none():
            raise ValueError("Ya existe una organizacion con ese nombre")
    for field, value in update_data.items():
        setattr(db_org, field, value)
    await db.commit()
    await db.refresh(db_org)
    return db_org

async def get_organizacion_miembros(db: AsyncSession, org_id: UUID, skip: int = 0, limit: int = 100):
    result = await db.execute(
        select(models.OrganizacionMiembro)
        .options(selectinload(models.OrganizacionMiembro.usuario).selectinload(models.Usuario.rol_personalizado))
        .filter(models.OrganizacionMiembro.organizacion_id == org_id)
        .order_by(models.OrganizacionMiembro.fecha_asignacion)
        .offset(skip)
        .limit(limit)
    )
    return result.scalars().all()
