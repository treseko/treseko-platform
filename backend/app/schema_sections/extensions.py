from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


ExtensionKind = Literal["integration", "plugin"]


class ExtensionCapability(BaseModel):
    id: str
    label: str
    level: str = "read"


class ExtensionInstanceSummary(BaseModel):
    id: UUID
    provider_id: str
    kind: ExtensionKind
    enabled: bool
    status: str
    config_json: Dict[str, Any] = Field(default_factory=dict)
    secrets_configured: Dict[str, Any] = Field(default_factory=dict)
    last_check_at: Optional[str] = None
    last_error: Optional[str] = None
    audit_events: List[Dict[str, Any]] = Field(default_factory=list)


class ExtensionCatalogItem(BaseModel):
    id: str
    kind: ExtensionKind
    display_name: str
    description: Optional[str] = None
    status: str
    builtin: bool = False
    capabilities: List[ExtensionCapability] = Field(default_factory=list)
    premium_feature: Optional[str] = None
    premium_required: bool = False
    installed: bool = False
    instance: Optional[ExtensionInstanceSummary] = None


class ExtensionCatalogResponse(BaseModel):
    items: List[ExtensionCatalogItem]


class ExtensionInstallRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    organizacion_id: Optional[UUID] = None
    proyecto_id: Optional[UUID] = None


class ExtensionUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    config_json: Dict[str, Any] = Field(default_factory=dict)


class ExtensionSecretsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    secrets: Dict[str, str] = Field(default_factory=dict)


class ExtensionTestResponse(BaseModel):
    ok: bool
    status: str
    message: str
    instance: ExtensionInstanceSummary
