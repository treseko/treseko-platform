from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field, field_validator


class SystemLicenseInstallRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    edition: Literal["premium"]
    license_id: str = Field(min_length=1, max_length=120)
    customer_id: str = Field(min_length=1, max_length=120)
    plan_id: Optional[str] = Field(default=None, max_length=120)
    plan_name: Optional[str] = Field(default=None, max_length=200)
    plan_version: Optional[str] = Field(default=None, max_length=120)
    plan_custom: bool = False
    product: str = Field(default="treseko", max_length=80)
    instance_id: Optional[str] = Field(default=None, max_length=120)
    key_id: str = Field(min_length=1, max_length=120)
    issued_at: str = Field(min_length=1)
    expires_at: str = Field(min_length=1)
    revoked_at: Optional[str] = None
    verification_server: Optional[str] = Field(default=None, max_length=500)
    update_server: Optional[str] = Field(default=None, max_length=500)
    fallback_verification_servers: List[str] = Field(default_factory=list)
    fallback_update_servers: List[str] = Field(default_factory=list)
    activation_token: Optional[str] = Field(default=None, min_length=24, max_length=512)
    verification_interval_days: Optional[int] = Field(default=None, ge=1)
    grace_period_days: Optional[int] = Field(default=None, ge=1)
    max_organizations: Optional[int] = Field(default=None, ge=0)
    max_users: Optional[int] = Field(default=None, ge=0)
    max_projects: Optional[int] = Field(default=None, ge=0)
    max_workers: Optional[int] = Field(default=None, ge=0)
    max_automated_runs_per_week: Optional[int] = Field(default=None, ge=0)
    max_ai_runs_per_week: Optional[int] = Field(default=None, ge=0)
    max_storage_mb: Optional[int] = Field(default=None, ge=0)
    enabled_features: List[str] = Field(default_factory=list)
    features: List[str] = Field(default_factory=list)
    limits: Optional[Dict[str, int]] = None
    update_channel: str = Field(default="premium-stable", max_length=80)
    signature: str = Field(default="", max_length=512)


class SystemFeatureInfo(BaseModel):
    id: str
    label: str
    category: str
    edition: Literal["community", "premium"]
    enabled: bool


class SystemLicenseState(BaseModel):
    edition: Literal["community", "premium"]
    state: str
    valid: bool
    reason: Optional[str] = None
    license: Optional[Dict[str, Any]] = None
    limits: Dict[str, int]
    enabled_features: List[str]
    update_channel: str
    plan_id: Optional[str] = None
    plan_name: Optional[str] = None
    plan_version: Optional[str] = None
    plan_custom: bool = False
    issued_at: Optional[str] = None
    valid_until: Optional[str] = None
    activated_at: Optional[str] = None
    last_check_at: Optional[str] = None
    next_check_at: Optional[str] = None
    grace_until: Optional[str] = None
    verification_interval_days: Optional[int] = None
    grace_period_days: Optional[int] = None


class SystemLicenseUsageItem(BaseModel):
    used: float
    limit: Optional[int] = None
    percent: float


class SystemLicenseUsageResponse(BaseModel):
    organization_id: Optional[str] = None
    usage: Dict[str, SystemLicenseUsageItem]


class SystemTrustKeyringInfo(BaseModel):
    kind: Literal["license", "license_server", "update"]
    algorithm: str
    configured: bool
    source: Literal["embedded", "development_override"]
    development_override_enabled: bool
    key_count: int
    fingerprints: List[str]
    errors: List[str]


class SystemTrustResponse(BaseModel):
    license_keyring: SystemTrustKeyringInfo
    server_response_keyring: SystemTrustKeyringInfo
    update_keyring: SystemTrustKeyringInfo


class SystemEditionResponse(BaseModel):
    edition: Literal["community", "premium"]
    state: str
    update_channel: str
    limits: Dict[str, int]
    plan_id: Optional[str] = None
    plan_name: Optional[str] = None
    plan_version: Optional[str] = None
    plan_custom: bool = False


class SystemFeaturesResponse(BaseModel):
    edition: Literal["community", "premium"]
    state: str
    features: List[SystemFeatureInfo]
    limits: Dict[str, int]


class SystemBrandingPublicResponse(BaseModel):
    edition: Literal["community", "premium"]
    effective_brand_name: str
    effective_logo_url: str
    custom_branding_active: bool


