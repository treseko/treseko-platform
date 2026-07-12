import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.ext.asyncio import AsyncSession

from . import crud, models, schemas
from .database import get_db
from .rbac_compat import legacy_capability_level
from .rbac_catalog import ALL_CAPABILITIES, CAPABILITY_LEVELS, get_capability_module
from .time_utils import utc_now

def _env_or_file(name: str) -> str:
    direct_value = (os.getenv(name) or "").strip()
    if direct_value:
        return direct_value
    file_path = (os.getenv(f"{name}_FILE") or "").strip()
    if not file_path:
        return ""
    try:
        return Path(file_path).read_text(encoding="utf-8").strip()
    except OSError as exc:
        raise RuntimeError(f"No se pudo leer {name}_FILE={file_path}") from exc


SECRET_KEY = _env_or_file("SECRET_KEY")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30


def _runtime_environment() -> str:
    return (os.getenv("APP_ENV") or os.getenv("ENVIRONMENT") or os.getenv("ENV") or "development").strip().lower()


def _is_production_environment(environment: str | None = None) -> bool:
    return (environment or _runtime_environment()) in {"prod", "production"}


def validate_secret_key_for_runtime(secret_key: str | None = None, environment: str | None = None) -> None:
    candidate = (secret_key if secret_key is not None else SECRET_KEY or "").strip()
    insecure_values = {
        "",
        "cambiar_en_entornos_" + "reales",
        "change-me",
        "changeme",
        "secret",
        "supersecret",
    }
    if candidate in insecure_values or len(candidate) < 32:
        raise RuntimeError("SECRET_KEY seguro es obligatorio para iniciar Treseko")


validate_secret_key_for_runtime()

MODULE_PERMISSIONS = {
    models.Rol.ADMIN: [
        "dashboard", "ejecutar", "crear_pruebas", "proyectos", "inventario",
        "reportes", "bugs", "motor_ia", "redmine", "historial", "configuracion", "automatizacion",
        "clientes", "integraciones", "plugins", "notificaciones",
    ],
    models.Rol.QA_LEAD: [
        "dashboard", "ejecutar", "crear_pruebas", "proyectos", "inventario",
        "reportes", "bugs", "motor_ia", "historial", "automatizacion", "integraciones", "notificaciones",
    ],
    models.Rol.TESTER: ["dashboard", "ejecutar", "crear_pruebas", "proyectos", "bugs", "historial", "automatizacion", "notificaciones"],
    models.Rol.VIEWER: ["dashboard", "proyectos", "reportes", "bugs", "historial", "notificaciones"],
}

MODULE_ACCESS = {
    models.Rol.ADMIN: {module: "edit" for module in MODULE_PERMISSIONS[models.Rol.ADMIN]},
    models.Rol.QA_LEAD: {
        "dashboard": "read",
        "ejecutar": "edit",
        "crear_pruebas": "edit",
        "proyectos": "edit",
        "inventario": "edit",
        "reportes": "edit",
        "bugs": "edit",
        "motor_ia": "edit",
        "historial": "read",
        "automatizacion": "edit",
        "integraciones": "read",
        "notificaciones": "read",
    },
    models.Rol.TESTER: {
        "dashboard": "read",
        "ejecutar": "edit",
        "crear_pruebas": "edit",
        "proyectos": "read",
        "bugs": "edit",
        "historial": "read",
        "automatizacion": "read",
        "notificaciones": "read",
    },
    models.Rol.VIEWER: {
        "dashboard": "read",
        "proyectos": "read",
        "reportes": "read",
        "bugs": "read",
        "historial": "read",
        "notificaciones": "read",
    },
}

pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="auth/login")


def default_modules_for_role(role: models.Rol):
    return MODULE_PERMISSIONS.get(role, MODULE_PERMISSIONS[models.Rol.TESTER])


def default_permissions_for_role(role: models.Rol):
    return MODULE_ACCESS.get(role, MODULE_ACCESS[models.Rol.TESTER])


