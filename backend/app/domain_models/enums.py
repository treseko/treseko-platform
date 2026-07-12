import enum

class Prioridad(str, enum.Enum):
    ALTA = "ALTA"
    MEDIA = "MEDIA"
    BAJA = "BAJA"

class Criticidad(str, enum.Enum):
    CRITICA = "CRITICA"
    ALTA = "ALTA"
    MEDIA = "MEDIA"
    BAJA = "BAJA"

class TipoPrueba(str, enum.Enum):
    MANUAL = "MANUAL"
    AUTOMATIZADA = "AUTOMATIZADA"
    AUTOMATIZADA_AI = "AUTOMATIZADA_AI"

class EstadoCaso(str, enum.Enum):
    ACTIVO = "ACTIVO"
    DEPRECADO = "DEPRECADO"
    EN_REVISION = "EN_REVISION"
    ARCHIVADO = "ARCHIVADO"

class EstadoRun(str, enum.Enum):
    ABIERTO = "ABIERTO"
    EN_PROGRESO = "EN_PROGRESO"
    CERRADO = "CERRADO"

class EstadoResultado(str, enum.Enum):
    PASO = "PASO"
    FALLO = "FALLO"
    BLOQUEADO = "BLOQUEADO"
    SIN_CORRER = "SIN_CORRER"
    EJECUTANDO_AI = "EJECUTANDO_AI"

class ExecutionMode(str, enum.Enum):
    MANUAL = "MANUAL"
    IA = "IA"
    AUTOMATIZADA = "AUTOMATIZADA"
    EXTERNA = "EXTERNA"

class AiReviewStatus(str, enum.Enum):
    NO_REQUIERE_REVISION = "NO_REQUIERE_REVISION"
    REQUIERE_REVISION = "REQUIERE_REVISION"
    REVISADA = "REVISADA"

class AutomationJobStatus(str, enum.Enum):
    PENDING = "PENDING"
    CLAIMED = "CLAIMED"
    RUNNING = "RUNNING"
    PASSED = "PASSED"
    FAILED = "FAILED"
    BLOCKED = "BLOCKED"
    ERROR = "ERROR"
    TIMEOUT = "TIMEOUT"
    CANCELLED = "CANCELLED"
    BLOCKED_BY_RUNNER = "BLOCKED_BY_RUNNER"

class Rol(str, enum.Enum):
    ADMIN = "ADMIN"
    QA_LEAD = "QA_LEAD"
    TESTER = "TESTER"
    VIEWER = "VIEWER"
