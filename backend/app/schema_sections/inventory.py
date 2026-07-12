from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, Field, field_serializer, field_validator

from .auth import validate_preference_json_payload
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

MAX_ENV_NAME_LENGTH = 100
MAX_ENV_URL_LENGTH = 255
MAX_ENV_STATUS_LENGTH = 50
MAX_ENV_VERSION_LENGTH = 50
MAX_ENV_VARIABLES_BYTES = 64 * 1024
MAX_DATASET_NAME_LENGTH = 100
MAX_DATASET_DESCRIPTION_LENGTH = 12000
MAX_DATASET_VARIABLES_BYTES = 128 * 1024
MAX_DEVICE_NAME_LENGTH = 100
MAX_DEVICE_FIELD_LENGTH = 100
MAX_DEVICE_RESOLUTION_LENGTH = 50
MAX_NODE_NAME_LENGTH = 100
MAX_NODE_IP_LENGTH = 50
MAX_NODE_STATUS_LENGTH = 50
MAX_ASSET_NAME_LENGTH = 150
MAX_ASSET_TYPE_LENGTH = 80
MAX_ASSET_FIELD_LENGTH = 150
MAX_ASSET_DESCRIPTION_LENGTH = 12000
MAX_ASSET_METADATA_BYTES = 128 * 1024
MAX_ENDPOINT_VALUE_LENGTH = 500
MAX_ENDPOINT_DESCRIPTION_LENGTH = 255

INVENTORY_ASSET_TYPES = {
    "Servidor",
    "Computadora",
    "Laptop",
    "Dispositivo movil",
    "Tablet",
    "Router/Switch",
    "Impresora",
    "Dispositivo IoT",
    "Nodo de ejecucion",
    "Maquina virtual",
    "Contenedor",
    "Herramienta digital",
    "Servicio",
    "API",
    "Base de datos",
    "Otro",
}
INVENTORY_ASSET_NATURES = {"fisico", "virtual", "digital"}
INVENTORY_ASSET_STATUSES = {"Activo", "Online", "Offline", "Mantenimiento", "En Pausa", "Retirado", "Desconocido"}
INVENTORY_ASSET_CRITICALITIES = {"Baja", "Media", "Alta", "Critica"}
INVENTORY_ENDPOINT_TYPES = {"ip", "url", "hostname", "dns", "puerto", "otro"}


def validate_environment_url(value: Optional[str]) -> Optional[str]:
    if value is None:
        return value
    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("environment URL must be absolute HTTP/HTTPS")
    if parsed.username or parsed.password:
        raise ValueError("environment URL cannot include credentials")
    return value.rstrip("/")


def validate_environment_variables(value: Optional[Dict[str, str]], *, max_bytes: int, label: str) -> Optional[Dict[str, str]]:
    return validate_preference_json_payload(value, max_bytes=max_bytes, label=label)


class EntornoBase(BaseModel):
    nombre: str = Field(..., min_length=1, max_length=MAX_ENV_NAME_LENGTH)
    url: str = Field(..., min_length=1, max_length=MAX_ENV_URL_LENGTH)
    status: Optional[str] = Field(default="Unknown", max_length=MAX_ENV_STATUS_LENGTH)
    version: Optional[str] = Field(default=None, max_length=MAX_ENV_VERSION_LENGTH)
    variables: Dict[str, str] = Field(default_factory=dict)
    activo: bool = True

    @field_validator("url")
    @classmethod
    def validate_url(cls, value):
        return validate_environment_url(value)

    @field_validator("variables")
    @classmethod
    def validate_variables(cls, value):
        return validate_environment_variables(value, max_bytes=MAX_ENV_VARIABLES_BYTES, label="Las variables del entorno") or {}

class EntornoCreate(EntornoBase):
    proyecto_id: UUID

class EntornoUpdate(BaseModel):
    nombre: Optional[str] = Field(default=None, min_length=1, max_length=MAX_ENV_NAME_LENGTH)
    url: Optional[str] = Field(default=None, min_length=1, max_length=MAX_ENV_URL_LENGTH)
    status: Optional[str] = Field(default=None, max_length=MAX_ENV_STATUS_LENGTH)
    version: Optional[str] = Field(default=None, max_length=MAX_ENV_VERSION_LENGTH)
    variables: Optional[Dict[str, str]] = None
    activo: Optional[bool] = None

    @field_validator("url")
    @classmethod
    def validate_url(cls, value):
        return validate_environment_url(value)

    @field_validator("variables")
    @classmethod
    def validate_variables(cls, value):
        return validate_environment_variables(value, max_bytes=MAX_ENV_VARIABLES_BYTES, label="Las variables del entorno")

class EntornoDatasetBase(BaseModel):
    nombre: str = Field(..., min_length=1, max_length=MAX_DATASET_NAME_LENGTH)
    descripcion: Optional[str] = Field(default=None, max_length=MAX_DATASET_DESCRIPTION_LENGTH)
    variables: Dict[str, str] = Field(default_factory=dict)
    activo: bool = True
    es_default: bool = False

    @field_validator("variables")
    @classmethod
    def validate_variables(cls, value):
        return validate_environment_variables(value, max_bytes=MAX_DATASET_VARIABLES_BYTES, label="Las variables del dataset") or {}

