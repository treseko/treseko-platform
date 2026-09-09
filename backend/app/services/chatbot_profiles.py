"""Safe, reusable Chatbot personas available to QA environments."""


SYSTEM_CHATBOT_PROFILES = [
    {
        "id": "usuario_mayor",
        "name": "Usuario mayor",
        "description": "Poca experiencia digital y escritura simple.",
        "profile": {
            "name": "Jorge", "age": 65, "gender": "no especificado", "language": "es",
            "writing_level": "low", "spelling_errors": True, "tone": "confused", "goal": "",
        },
    },
    {
        "id": "cliente_molesto",
        "name": "Cliente molesto",
        "description": "Busca una solución rápida y expresa frustración.",
        "profile": {
            "name": "", "age": "", "gender": "no especificado", "language": "es",
            "writing_level": "medium", "spelling_errors": False, "tone": "frustrated", "goal": "",
        },
    },
    {
        "id": "usuario_experto",
        "name": "Usuario experto",
        "description": "Escribe con precisión y utiliza términos técnicos.",
        "profile": {
            "name": "", "age": "", "gender": "no especificado", "language": "es",
            "writing_level": "high", "spelling_errors": False, "tone": "formal", "goal": "",
        },
    },
    {
        "id": "usuario_novato",
        "name": "Usuario novato",
        "description": "Necesita instrucciones paso a paso y confirma sus dudas.",
        "profile": {
            "name": "", "age": "", "gender": "no especificado", "language": "es",
            "writing_level": "low", "spelling_errors": True, "tone": "confused", "goal": "",
        },
    },
    {
        "id": "usuario_apresurado",
        "name": "Usuario apresurado",
        "description": "Escribe mensajes breves y espera una respuesta directa.",
        "profile": {
            "name": "", "age": "", "gender": "no especificado", "language": "es",
            "writing_level": "medium", "spelling_errors": False, "tone": "neutral", "goal": "",
        },
    },
]
