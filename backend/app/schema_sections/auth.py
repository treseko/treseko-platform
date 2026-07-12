from __future__ import annotations

import ipaddress
import json
import os
import re
from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, Field, field_serializer, field_validator

from ..rbac_catalog import ALL_CAPABILITIES, CAPABILITY_LEVELS, CAPABILITY_TO_MODULE

from ..models import (
    AiReviewStatus,
    AutomationJobStatus,
    Criticidad,
    EstadoCaso,
    EstadoResultado,
    EstadoRun,
    ExecutionMode,
    Prioridad,
    Rol,
    TipoPrueba,
)

MAX_PROFILE_SETTINGS_BYTES = 128 * 1024
MAX_PROJECT_THEME_OVERRIDES_BYTES = 64 * 1024
MAX_PREFERENCE_JSON_DEPTH = 8
MAX_PREFERENCE_DICT_KEYS = 500
MAX_PREFERENCE_LIST_ITEMS = 2000
MAX_PREFERENCE_KEY_LENGTH = 120
MAX_PREFERENCE_STRING_LENGTH = 4000
MAX_RBAC_MODULES = 50
MAX_RBAC_PERMISSIONS = 80
MAX_RBAC_CAPABILITIES = 250
MAX_ACTIVE_API_KEYS_PER_USER = 20
MAX_USER_EMAIL_LENGTH = 320
MAX_PERSONAL_THEME_LENGTH = 64
BUILTIN_PERSONAL_THEMES = {"system", "light", "dark", "pink-panther"}
PERSONAL_THEME_ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9._-]{0,63}$")


def validate_personal_theme_id(value: Optional[str]) -> Optional[str]:
    if value is None:
        return value
    theme_id = value.strip()
    if not theme_id:
        raise ValueError("Tema personal no soportado")
    if len(theme_id) > MAX_PERSONAL_THEME_LENGTH or not PERSONAL_THEME_ID_PATTERN.match(theme_id):
        raise ValueError("Tema personal no soportado")
    return theme_id
MAX_USER_NAME_LENGTH = 160
MAX_USER_AUTH_PROVIDER_LENGTH = 30
MAX_USER_PASSWORD_LENGTH = 256
MAX_ROLE_NAME_LENGTH = 120
MAX_ROLE_DESCRIPTION_LENGTH = 1000
USER_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
ALLOWED_AUTH_PROVIDERS = {"local", "ad", "oidc"}
LEGACY_RBAC_MODULES = {"clientes"}
SENSITIVE_PREFERENCE_KEYS = {
    "api_key",
    "apikey",
    "authorization",
    "bearer",
    "client_secret",
    "cookie",
    "credential",
    "credentials",
    "password",
    "private_key",
    "refresh_token",
    "secret",
    "set_cookie",
    "token",
}


def _preference_payload_size(value: Dict[str, Any]) -> int:
    return len(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))


def _validate_preference_json_value(value: Any, *, depth: int = 0, label: str = "La configuracion de preferencias") -> None:
    if depth > MAX_PREFERENCE_JSON_DEPTH:
        raise ValueError(f"{label} excede la profundidad permitida")
    if value is None or isinstance(value, (bool, int, float)):
        return
    if isinstance(value, str):
        if len(value) > MAX_PREFERENCE_STRING_LENGTH:
            raise ValueError(f"{label} contiene un texto demasiado largo")
        return
    if isinstance(value, list):
        if len(value) > MAX_PREFERENCE_LIST_ITEMS:
            raise ValueError(f"{label} contiene demasiados elementos")
        for item in value:
            _validate_preference_json_value(item, depth=depth + 1, label=label)
        return
    if isinstance(value, dict):
        if len(value) > MAX_PREFERENCE_DICT_KEYS:
            raise ValueError(f"{label} contiene demasiadas claves")
        for key, item in value.items():
            if not isinstance(key, str) or len(key) > MAX_PREFERENCE_KEY_LENGTH:
                raise ValueError(f"{label} contiene una clave invalida")
            normalized_key = re.sub(r"[^a-z0-9]+", "_", key.strip().lower()).strip("_")
            if normalized_key in SENSITIVE_PREFERENCE_KEYS or normalized_key.endswith((
                "_api_key",
                "_password",
                "_secret",
                "_token",
                "_cookie",
                "_credential",
                "_credentials",
                "_private_key",
            )):
                raise ValueError(f"{label} no puede contener secretos")
            _validate_preference_json_value(item, depth=depth + 1, label=label)
        return
    raise ValueError(f"{label} contiene un valor no soportado")