class SystemBrandingState(BaseModel):
    edition: Literal["community", "premium"]
    can_customize: bool
    brand_name: str
    logo_url: Optional[str] = None
    enabled: bool
    effective_brand_name: str
    effective_logo_url: str
    custom_branding_active: bool


class SystemBrandingUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    brand_name: str = Field(min_length=1, max_length=80)
    logo_url: Optional[str] = Field(default=None, max_length=500)
    enabled: bool = True

    @field_validator("brand_name")
    @classmethod
    def validate_brand_name(cls, value: str) -> str:
        normalized = " ".join(str(value or "").strip().split())
        if not normalized:
            raise ValueError("El nombre de marca es requerido")
        return normalized

    @field_validator("logo_url")
    @classmethod
    def validate_logo_url(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        normalized = str(value or "").strip()
        if not normalized:
            return None
        if not normalized.startswith("/static/branding/"):
            raise ValueError("El logo debe cargarse desde branding")
        if any(char in normalized for char in ["\x00", "\r", "\n", "\\"]):
            raise ValueError("URL de logo invalida")
        return normalized


class SystemTimeSettings(BaseModel):
    timezone: str = Field(default="America/Argentina/Buenos_Aires", min_length=1, max_length=120)

    @field_validator("timezone")
    @classmethod
    def validate_timezone(cls, value: str) -> str:
        normalized = str(value or "").strip()
        try:
            ZoneInfo(normalized)
        except ZoneInfoNotFoundError as exc:
            raise ValueError("Zona horaria invalida") from exc
        return normalized


class SystemFirstRunState(BaseModel):
    completed: bool
    requires_onboarding: bool
    installation_has_data: bool
    completion_source: Optional[str] = None
    completed_at: Optional[str] = None
    completed_by_user_id: Optional[str] = None
    terms_version: Optional[str] = None


class SystemFirstRunCompleteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    survey: Dict[str, Any] = Field(default_factory=dict)
    terms_accepted: bool
    terms_version: str = Field(min_length=1, max_length=120)
    telemetry_opt_in: bool = False
    telemetry_status: Optional[str] = Field(default=None, max_length=80)
    telemetry_endpoint: Optional[str] = Field(default=None, max_length=500)
    telemetry_last_error: Optional[str] = Field(default=None, max_length=1000)


class SystemUpdateManifest(BaseModel):
    edition: Literal["community", "premium"]
    key_id: Optional[str] = Field(default=None, max_length=120)
    channel: str = Field(min_length=1, max_length=80)
    version: str = Field(min_length=1, max_length=80)
    artifact: Optional[str] = Field(
        default=None,
        max_length=255,
        description="Nombre exacto del artefacto publicado por el Update Server.",
    )
    artifact_type: Optional[str] = Field(
        default=None,
        max_length=80,
        description="Tipo del artefacto, por ejemplo treseko-self-hosted.",
    )
    package_size_bytes: Optional[int] = Field(
        default=None,
        ge=1,
        description="Tamano del artefacto en bytes segun el manifest lateral de release.",
    )
    released_at: Optional[str] = None
    notes_url: Optional[str] = Field(default=None, max_length=500)
    package_url: str = Field(
        min_length=1,
        max_length=1000,
        description="Community usa URL descargable. Premium debe usar una referencia opaca; la URL real requiere DownloadGrant.",
    )
    checksum_sha256: str = Field(min_length=1, max_length=128)
    signature: Optional[str] = Field(default=None, max_length=512)


class SystemUpdateCheckRequest(BaseModel):
    manifest: SystemUpdateManifest


class SystemUpdateChannelInfo(BaseModel):
    id: str
    edition: Literal["community", "premium"]
    allowed: bool
    reason: Optional[str] = None


class SystemUpdateChannelsResponse(BaseModel):
    edition: Literal["community", "premium"]
    state: str
    active_channel: str
    channels: List[SystemUpdateChannelInfo]


class SystemUpdateCheckResponse(BaseModel):
    allowed: bool
    edition: Literal["community", "premium"]
    channel: str
    version: str
    artifact: Optional[str] = None
    artifact_type: Optional[str] = None
    package_size_bytes: Optional[int] = None
    package_url: Optional[str] = None
    checksum_sha256: str
    download_grant_required: bool = False
    update_server_path: Optional[str] = None


class SystemPremiumUpdateCheckRequest(BaseModel):
    manifest: SystemUpdateManifest


class SystemPremiumUpdateCheckResponse(BaseModel):
    available: bool
    current_version: str
    latest_version: Optional[str] = None
    version: Optional[str] = None
    channel: Optional[str] = None
    edition: Literal["premium"] = "premium"
    artifact: Optional[str] = None
    artifact_type: Optional[str] = None
    package_size_bytes: Optional[int] = None
    checksum_sha256: Optional[str] = None
    download_grant_required: bool = True
    update_server_path: Optional[str] = None
    changelog: Optional[Any] = None
    published_at: Optional[str] = None
    requires_migration: bool = False
    min_backend_version: Optional[str] = None
    manifest: Dict[str, Any]


class SystemLatestUpdateResponse(BaseModel):
    edition: Literal["community", "premium"]
    state: str
    update_channel: str
    current_version: str
    updates_enabled: bool = False
    available: bool = False
    latest_version: Optional[str] = None
    version: Optional[str] = None
    channel: Optional[str] = None
    artifact: Optional[str] = None
    artifact_type: Optional[str] = None
    package_size_bytes: Optional[int] = None
    checksum_sha256: Optional[str] = None
    changelog: Optional[Any] = None
    published_at: Optional[str] = None
    requires_migration: bool = False
    min_backend_version: Optional[str] = None
    manifest: Optional[Dict[str, Any]] = None
    last_checked_at: Optional[str] = None
    error: Optional[str] = None
    reason: Optional[str] = None


class SystemUpdateDownloadGrantPrepareRequest(BaseModel):
    manifest: SystemUpdateManifest


class SystemUpdateDownloadGrantPrepareResponse(BaseModel):
    grant_required: bool
    reason: Optional[str] = None
    update_server_path: Optional[str] = None
    license: Optional[Dict[str, Any]] = None
    manifest: Dict[str, Any]
    artifact: Optional[str] = None
    artifact_type: Optional[str] = None
    package_size_bytes: Optional[int] = None
    checksum_sha256: str


class SystemCommunityUpdateCheckResponse(BaseModel):
    available: bool
    current_version: str
    latest_version: Optional[str] = None
    version: Optional[str] = None
    channel: Optional[str] = None
    checksum_sha256: Optional[str] = None
    package_size_bytes: Optional[int] = None
    changelog: Optional[Any] = None
    published_at: Optional[str] = None
    requires_migration: bool = False
    min_backend_version: Optional[str] = None
    manifest: Optional[Dict[str, Any]] = None
    error: Optional[str] = None


class SystemUpdateApplyRequest(BaseModel):
    channel: str = Field(default="community-stable", min_length=1, max_length=80)
    manifest: Optional[Dict[str, Any]] = None
    force: bool = False
    confirmation: Optional[str] = None


class SystemUpdateApplyResponse(BaseModel):
    task_id: str
    status: str


class SystemUpdateRollbackRequest(BaseModel):
    restore_database: bool = False
    confirmation: Optional[str] = None


class SystemUpdateStatusResponse(BaseModel):
    task_id: str
    status: str
    channel: str = ""
    current_version: str
    pending_version: Optional[str] = None
    version: Optional[str] = None
    previous_version: Optional[str] = None
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    progress_pct: int = 0
    stage: str = "idle"
    message: str = ""
    error: Optional[str] = None
    backup_path: Optional[str] = None
    rollback_path: Optional[str] = None
    package_path: Optional[str] = None
    extracted_path: Optional[str] = None
    initiated_by_user_id: Optional[str] = None
    initiated_by_email: Optional[str] = None
    initiated_from_ip: Optional[str] = None
    apply_confirmation: Optional[str] = None
    rollback_by_user_id: Optional[str] = None
    rollback_by_email: Optional[str] = None
    rollback_from_ip: Optional[str] = None
    rollback_requested_at: Optional[str] = None
    rollback_restore_database: bool = False
    rollback_confirmation: Optional[str] = None
    events: List[Dict[str, Any]] = Field(default_factory=list)


class SystemUpdateHistoryResponse(BaseModel):
    tasks: List[SystemUpdateStatusResponse]
