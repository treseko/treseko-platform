"""Safe local bind-address backport for older Community Compose packages."""

from __future__ import annotations

import os
import tempfile
from pathlib import Path


LEGACY_MAPPING = '      - "${TRESEKO_HTTP_PORT:-9095}:80"'
COMPATIBLE_MAPPING = '      - "${TRESEKO_BIND_ADDRESS:-127.0.0.1}:${TRESEKO_HTTP_PORT:-9095}:80"'
PUBLIC_COMPATIBLE_MAPPING = '      - "${TRESEKO_BIND_ADDRESS:-0.0.0.0}:${TRESEKO_HTTP_PORT:-9095}:80"'
COMPATIBLE_MAPPINGS = (COMPATIBLE_MAPPING, PUBLIC_COMPATIBLE_MAPPING)
ALLOWED_BIND_ADDRESSES = {"127.0.0.1", "0.0.0.0"}


def prepare_compose_bind_address(package_root: Path) -> bool:
    """Backport bind-address interpolation; refuse unknown or ambiguous layouts."""
    package_root = package_root.resolve()
    compose = package_root / "docker-compose.prod.yml"
    if compose.is_symlink() or not compose.is_file() or compose.resolve().parent != package_root:
        raise ValueError("No se puede ajustar de forma segura el puerto del paquete descargado.")

    content = compose.read_text(encoding="utf-8")
    compatible_count = sum(content.count(mapping) for mapping in COMPATIBLE_MAPPINGS)
    if compatible_count == 1:
        return False
    if content.count(LEGACY_MAPPING) != 1:
        raise ValueError("El paquete no permite fijar de forma segura la dirección de escucha; no se iniciará la instalación.")

    updated = content.replace(LEGACY_MAPPING, COMPATIBLE_MAPPING, 1)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", newline="", dir=package_root, delete=False) as handle:
        temporary = Path(handle.name)
        handle.write(updated)
    try:
        temporary.chmod(compose.stat().st_mode & 0o777)
        os.replace(temporary, compose)
    finally:
        temporary.unlink(missing_ok=True)
    return True


def persist_compose_bind_address(install_root: Path, bind_address: str) -> bool:
    """Persist the selected bind address in the install's Compose env file."""
    if bind_address not in ALLOWED_BIND_ADDRESSES:
        raise ValueError("La dirección de escucha seleccionada no es válida.")
    install_root = install_root.resolve()
    env_file = install_root / "compose.production.env"
    if env_file.is_symlink() or not env_file.is_file() or env_file.resolve().parent != install_root:
        raise ValueError("No se puede guardar de forma segura la dirección de escucha.")

    content = env_file.read_text(encoding="utf-8-sig")
    lines = content.splitlines()
    matches = [index for index, line in enumerate(lines) if line.startswith("TRESEKO_BIND_ADDRESS=")]
    if len(matches) > 1:
        raise ValueError("El archivo de configuración contiene más de una dirección de escucha.")
    setting = f"TRESEKO_BIND_ADDRESS={bind_address}"
    if matches:
        if lines[matches[0]] == setting:
            return False
        lines[matches[0]] = setting
    else:
        lines.append(setting)

    updated = "\n".join(lines) + "\n"
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", newline="", dir=install_root, delete=False) as handle:
        temporary = Path(handle.name)
        handle.write(updated)
    try:
        temporary.chmod(env_file.stat().st_mode & 0o777)
        os.replace(temporary, env_file)
    finally:
        temporary.unlink(missing_ok=True)
    return True