def validate_preference_json_payload(value: Optional[Dict[str, Any]], *, max_bytes: int, label: str) -> Optional[Dict[str, Any]]:
    if value is None:
        return value
    _validate_preference_json_value(value, label=label)
    if _preference_payload_size(value) > max_bytes:
        raise ValueError(f"{label} excede el tamano maximo permitido")
    return value


def _normalize_email(value: Optional[str]) -> Optional[str]:
    if value is None:
        return value
    email = value.strip().lower()
    if not email or len(email) > MAX_USER_EMAIL_LENGTH or not USER_EMAIL_RE.fullmatch(email):
        raise ValueError("Email invalido")
    return email


def _validate_auth_provider(value: Optional[str]) -> Optional[str]:
    if value is None:
        return value
    provider = value.strip().lower()
    if not provider or len(provider) > MAX_USER_AUTH_PROVIDER_LENGTH or provider not in ALLOWED_AUTH_PROVIDERS:
        raise ValueError("Proveedor de autenticacion invalido")
    return provider


def _validate_password(value: Optional[str]) -> Optional[str]:
    if value is None:
        return value
    if len(value) < 8 or len(value) > MAX_USER_PASSWORD_LENGTH:
        raise ValueError("La contraseña debe tener entre 8 y 256 caracteres")
    if "\x00" in value:
        raise ValueError("La contraseña contiene caracteres invalidos")
    return value


def _validate_module_list(value: Optional[List[str]]) -> Optional[List[str]]:
    if value is None:
        return value
    if len(value) > MAX_RBAC_MODULES:
        raise ValueError("La lista de modulos es demasiado grande")
    normalized: list[str] = []
    seen: set[str] = set()
    known_modules = set(CAPABILITY_TO_MODULE.values()) | LEGACY_RBAC_MODULES
    for item in value:
        module = str(item or "").strip()
        if not module or len(module) > MAX_PREFERENCE_KEY_LENGTH or module not in known_modules:
            raise ValueError("Modulo RBAC invalido")
        if module not in seen:
            normalized.append(module)
            seen.add(module)
    return normalized


def _validate_permission_map(value: Optional[Dict[str, str]]) -> Optional[Dict[str, str]]:
    if value is None:
        return value
    if len(value) > MAX_RBAC_PERMISSIONS:
        raise ValueError("El mapa de permisos es demasiado grande")
    known_modules = set(CAPABILITY_TO_MODULE.values()) | LEGACY_RBAC_MODULES
    normalized: dict[str, str] = {}
    for raw_key, raw_level in value.items():
        module = str(raw_key or "").strip()
        level = str(raw_level or "").strip().lower()
        if not module or len(module) > MAX_PREFERENCE_KEY_LENGTH or module not in known_modules:
            raise ValueError("Modulo RBAC invalido")
        if level not in CAPABILITY_LEVELS:
            raise ValueError("Nivel de permiso RBAC invalido")
        normalized[module] = level
    return normalized


def _validate_capability_map(value: Optional[Dict[str, str]]) -> Optional[Dict[str, str]]:
    if value is None:
        return value
    if len(value) > MAX_RBAC_CAPABILITIES:
        raise ValueError("El mapa de capacidades es demasiado grande")
    normalized: dict[str, str] = {}
    for raw_key, raw_level in value.items():
        capability = str(raw_key or "").strip()
        level = str(raw_level or "").strip().lower()
        if not capability or len(capability) > MAX_PREFERENCE_KEY_LENGTH or capability not in ALL_CAPABILITIES:
            raise ValueError("Capacidad RBAC invalida")
        if level not in CAPABILITY_LEVELS:
            raise ValueError("Nivel de capacidad RBAC invalido")
        normalized[capability] = level
    return normalized

class Token(BaseModel):
    access_token: str
    token_type: str
    expires_in: Optional[int] = None
    session_timeout_minutes: Optional[int] = None

