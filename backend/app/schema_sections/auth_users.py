from .auth_common import *
from .auth_common import _normalize_email, _validate_auth_provider, _validate_capability_map, _validate_module_list, _validate_password, _validate_permission_map

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
    send_welcome: bool = False

    @field_validator("password")
    @classmethod
    def validate_password(cls, value: Optional[str]) -> Optional[str]:
        return _validate_password(value)


class WelcomeActivationRequest(BaseModel):
    token: str = Field(min_length=32, max_length=512)
    password: str = Field(min_length=8, max_length=MAX_USER_PASSWORD_LENGTH)

    @field_validator("password")
    @classmethod
    def validate_password(cls, value: str) -> str:
        return _validate_password(value) or value

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

class UserLanguageUpdate(BaseModel):
    language: str = Field(min_length=2, max_length=5)

    @field_validator("language")
    @classmethod
    def validate_language(cls, value: str) -> str:
        normalized = value.strip().lower()
        if normalized not in {"es", "en"}:
            raise ValueError("Idioma no soportado")
        return normalized

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

class UserPasswordChangeResponse(UserPreferences):
    access_token: str
    token_type: str = "bearer"
    expires_in: Optional[int] = None
    session_timeout_minutes: Optional[int] = None

class UserPasswordChange(BaseModel):
    current_password: str = Field(min_length=1, max_length=MAX_USER_PASSWORD_LENGTH)
    new_password: str = Field(min_length=8, max_length=MAX_USER_PASSWORD_LENGTH)

    @field_validator("new_password")
    @classmethod
    def validate_new_password(cls, value: str) -> str:
        return _validate_password(value) or value

from .auth_api_keys import ApiKey, ApiKeyCreate, ApiKeyCreated, AuditLog

# --- FUNCIONES AUTOMATIZADAS ---
