"""seed safe reusable Chatbot profiles on existing environments"""

from copy import deepcopy
import json

from alembic import op
import sqlalchemy as sa


revision = "20260815_0053"
down_revision = "20260814_0052"
branch_labels = None
depends_on = None


SYSTEM_CHATBOT_PROFILES = [
    {
        "id": "usuario_mayor",
        "name": "Usuario mayor",
        "description": "Poca experiencia digital y escritura simple.",
        "profile": {"name": "Jorge", "age": 65, "gender": "no especificado", "language": "es", "writing_level": "low", "spelling_errors": True, "tone": "confused", "goal": ""},
    },
    {
        "id": "cliente_molesto",
        "name": "Cliente molesto",
        "description": "Busca una solución rápida y expresa frustración.",
        "profile": {"name": "", "age": "", "gender": "no especificado", "language": "es", "writing_level": "medium", "spelling_errors": False, "tone": "frustrated", "goal": ""},
    },
    {
        "id": "usuario_experto",
        "name": "Usuario experto",
        "description": "Escribe con precisión y utiliza términos técnicos.",
        "profile": {"name": "", "age": "", "gender": "no especificado", "language": "es", "writing_level": "high", "spelling_errors": False, "tone": "formal", "goal": ""},
    },
    {
        "id": "usuario_novato",
        "name": "Usuario novato",
        "description": "Necesita instrucciones paso a paso y confirma sus dudas.",
        "profile": {"name": "", "age": "", "gender": "no especificado", "language": "es", "writing_level": "low", "spelling_errors": True, "tone": "confused", "goal": ""},
    },
    {
        "id": "usuario_apresurado",
        "name": "Usuario apresurado",
        "description": "Escribe mensajes breves y espera una respuesta directa.",
        "profile": {"name": "", "age": "", "gender": "no especificado", "language": "es", "writing_level": "medium", "spelling_errors": False, "tone": "neutral", "goal": ""},
    },
]


def upgrade() -> None:
    table = sa.table(
        "entornos",
        sa.column("id"),
        sa.column("configuracion_chatbot", sa.JSON()),
    )
    bind = op.get_bind()
    rows = bind.execute(sa.select(table.c.id, table.c.configuracion_chatbot)).fetchall()
    for environment_id, raw_config in rows:
        if isinstance(raw_config, str):
            try:
                raw_config = json.loads(raw_config)
            except (TypeError, ValueError):
                raw_config = {}
        config = deepcopy(raw_config) if isinstance(raw_config, dict) else {}
        profiles = config.get("profiles") or config.get("perfiles")
        if profiles:
            continue
        config["profiles"] = deepcopy(SYSTEM_CHATBOT_PROFILES)
        config.setdefault("default_profile", SYSTEM_CHATBOT_PROFILES[0]["id"])
        bind.execute(
            table.update().where(table.c.id == environment_id).values(configuracion_chatbot=config)
        )


def downgrade() -> None:
    # Deliberately preserve seeded or subsequently edited profiles. Removing
    # JSON content during a downgrade could destroy environment configuration.
    pass