class TokenData(BaseModel):
    email: Optional[str] = None

class AuthAdOidcPublicConfig(BaseModel):
    enabled: bool = False
    provider_label: str = "Active Directory"
    login_url: str = "/auth/ad/login/"
    mode: str = "oidc"

class AuthAdOidcConfig(BaseModel):
    enabled: bool = False
    provider_label: str = "Active Directory"
    mode: str = "oidc"
    issuer: str = ""
    discovery_url: str = ""
    client_id: str = ""
    redirect_path: str = "/auth/ad/callback/"
    scopes: List[str] = ["openid", "profile", "email"]
    allowed_domains: List[str] = []
    auto_provision: bool = True
    default_role: str = "TESTER"
    default_modules: List[str] = []
    default_permissions: Dict[str, str] = {}
    group_role_map: List[Dict[str, Any]] = []
    require_email_verified: bool = False
    sync_profile_on_login: bool = True
    client_secret_configured: bool = False
    ldap_url: str = ""
    ldap_base_dn: str = ""
    ldap_user_attribute: str = "sAMAccountName"
    ldap_bind_pattern: str = "{username}@{domain}"

class AuthAdOidcConfigUpdate(BaseModel):
    enabled: Optional[bool] = None
    provider_label: Optional[str] = None
    mode: Optional[str] = None
    issuer: Optional[str] = None
    discovery_url: Optional[str] = None
    client_id: Optional[str] = None
    redirect_path: Optional[str] = None
    scopes: Optional[List[str]] = None
    allowed_domains: Optional[List[str]] = None
    auto_provision: Optional[bool] = None
    default_role: Optional[str] = None
    default_modules: Optional[List[str]] = None
    default_permissions: Optional[Dict[str, str]] = None
    group_role_map: Optional[List[Dict[str, Any]]] = None
    require_email_verified: Optional[bool] = None
    sync_profile_on_login: Optional[bool] = None
    ldap_url: Optional[str] = None
    ldap_base_dn: Optional[str] = None
    ldap_user_attribute: Optional[str] = None
    ldap_bind_pattern: Optional[str] = None

    @field_validator("mode")
    @classmethod
    def validate_ad_mode(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        mode = value.strip().lower()
        if mode not in {"oidc", "ldap"}:
            raise ValueError("Modo AD debe ser oidc o ldap")
        return mode

    @field_validator("issuer", "discovery_url")
    @classmethod
    def validate_oidc_public_https_url(cls, value: Optional[str]) -> Optional[str]:
        if value is None or value == "":
            return value
        parsed = urlparse(value.strip())
        allow_private = str(os.getenv("AUTH_AD_OIDC_ALLOW_PRIVATE_ENDPOINTS") or "").strip().lower() in {"1", "true", "yes"}
        if parsed.scheme.lower() not in {"https", "http"} or not parsed.netloc or not parsed.hostname:
            raise ValueError("Debe ser una URL HTTP/HTTPS absoluta")
        if parsed.scheme.lower() == "http" and not allow_private:
            raise ValueError("Debe usar HTTPS")
        hostname = parsed.hostname.strip().lower()
        if (hostname == "localhost" or hostname.endswith(".localhost")) and not allow_private:
            raise ValueError("No puede apuntar a localhost")
        try:
            address = ipaddress.ip_address(hostname)
        except ValueError:
            address = None
        allow_private = (os.getenv("AUTH_AD_OIDC_ALLOW_PRIVATE_ENDPOINTS") or "").strip().lower() in {"1", "true", "yes"}
        if address and (
            address.is_private
            or address.is_loopback
            or address.is_link_local
            or address.is_multicast
            or address.is_reserved
            or address.is_unspecified
        ) and not allow_private:
            raise ValueError("No puede apuntar a una direccion privada o local")
        return value.strip()

    @field_validator("redirect_path")
    @classmethod
    def validate_redirect_path(cls, value: Optional[str]) -> Optional[str]:
        if value is None or value == "":
            return value
        path = value.strip()
        parsed = urlparse(path)
        if not path.startswith("/") or path.startswith("//") or parsed.scheme or parsed.netloc or any(char in path for char in ("\r", "\n", "\t")):
            raise ValueError("Debe ser una ruta local absoluta")
        return path

    @field_validator("ldap_url")
    @classmethod
    def validate_ldap_url(cls, value: Optional[str]) -> Optional[str]:
        if value is None or value == "":
            return value
        parsed = urlparse(value.strip())
        allow_private = str(os.getenv("AUTH_AD_LDAP_ALLOW_INSECURE") or os.getenv("AUTH_AD_OIDC_ALLOW_PRIVATE_ENDPOINTS") or "").strip().lower() in {"1", "true", "yes"}
        if parsed.scheme.lower() not in {"ldap", "ldaps"} or not parsed.netloc or not parsed.hostname:
            raise ValueError("LDAP URL debe ser ldap:// o ldaps:// absoluta")
        if parsed.scheme.lower() == "ldap" and not allow_private:
            raise ValueError("LDAP debe usar LDAPS en produccion")
        return value.strip()

    @field_validator("ldap_base_dn", "ldap_user_attribute", "ldap_bind_pattern")
    @classmethod
    def validate_ldap_text(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        if any(char in value for char in ("\x00", "\r", "\n", "\t")):
            raise ValueError("Valor LDAP invalido")
        clean = value.strip()
        return clean

class AuthAdExchangeRequest(BaseModel):
    code: str = Field(min_length=1, max_length=512)

class AuthAdPasswordLoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=320)
    password: str = Field(min_length=1, max_length=1024)

class AuthAdTestResponse(BaseModel):
    ok: bool
    message: str
    discovery_issuer: Optional[str] = None

# --- ROLES PERSONALIZADOS ---

class RolPersonalizadoBase(BaseModel):
    nombre: str = Field(min_length=1, max_length=MAX_ROLE_NAME_LENGTH)
    descripcion: Optional[str] = Field(default=None, max_length=MAX_ROLE_DESCRIPTION_LENGTH)
    modulos: List[str] = Field(default_factory=list, max_length=MAX_RBAC_MODULES)
    permisos: Dict[str, str] = Field(default_factory=dict)
    permisos_detallados: Dict[str, str] = Field(default_factory=dict)
    activo: bool = True

    @field_validator("modulos")
    @classmethod
    def validate_modulos(cls, value: List[str]) -> List[str]:
        return _validate_module_list(value) or []

    @field_validator("permisos")
    @classmethod
    def validate_permisos(cls, value: Dict[str, str]) -> Dict[str, str]:
        return _validate_permission_map(value) or {}

    @field_validator("permisos_detallados")
    @classmethod
    def validate_permisos_detallados(cls, value: Dict[str, str]) -> Dict[str, str]:
        return _validate_capability_map(value) or {}

class RolPersonalizadoCreate(RolPersonalizadoBase):
    pass

class RolPersonalizadoUpdate(BaseModel):
    nombre: Optional[str] = Field(default=None, min_length=1, max_length=MAX_ROLE_NAME_LENGTH)
    descripcion: Optional[str] = Field(default=None, max_length=MAX_ROLE_DESCRIPTION_LENGTH)
    modulos: Optional[List[str]] = Field(default=None, max_length=MAX_RBAC_MODULES)
    permisos: Optional[Dict[str, str]] = None
    permisos_detallados: Optional[Dict[str, str]] = None
    activo: Optional[bool] = None

    @field_validator("modulos")
    @classmethod
    def validate_modulos(cls, value: Optional[List[str]]) -> Optional[List[str]]:
        return _validate_module_list(value)

    @field_validator("permisos")
    @classmethod
    def validate_permisos(cls, value: Optional[Dict[str, str]]) -> Optional[Dict[str, str]]:
        return _validate_permission_map(value)

    @field_validator("permisos_detallados")
    @classmethod
    def validate_permisos_detallados(cls, value: Optional[Dict[str, str]]) -> Optional[Dict[str, str]]:
        return _validate_capability_map(value)

class RolPersonalizado(RolPersonalizadoBase):
    id: UUID
    fecha_creacion: datetime

    model_config = ConfigDict(from_attributes=True)

class UsuarioBase(BaseModel):
    email: str = Field(min_length=3, max_length=MAX_USER_EMAIL_LENGTH)
    nombre_completo: Optional[str] = Field(default=None, max_length=MAX_USER_NAME_LENGTH)
    rol: Rol = Rol.TESTER
    rol_custom_id: Optional[UUID] = None
    auth_provider: str = Field(default="local", min_length=1, max_length=MAX_USER_AUTH_PROVIDER_LENGTH)
    modulos: List[str] = Field(default_factory=list, max_length=MAX_RBAC_MODULES)
    permisos: Dict[str, str] = Field(default_factory=dict)
    permisos_detallados: Dict[str, str] = Field(default_factory=dict)

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        return _normalize_email(value) or value

    @field_validator("auth_provider")
    @classmethod
    def validate_auth_provider(cls, value: str) -> str:
        return _validate_auth_provider(value) or value

    @field_validator("modulos")
    @classmethod
    def validate_modulos(cls, value: List[str]) -> List[str]:
        return _validate_module_list(value) or []

    @field_validator("permisos")
    @classmethod
    def validate_permisos(cls, value: Dict[str, str]) -> Dict[str, str]:
        return _validate_permission_map(value) or {}

    @field_validator("permisos_detallados")
    @classmethod
    def validate_permisos_detallados(cls, value: Dict[str, str]) -> Dict[str, str]:
        return _validate_capability_map(value) or {}

class UsuarioCreate(UsuarioBase):
    password: str = Field(min_length=8, max_length=MAX_USER_PASSWORD_LENGTH)

    @field_validator("password")
    @classmethod
    def validate_password(cls, value: str) -> str:
        return _validate_password(value) or value

class UsuarioAdminCreate(UsuarioBase):
    password: Optional[str] = Field(default=None, min_length=8, max_length=MAX_USER_PASSWORD_LENGTH)
    activo: bool = True

    @field_validator("password")
    @classmethod
    def validate_password(cls, value: Optional[str]) -> Optional[str]:
        return _validate_password(value)

class UsuarioUpdate(BaseModel):
    email: Optional[str] = Field(default=None, min_length=3, max_length=MAX_USER_EMAIL_LENGTH)
    nombre_completo: Optional[str] = Field(default=None, max_length=MAX_USER_NAME_LENGTH)
    rol: Optional[Rol] = None
    rol_custom_id: Optional[UUID] = None
    auth_provider: Optional[str] = Field(default=None, min_length=1, max_length=MAX_USER_AUTH_PROVIDER_LENGTH)
    modulos: Optional[List[str]] = Field(default=None, max_length=MAX_RBAC_MODULES)
    permisos: Optional[Dict[str, str]] = None
    permisos_detallados: Optional[Dict[str, str]] = None
    activo: Optional[bool] = None
    password: Optional[str] = Field(default=None, min_length=8, max_length=MAX_USER_PASSWORD_LENGTH)

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: Optional[str]) -> Optional[str]:
        return _normalize_email(value)

    @field_validator("auth_provider")
    @classmethod
    def validate_auth_provider(cls, value: Optional[str]) -> Optional[str]:
        return _validate_auth_provider(value)

    @field_validator("modulos")
    @classmethod
    def validate_modulos(cls, value: Optional[List[str]]) -> Optional[List[str]]:
        return _validate_module_list(value)

    @field_validator("permisos")
    @classmethod
    def validate_permisos(cls, value: Optional[Dict[str, str]]) -> Optional[Dict[str, str]]:
        return _validate_permission_map(value)

    @field_validator("permisos_detallados")
    @classmethod
    def validate_permisos_detallados(cls, value: Optional[Dict[str, str]]) -> Optional[Dict[str, str]]:
        return _validate_capability_map(value)

    @field_validator("password")
    @classmethod
    def validate_password(cls, value: Optional[str]) -> Optional[str]:
        return _validate_password(value)