class EntornoDatasetCreate(EntornoDatasetBase):
    pass

class EntornoDatasetUpdate(BaseModel):
    nombre: Optional[str] = Field(default=None, min_length=1, max_length=MAX_DATASET_NAME_LENGTH)
    descripcion: Optional[str] = Field(default=None, max_length=MAX_DATASET_DESCRIPTION_LENGTH)
    variables: Optional[Dict[str, str]] = None
    activo: Optional[bool] = None
    es_default: Optional[bool] = None

    @field_validator("variables")
    @classmethod
    def validate_variables(cls, value):
        return validate_environment_variables(value, max_bytes=MAX_DATASET_VARIABLES_BYTES, label="Las variables del dataset")

class EntornoDataset(EntornoDatasetBase):
    id: UUID
    entorno_id: UUID
    fecha_creacion: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)

class Entorno(EntornoBase):
    id: UUID
    proyecto_id: UUID
    ultima_verificacion: Optional[datetime] = None
    datasets: List[EntornoDataset] = Field(default_factory=list)
    
    model_config = ConfigDict(from_attributes=True)

# --- INFRAESTRUCTURA ---

class DispositivoBase(BaseModel):
    nombre: str = Field(..., min_length=1, max_length=MAX_DEVICE_NAME_LENGTH)
    tipo: Optional[str] = Field(default=None, max_length=MAX_DEVICE_FIELD_LENGTH)
    browser: Optional[str] = Field(default=None, max_length=MAX_DEVICE_FIELD_LENGTH)
    resolucion: Optional[str] = Field(default=None, max_length=MAX_DEVICE_RESOLUTION_LENGTH)
    status: Optional[str] = Field(default="Active", max_length=MAX_ENV_STATUS_LENGTH)
    es_simulador: bool = False

class Dispositivo(DispositivoBase):
    id: UUID
    
    model_config = ConfigDict(from_attributes=True)

class NodoEjecucionBase(BaseModel):
    nombre: str = Field(..., min_length=1, max_length=MAX_NODE_NAME_LENGTH)
    ip: Optional[str] = Field(default=None, max_length=MAX_NODE_IP_LENGTH)
    status: Optional[str] = Field(default="Offline", max_length=MAX_NODE_STATUS_LENGTH)

class NodoEjecucion(NodoEjecucionBase):
    id: UUID
    cpu_usage: int
    ram_usage: int
    total_ejecuciones: int
    ultima_conexion: datetime
    
    model_config = ConfigDict(from_attributes=True)