def normalize_modules(role: models.Rol, modules):
    if modules is None:
        return default_modules_for_role(role)
    allowed = set(MODULE_PERMISSIONS[models.Rol.ADMIN])
    if role != models.Rol.ADMIN:
        allowed.discard("clientes")
    return [module for module in modules if module in allowed]


def normalize_permissions(role: models.Rol, permissions):
    if permissions is None:
        return default_permissions_for_role(role)
    if not permissions:
        return {}
    allowed_modules = set(MODULE_PERMISSIONS[models.Rol.ADMIN])
    if role != models.Rol.ADMIN:
        allowed_modules.discard("clientes")
    allowed_levels = {"read", "edit"}
    return {
        module: level
        for module, level in permissions.items()
        if module in allowed_modules and level in allowed_levels
    }


def normalize_capability_permissions(role: models.Rol, permissions):
    if not permissions:
        return {}
    allowed_modules = set(MODULE_PERMISSIONS[models.Rol.ADMIN])
    if role != models.Rol.ADMIN:
        allowed_modules.discard("clientes")
    return {
        capability: level
        for capability, level in permissions.items()
        if capability in ALL_CAPABILITIES
        and get_capability_module(capability) in allowed_modules
        and level in CAPABILITY_LEVELS
    }


def modules_from_permissions(permissions):
    return [module for module, level in (permissions or {}).items() if level in {"read", "edit"}]


def effective_permissions_for_user(user: models.Usuario):
    if user.rol == models.Rol.ADMIN:
        if user.permisos:
            return {**default_permissions_for_role(models.Rol.ADMIN), **normalize_permissions(user.rol, user.permisos)}
        return default_permissions_for_role(models.Rol.ADMIN)

    custom_role = getattr(user, "rol_personalizado", None)
    if custom_role and custom_role.activo:
        if custom_role.permisos is not None:
            return normalize_permissions(models.Rol.TESTER, custom_role.permisos)
        if custom_role.modulos is not None:
            return {module: "read" for module in normalize_modules(models.Rol.TESTER, custom_role.modulos)}

    if user.permisos:
        return normalize_permissions(user.rol, user.permisos)
    if user.modulos:
        return {module: "read" for module in normalize_modules(user.rol, user.modulos)}
    return default_permissions_for_role(user.rol)


def effective_modules_for_user(user: models.Usuario):
    modules = set(modules_from_permissions(effective_permissions_for_user(user)))
    for capability, level in effective_capabilities_for_user(user).items():
        if level in {"read", "edit"}:
            module = get_capability_module(capability)
            if module:
                modules.add(module)
    return sorted(modules)


def detailed_permissions_for_user(user: models.Usuario):
    if user.rol == models.Rol.ADMIN:
        return {capability: "edit" for capability in ALL_CAPABILITIES}

    custom_role = getattr(user, "rol_personalizado", None)
    if custom_role and custom_role.activo:
        permissions = normalize_capability_permissions(models.Rol.TESTER, getattr(custom_role, "permisos_detallados", None))
        permissions.update(normalize_capability_permissions(user.rol, getattr(user, "permisos_detallados", None)))
        return permissions

    return normalize_capability_permissions(user.rol, getattr(user, "permisos_detallados", None))


def get_capability_permission(user: models.Usuario, capability_id: str):
    if capability_id not in ALL_CAPABILITIES:
        return None
    detailed = detailed_permissions_for_user(user)
    if capability_id in detailed:
        return detailed[capability_id]
    module_id = get_capability_module(capability_id)
    if not module_id:
        return None
    module_permissions = effective_permissions_for_user(user)
    legacy_level = legacy_capability_level(module_permissions, capability_id)
    if legacy_level:
        return legacy_level
    return None