class UsuarioAdLookupRequest(BaseModel):
    query: str = Field(min_length=1, max_length=320)
    limit: int = Field(default=8, ge=1, le=20)

    @field_validator("query")
    @classmethod
    def validate_query(cls, value: str) -> str:
        if any(char in value for char in ("\x00", "\r", "\n", "\t", "*", "(", ")", "\\")):
            raise ValueError("Usuario AD invalido")
        clean = value.strip()
        if not clean:
            raise ValueError("Usuario AD invalido")
        return clean

class UsuarioAdLookupItem(BaseModel):
    email: Optional[str] = None
    name: Optional[str] = None
    username: Optional[str] = None
    upn: Optional[str] = None
    groups: List[str] = Field(default_factory=list)

class UsuarioAdLookupResponse(BaseModel):
    found: bool
    email: Optional[str] = None
    name: Optional[str] = None
    username: Optional[str] = None
    upn: Optional[str] = None
    groups: List[str] = Field(default_factory=list)
    results: List[UsuarioAdLookupItem] = Field(default_factory=list)

class UsuarioAdSyncRequest(BaseModel):
    deactivate_missing: bool = True
    limit: int = Field(default=500, ge=1, le=1000)

class UsuarioAdSyncItem(BaseModel):
    user_id: str
    email: str
    status: str
    previous_email: Optional[str] = None
    new_email: Optional[str] = None
    previous_name: Optional[str] = None
    new_name: Optional[str] = None
    groups: List[str] = Field(default_factory=list)
    error: Optional[str] = None

