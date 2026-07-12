import argparse
import asyncio
import secrets
import string
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import select

from app import auth, models
from app.database import AsyncSessionLocal
from app.schema_sections.auth import _normalize_email, _validate_password


def generate_temporary_password(length: int = 24) -> str:
    alphabet = string.ascii_letters + string.digits + "-_"
    return "".join(secrets.choice(alphabet) for _ in range(length))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Restablece la contraseña de un usuario desde la consola del servidor."
    )
    parser.add_argument(
        "--email",
        default="admin@qa.local",
        help="Email del usuario a restablecer. Default: admin@qa.local",
    )
    password_source = parser.add_mutually_exclusive_group()
    password_source.add_argument(
        "--password-file",
        help="Archivo local/secret con la contraseña temporal. Se lee y no se imprime.",
    )
    password_source.add_argument(
        "--password-stdin",
        action="store_true",
        help="Lee la contraseña temporal desde stdin. No usar si la terminal puede quedar registrada.",
    )
    return parser.parse_args()


def read_password_from_args(args: argparse.Namespace) -> str:
    if args.password_file:
        path = Path(args.password_file).expanduser()
        mode = path.stat().st_mode & 0o777
        if mode & 0o077:
            raise RuntimeError(f"--password-file debe tener permisos 0600 o mas restrictivos: {path}")
        return path.read_text(encoding="utf-8").strip()
    if args.password_stdin:
        return sys.stdin.read().strip()
    return ""


async def main() -> None:
    args = parse_args()
    email = _normalize_email(args.email)
    if not email:
        raise RuntimeError("Indica un email valido con --email.")
    external_password = bool(args.password_file or args.password_stdin)
    temporary_password = read_password_from_args(args) or generate_temporary_password()
    _validate_password(temporary_password)

    async with AsyncSessionLocal() as session:
        result = await session.execute(select(models.Usuario).where(models.Usuario.email == email))
        user = result.scalar_one_or_none()
        if not user:
            raise RuntimeError(f"No existe un usuario con email {email}.")
        if user.auth_provider != "local":
            raise RuntimeError("Solo se pueden restablecer contraseñas de cuentas locales.")

        profile_settings = dict(user.profile_settings or {})
        security = dict(profile_settings.get("security") or {})
        security["force_password_change"] = True
        security["force_password_change_reason"] = "server_password_reset"
        security["password_reset_at"] = datetime.now(timezone.utc).isoformat()
        profile_settings["security"] = security

        user.hashed_password = auth.get_password_hash(temporary_password)
        user.profile_settings = profile_settings

        session.add(models.AuditLog(
            id=uuid.uuid4(),
            usuario_id=user.id,
            accion="PASSWORD_RESET",
            recurso="usuario",
            recurso_id=user.id,
            detalles={"source": "server_console", "force_password_change": True},
            ip_address="server-console",
        ))
        await session.commit()

    print("Contraseña temporal restablecida correctamente.")
    print(f"Usuario: {email}")
    print("")
    if external_password:
        print("Se configuro la contraseña temporal desde un canal externo seguro.")
    else:
        print("Contraseña temporal:")
        print(temporary_password)
    print("")
    print("Guardala ahora. No se conserva en el archivo de ambiente.")
    print("El usuario debera cambiarla en el proximo login.")


if __name__ == "__main__":
    asyncio.run(main())