def effective_capabilities_for_user(user: models.Usuario):
    result = {}
    for capability_id in ALL_CAPABILITIES:
        level = get_capability_permission(user, capability_id)
        if level in {"read", "edit"}:
            result[capability_id] = level
    return result


def has_capability_permission(user: models.Usuario, capability_id: str, level: str = "read"):
    current = get_capability_permission(user, capability_id)
    if level == "read":
        return current in {"read", "edit"}
    if level == "edit":
        return current == "edit"
    return False


def has_explicit_capability_permission(user: models.Usuario, capability_id: str, level: str = "read"):
    if capability_id not in ALL_CAPABILITIES:
        return False
    current = detailed_permissions_for_user(user).get(capability_id)
    if level == "read":
        return current in {"read", "edit"}
    if level == "edit":
        return current == "edit"
    return False


def has_module_permission(user: models.Usuario, module_id: str, level: str = "read"):
    permissions = effective_permissions_for_user(user)
    current = permissions.get(module_id)
    if level == "read":
        return current in {"read", "edit"}
    if level == "edit":
        return current == "edit"
    return False


def verify_password(plain_password, hashed_password):
    if not hashed_password:
        return False
    try:
        return pwd_context.verify(plain_password, hashed_password)
    except Exception:
        return False


def get_password_hash(password):
    return pwd_context.hash(password)


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None, token_type: str = "access"):
    to_encode = data.copy()
    expire = utc_now() + (expires_delta or timedelta(minutes=15))
    to_encode.update({"exp": expire, "type": token_type})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


async def get_current_user(db: AsyncSession = Depends(get_db), token: str = Depends(oauth2_scheme)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="No se pudo validar las credenciales",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        if payload.get("type") != "access":
            raise credentials_exception
        email: str = payload.get("sub")
        if email is None:
            raise credentials_exception
        token_data = schemas.TokenData(email=email)
    except JWTError:
        raise credentials_exception

    user = await crud.get_user_by_email(db, email=token_data.email)
    if user is None:
        raise credentials_exception
    return user


async def get_current_active_user(current_user: models.Usuario = Depends(get_current_user)):
    if not current_user.activo:
        raise HTTPException(status_code=400, detail="Usuario inactivo")
    return current_user


def check_role(roles: list):
    async def role_checker(user: models.Usuario = Depends(get_current_active_user)):
        if user.rol not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="No tienes permisos suficientes para realizar esta acción",
            )
        return user

    return role_checker


def check_module(module_id: str, level: str = "read"):
    async def module_checker(user: models.Usuario = Depends(get_current_active_user)):
        if not has_module_permission(user, module_id, level):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="No tienes permisos para acceder a este modulo",
            )
        return user

    return module_checker


def check_capability(capability_id: str, level: str = "read"):
    async def capability_checker(user: models.Usuario = Depends(get_current_active_user)):
        if not has_capability_permission(user, capability_id, level):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="No tienes permisos para acceder a esta capacidad",
            )
        return user

    return capability_checker


class LoginRateLimiter:
    def __init__(self, max_attempts: int = 5, window_minutes: int = 15):
        self.max_attempts = max_attempts
        self.window_minutes = window_minutes
        self.attempts: dict[str, list[datetime]] = {}

    def is_rate_limited(self, identifier: str) -> bool:
        now = utc_now()
        window_start = now - timedelta(minutes=self.window_minutes)
        self.attempts[identifier] = [t for t in self.attempts.get(identifier, []) if t > window_start]
        return len(self.attempts[identifier]) >= self.max_attempts

    def record_failure(self, identifier: str):
        now = utc_now()
        window_start = now - timedelta(minutes=self.window_minutes)
        self.attempts[identifier] = [t for t in self.attempts.get(identifier, []) if t > window_start]
        self.attempts[identifier].append(now)

    def clear(self, identifier: str):
        if identifier in self.attempts:
            del self.attempts[identifier]


login_rate_limiter = LoginRateLimiter(max_attempts=5, window_minutes=15)