class UsuarioAdSyncResponse(BaseModel):
    total: int
    ok: int
    updated: int
    missing: int
    errors: int
    deactivated: int
    results: List[UsuarioAdSyncItem]

class UserProfileUpdate(BaseModel):
    nombre_completo: Optional[str] = Field(default=None, max_length=MAX_USER_NAME_LENGTH)
    display_name: Optional[str] = Field(default=None, max_length=80)
    avatar_provider: Optional[str] = Field(default=None, max_length=30)

class UserPreferencesUpdate(BaseModel):
    personal_theme: Optional[str] = Field(default=None, max_length=MAX_PERSONAL_THEME_LENGTH)
    profile_settings: Optional[Dict[str, Any]] = None
    project_theme_overrides: Optional[Dict[str, Any]] = None

    @field_validator("personal_theme")
    @classmethod
    def validate_personal_theme(cls, value: Optional[str]) -> Optional[str]:
        return validate_personal_theme_id(value)

    @field_validator("profile_settings")
    @classmethod
    def validate_profile_settings(cls, value: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        return validate_preference_json_payload(
            value,
            max_bytes=MAX_PROFILE_SETTINGS_BYTES,
            label="La configuracion de perfil",
        )

    @field_validator("project_theme_overrides")
    @classmethod
    def validate_project_theme_overrides(cls, value: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        return validate_preference_json_payload(
            value,
            max_bytes=MAX_PROJECT_THEME_OVERRIDES_BYTES,
            label="La configuracion de temas por proyecto",
        )

class Usuario(UsuarioBase):
    id: UUID
    activo: bool
    rol_nombre: Optional[str] = None
    display_name: Optional[str] = None
    avatar_url: Optional[str] = None
    avatar_provider: str = "gravatar"
    profile_settings: Dict[str, Any] = {}
    personal_theme: str = "system"
    project_theme_overrides: Dict[str, Any] = {}
    
    model_config = ConfigDict(from_attributes=True)

class UserPreferences(BaseModel):
    personal_theme: str = "system"
    profile_settings: Dict[str, Any] = {}
    project_theme_overrides: Dict[str, Any] = {}

class UserPasswordChange(BaseModel):
    current_password: str = Field(min_length=1, max_length=MAX_USER_PASSWORD_LENGTH)
    new_password: str = Field(min_length=8, max_length=MAX_USER_PASSWORD_LENGTH)

    @field_validator("new_password")
    @classmethod
    def validate_new_password(cls, value: str) -> str:
        return _validate_password(value) or value

class ApiKeyCreate(BaseModel):
    nombre: str = Field(default="Automatizacion externa", min_length=1, max_length=100)

class ApiKey(BaseModel):
    id: UUID
    nombre: str
    key_prefix: str
    activo: bool
    fecha_creacion: datetime
    ultimo_uso: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)

class ApiKeyCreated(ApiKey):
    api_key: str

class AuditLog(BaseModel):
    id: UUID
    usuario_id: Optional[UUID] = None
    accion: str
    recurso: str
    recurso_id: Optional[UUID] = None
    detalles: Optional[dict] = None
    ip_address: Optional[str] = None
    fecha: datetime
    
    model_config = ConfigDict(from_attributes=True)

# --- FUNCIONES AUTOMATIZADAS ---
