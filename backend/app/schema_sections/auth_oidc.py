from .auth_common import *

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