def validate_inventory_metadata(value: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    return validate_preference_json_payload(value, max_bytes=MAX_ASSET_METADATA_BYTES, label="La metadata del activo")


class InventoryEndpointBase(BaseModel):
    tipo: str = Field(default="ip", min_length=1, max_length=30)
    valor: str = Field(..., min_length=1, max_length=MAX_ENDPOINT_VALUE_LENGTH)
    puerto: Optional[int] = Field(default=None, ge=1, le=65535)
    protocolo: Optional[str] = Field(default=None, max_length=40)
    descripcion: Optional[str] = Field(default=None, max_length=MAX_ENDPOINT_DESCRIPTION_LENGTH)
    principal: bool = False
    activo: bool = True

    @field_validator("tipo")
    @classmethod
    def validate_tipo(cls, value: str):
        if value not in INVENTORY_ENDPOINT_TYPES:
            raise ValueError("tipo de endpoint invalido")
        return value


class InventoryEndpointCreate(InventoryEndpointBase):
    pass


class InventoryEndpointUpdate(BaseModel):
    tipo: Optional[str] = Field(default=None, min_length=1, max_length=30)
    valor: Optional[str] = Field(default=None, min_length=1, max_length=MAX_ENDPOINT_VALUE_LENGTH)
    puerto: Optional[int] = Field(default=None, ge=1, le=65535)
    protocolo: Optional[str] = Field(default=None, max_length=40)
    descripcion: Optional[str] = Field(default=None, max_length=MAX_ENDPOINT_DESCRIPTION_LENGTH)
    principal: Optional[bool] = None
    activo: Optional[bool] = None

    @field_validator("tipo")
    @classmethod
    def validate_tipo(cls, value: Optional[str]):
        if value is not None and value not in INVENTORY_ENDPOINT_TYPES:
            raise ValueError("tipo de endpoint invalido")
        return value


class InventoryEndpoint(InventoryEndpointBase):
    id: UUID
    asset_id: UUID
    fecha_creacion: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class InventoryAssetBase(BaseModel):
    categoria_id: Optional[str] = Field(default=None, max_length=100)
    parent_id: Optional[UUID] = None
    nombre: str = Field(..., min_length=1, max_length=MAX_ASSET_NAME_LENGTH)
    tipo: str = Field(..., min_length=1, max_length=MAX_ASSET_TYPE_LENGTH)
    naturaleza: str = Field(..., min_length=1, max_length=30)
    estado: str = Field(default="Activo", min_length=1, max_length=50)
    criticidad: str = Field(default="Media", min_length=1, max_length=30)
    descripcion: Optional[str] = Field(default=None, max_length=MAX_ASSET_DESCRIPTION_LENGTH)
    ubicacion: Optional[str] = Field(default=None, max_length=MAX_ASSET_FIELD_LENGTH)
    responsable: Optional[str] = Field(default=None, max_length=MAX_ASSET_FIELD_LENGTH)
    fabricante: Optional[str] = Field(default=None, max_length=120)
    modelo: Optional[str] = Field(default=None, max_length=120)
    serial: Optional[str] = Field(default=None, max_length=120)
    asset_tag: Optional[str] = Field(default=None, max_length=120)
    sistema_operativo: Optional[str] = Field(default=None, max_length=MAX_ASSET_FIELD_LENGTH)
    metadata: Dict[str, Any] = Field(default_factory=dict)
    activo: bool = True

    @field_validator("tipo")
    @classmethod
    def validate_tipo(cls, value: str):
        if value not in INVENTORY_ASSET_TYPES:
            raise ValueError("tipo de activo invalido")
        return value

    @field_validator("naturaleza")
    @classmethod
    def validate_naturaleza(cls, value: str):
        if value not in INVENTORY_ASSET_NATURES:
            raise ValueError("naturaleza de activo invalida")
        return value

    @field_validator("estado")
    @classmethod
    def validate_estado(cls, value: str):
        if value not in INVENTORY_ASSET_STATUSES:
            raise ValueError("estado de activo invalido")
        return value

    @field_validator("criticidad")
    @classmethod
    def validate_criticidad(cls, value: str):
        if value not in INVENTORY_ASSET_CRITICALITIES:
            raise ValueError("criticidad de activo invalida")
        return value

    @field_validator("metadata")
    @classmethod
    def validate_metadata(cls, value):
        return validate_inventory_metadata(value) or {}


class InventoryAssetCreate(InventoryAssetBase):
    endpoints: List[InventoryEndpointCreate] = Field(default_factory=list)


class InventoryAssetUpdate(BaseModel):
    categoria_id: Optional[str] = Field(default=None, max_length=100)
    parent_id: Optional[UUID] = None
    nombre: Optional[str] = Field(default=None, min_length=1, max_length=MAX_ASSET_NAME_LENGTH)
    tipo: Optional[str] = Field(default=None, min_length=1, max_length=MAX_ASSET_TYPE_LENGTH)
    naturaleza: Optional[str] = Field(default=None, min_length=1, max_length=30)
    estado: Optional[str] = Field(default=None, min_length=1, max_length=50)
    criticidad: Optional[str] = Field(default=None, min_length=1, max_length=30)
    descripcion: Optional[str] = Field(default=None, max_length=MAX_ASSET_DESCRIPTION_LENGTH)
    ubicacion: Optional[str] = Field(default=None, max_length=MAX_ASSET_FIELD_LENGTH)
    responsable: Optional[str] = Field(default=None, max_length=MAX_ASSET_FIELD_LENGTH)
    fabricante: Optional[str] = Field(default=None, max_length=120)
    modelo: Optional[str] = Field(default=None, max_length=120)
    serial: Optional[str] = Field(default=None, max_length=120)
    asset_tag: Optional[str] = Field(default=None, max_length=120)
    sistema_operativo: Optional[str] = Field(default=None, max_length=MAX_ASSET_FIELD_LENGTH)
    metadata: Optional[Dict[str, Any]] = None
    activo: Optional[bool] = None

    @field_validator("tipo")
    @classmethod
    def validate_tipo(cls, value: Optional[str]):
        if value is not None and value not in INVENTORY_ASSET_TYPES:
            raise ValueError("tipo de activo invalido")
        return value

    @field_validator("naturaleza")
    @classmethod
    def validate_naturaleza(cls, value: Optional[str]):
        if value is not None and value not in INVENTORY_ASSET_NATURES:
            raise ValueError("naturaleza de activo invalida")
        return value

    @field_validator("estado")
    @classmethod
    def validate_estado(cls, value: Optional[str]):
        if value is not None and value not in INVENTORY_ASSET_STATUSES:
            raise ValueError("estado de activo invalido")
        return value

    @field_validator("criticidad")
    @classmethod
    def validate_criticidad(cls, value: Optional[str]):
        if value is not None and value not in INVENTORY_ASSET_CRITICALITIES:
            raise ValueError("criticidad de activo invalida")
        return value

    @field_validator("metadata")
    @classmethod
    def validate_metadata(cls, value):
        return validate_inventory_metadata(value)


class InventoryAsset(InventoryAssetBase):
    id: UUID
    proyecto_id: UUID
    endpoints: List[InventoryEndpoint] = Field(default_factory=list)
    children_count: int = 0
    fecha_creacion: Optional[datetime] = None
    fecha_actualizacion: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)

# --- WIKI ---
