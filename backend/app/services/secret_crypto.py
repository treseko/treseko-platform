from __future__ import annotations

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken

from .. import auth


def _fernet() -> Fernet:
    key = base64.urlsafe_b64encode(hashlib.sha256(auth.SECRET_KEY.encode("utf-8")).digest())
    return Fernet(key)


def encrypt_secret_value(value: str) -> str:
    return _fernet().encrypt(str(value).encode("utf-8")).decode("ascii")


def decrypt_secret_value(value: str) -> str:
    try:
        return _fernet().decrypt(str(value).encode("ascii")).decode("utf-8")
    except InvalidToken as exc:
        raise ValueError("No se pudo descifrar el secreto almacenado") from exc
