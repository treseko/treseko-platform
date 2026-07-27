"""Encryption boundary for AI provider credentials.

The AI vault deliberately does not derive its key from the JWT/session secret.
This allows independent credential rotation and prevents auth-key changes from
silently making provider credentials unreadable.
"""
from __future__ import annotations

import base64
import hashlib
import os
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken


def _master_key() -> bytes:
    value = os.getenv("AI_CREDENTIALS_MASTER_KEY", "").strip()
    path = os.getenv("AI_CREDENTIALS_MASTER_KEY_FILE", "").strip()
    if not value and path:
        try:
            value = Path(path).read_text(encoding="utf-8").strip()
        except OSError as exc:
            raise RuntimeError("No se pudo leer AI_CREDENTIALS_MASTER_KEY_FILE") from exc
    if not value:
        raise RuntimeError("AI_CREDENTIALS_MASTER_KEY_FILE es obligatorio para gestionar credenciales IA")
    if len(value.encode("utf-8")) < 32:
        raise RuntimeError("La clave maestra IA debe tener al menos 32 bytes")
    return value.encode("utf-8")


def _fernet_key(master: bytes) -> bytes:
    return base64.urlsafe_b64encode(hashlib.sha256(master).digest())


def ai_credential_key_id() -> str:
    return hashlib.sha256(_master_key()).hexdigest()[:16]


def encrypt_ai_credential(value: str) -> tuple[str, str]:
    secret = str(value or "").strip()
    if not secret or len(secret) > 4096 or "\x00" in secret:
        raise ValueError("La credencial IA es invalida")
    key = _master_key()
    return Fernet(_fernet_key(key)).encrypt(secret.encode("utf-8")).decode("ascii"), hashlib.sha256(key).hexdigest()[:16]


def decrypt_ai_credential(value: str, expected_key_id: str | None = None) -> str:
    key = _master_key()
    key_id = hashlib.sha256(key).hexdigest()[:16]
    if expected_key_id and expected_key_id != key_id:
        raise RuntimeError("La credencial IA fue cifrada con otra clave maestra")
    try:
        return Fernet(_fernet_key(key)).decrypt(str(value).encode("ascii")).decode("utf-8")
    except (InvalidToken, ValueError) as exc:
        raise RuntimeError("No se pudo descifrar la credencial IA") from exc
