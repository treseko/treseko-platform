import asyncio
import argparse
import os
import secrets
import string
import sys
import uuid
from pathlib import Path

from sqlalchemy import select

from app import auth, models
from app.database import AsyncSessionLocal
from app.schema_sections.auth import _validate_password


ADMIN_EMAIL = "admin@qa.local"
RESET_EXISTING_ADMIN = os.getenv("TRESEKO_SEED_ADMIN_RESET_EXISTING", "").strip().lower() in {"1", "true", "yes", "si"}
INITIAL_PROFILE_SETTINGS = {
    "security": {
        "force_password_change": True,
        "force_password_change_reason": "initial_admin_bootstrap",
    }
}


def generate_temporary_password(length: int = 24) -> str:
    alphabet = string.ascii_letters + string.digits + "-_"
    return "".join(secrets.choice(alphabet) for _ in range(length))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Crea o asegura el admin inicial local sin guardar la contraseña en archivos de ambiente.")
    password_source = parser.add_mutually_exclusive_group()
    password_source.add_argument(
        "--password-file",
        help="Archivo local/secret con la contraseña inicial. Se lee y no se imprime.",
    )
    password_source.add_argument(
        "--password-stdin",
        action="store_true",
        help="Lee la contraseña inicial desde stdin. No usar si la terminal puede quedar registrada.",
    )
    parser.add_argument(
        "--reset-existing",
        action="store_true",
        help="Si el admin ya existe, restablece su contraseña y revoca sesiones activas.",
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
    generated_password = False
    temporary_password = read_password_from_args(args)
    reset_existing = RESET_EXISTING_ADMIN or bool(args.reset_existing)
    if temporary_password:
        _validate_password(temporary_password)
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(models.Usuario).where(models.Usuario.email == ADMIN_EMAIL))
        user = result.scalar_one_or_none()
        if user:
            user.rol = models.Rol.ADMIN
            user.activo = True
            user.auth_provider = "local"
            user.modulos = auth.default_modules_for_role(models.Rol.ADMIN)
            user.permisos = auth.default_permissions_for_role(models.Rol.ADMIN)
            user.permisos_detallados = user.permisos_detallados or {}
            if temporary_password or reset_existing:
                if not temporary_password:
                    temporary_password = generate_temporary_password()
                    generated_password = True
                user.hashed_password = auth.get_password_hash(temporary_password)
                user.profile_settings = {
                    **(user.profile_settings or {}),
                    **INITIAL_PROFILE_SETTINGS,
                }
            admin_id = user.id
        else:
            if not temporary_password:
                temporary_password = generate_temporary_password()
                generated_password = True
            user = models.Usuario(
                id=uuid.uuid4(),
                email=ADMIN_EMAIL,
                hashed_password=auth.get_password_hash(temporary_password),
                nombre_completo="Administrador QA",
                rol=models.Rol.ADMIN,
                activo=True,
                auth_provider="local",
                modulos=auth.default_modules_for_role(models.Rol.ADMIN),
                permisos=auth.default_permissions_for_role(models.Rol.ADMIN),
                permisos_detallados={},
                profile_settings=INITIAL_PROFILE_SETTINGS,
            )
            session.add(user)
            await session.flush()
            admin_id = user.id
        await session.commit()

    print("Admin inicial creado/actualizado correctamente")
    print(f"Admin local: {ADMIN_EMAIL} ({admin_id})")
    if temporary_password and (generated_password or args.password_file or args.password_stdin or reset_existing):
        print("")
        if args.password_file or args.password_stdin:
            print("Se configuro la contraseña inicial desde un canal externo seguro.")
        else:
            print("Contraseña temporal inicial:")
            print(temporary_password)
        print("")
        print("No se conserva en el archivo de ambiente y el primer login exigira cambiarla.")
    elif user:
        print("El admin ya existia; no se modifico su contraseña.")
        print("Para recuperarla, usa reset_user_password.py desde la consola del servidor.")


if __name__ == "__main__":
    asyncio.run(main())
