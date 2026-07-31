from .updater import *
from .updater import _utc_iso, _pg_dump_url

async def _download_package(
    self,
    package_url: str,
    expected_checksum: str,
    task_id: str,
    state: UpdateTaskState,
) -> Path:
    downloads_dir = self.settings.updates_dir / "downloads"
    downloads_dir.mkdir(parents=True, exist_ok=True)
    package_path = downloads_dir / f"{task_id}.tar.gz"
    digest = hashlib.sha256()
    self._update_state(state, "downloading", 12, "Descargando paquete desde Update Server.")
    async with httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=10.0, read=120.0)) as client:
        async with client.stream("GET", package_url) as response:
            response.raise_for_status()
            with package_path.open("wb") as fh:
                async for chunk in response.aiter_bytes(chunk_size=1024 * 1024):
                    if not chunk:
                        continue
                    fh.write(chunk)
                    digest.update(chunk)
    actual_checksum = digest.hexdigest()
    self._update_state(state, "verifying", 35, "Verificando checksum SHA-256.")
    if actual_checksum.lower() != expected_checksum.lower():
        package_path.unlink(missing_ok=True)
        raise ValueError("El checksum del paquete descargado no coincide con el manifest.")
    return package_path

async def _backup_database(self, task_id: str) -> Path | None:
    pg_url = _pg_dump_url(self.settings.database_url)
    if not pg_url:
        return None
    self.settings.backups_dir.mkdir(parents=True, exist_ok=True)
    backup_path = self.settings.backups_dir / f"pre-update-db-{task_id}.sql.gz"
    proc = await asyncio.create_subprocess_exec(
        self.settings.pg_dump_path,
        "--clean",
        "--if-exists",
        pg_url,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    assert proc.stdout is not None
    with gzip.open(backup_path, "wb") as out:
        while True:
            chunk = await proc.stdout.read(1024 * 1024)
            if not chunk:
                break
            out.write(chunk)
    _, stderr = await proc.communicate()
    if proc.returncode != 0:
        backup_path.unlink(missing_ok=True)
        raise RuntimeError(f"pg_dump fallo: {stderr.decode('utf-8', errors='replace')[:500]}")
    await asyncio.to_thread(self._rotate_backups, "pre-update-db-*.sql.gz")
    return backup_path

async def _restore_database_backup(self, backup_path: Path, task_id: str) -> None:
    allow_db_rollback = str(os.getenv("TRESEKO_ALLOW_DB_ROLLBACK") or "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }
    if not allow_db_rollback:
        raise ValueError("Rollback de base de datos deshabilitado. Define TRESEKO_ALLOW_DB_ROLLBACK=true para habilitarlo.")
    pg_url = _pg_dump_url(self.settings.database_url)
    if not pg_url:
        raise ValueError("DATABASE_URL no es PostgreSQL; no se puede restaurar backup SQL.")
    proc = await asyncio.create_subprocess_exec(
        self.settings.psql_path,
        pg_url,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    assert proc.stdin is not None
    try:
        reset_schema = (
            "DROP SCHEMA IF EXISTS public CASCADE;\n"
            "CREATE SCHEMA public;\n"
            "GRANT ALL ON SCHEMA public TO public;\n"
        )
        proc.stdin.write(reset_schema.encode("utf-8"))
        await proc.stdin.drain()
        with gzip.open(backup_path, "rb") as source:
            while True:
                chunk = source.read(1024 * 1024)
                if not chunk:
                    break
                proc.stdin.write(chunk)
                await proc.stdin.drain()
    finally:
        proc.stdin.close()
    _, stderr = await proc.communicate()
    if proc.returncode != 0:
        raise RuntimeError(f"psql restore fallo para tarea {task_id}: {stderr.decode('utf-8', errors='replace')[:500]}")

async def _restart_services(self) -> None:
    if self.settings.docker_mode:
        os._exit(0)
    proc = await asyncio.create_subprocess_exec(
        self.settings.systemctl_path,
        "restart",
        "--no-block",
        self.settings.systemd_service_name,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    _, stderr = await proc.communicate()
    if proc.returncode != 0:
        raise RuntimeError(
            "No se pudo solicitar reinicio systemd: "
            f"{stderr.decode('utf-8', errors='replace')[:500]}"
        )

async def _backup_code(self, version: str, task_id: str) -> Path:
    self.settings.backups_dir.mkdir(parents=True, exist_ok=True)
    backup_path = self.settings.backups_dir / f"pre-update-code-{version}-{task_id}.tar.gz"

    def create_archive() -> None:
        with tarfile.open(backup_path, "w:gz") as tar:
            for label, path in {
                "backend_entrypoint": self.settings.app_dir / "entrypoint.sh",
                "backend_app": self.settings.app_dir / "app",
                "backend_alembic": self.settings.app_dir / "alembic",
                "frontend_html": self.settings.frontend_dir,
                "engine": self.settings.engine_dir,
                "worker": self.settings.worker_dir,
            }.items():
                if path.exists():
                    if label == "backend_app":
                        tar.add(
                            path,
                            arcname=label,
                            recursive=True,
                            filter=lambda info: None if info.name == "backend_app/static" or info.name.startswith("backend_app/static/") else info,
                        )
                    else:
                        tar.add(path, arcname=label, recursive=True)

    await asyncio.to_thread(create_archive)
    await asyncio.to_thread(self._rotate_backups, "pre-update-code-*.tar.gz")
    return backup_path

async def _restore_code_backup(self, backup_path: Path, task_id: str) -> None:
    restore_dir = self.settings.updates_dir / "rollback" / f"{backup_path.stem}-{task_id}"
    if restore_dir.exists():
        shutil.rmtree(restore_dir)
    restore_dir.mkdir(parents=True, exist_ok=True)

    def restore() -> None:
        with tarfile.open(backup_path, "r:gz") as tar:
            self._safe_extract(tar, restore_dir)

        targets = {
            "backend_entrypoint": self.settings.app_dir / "entrypoint.sh",
            "backend_app": self.settings.app_dir / "app",
            "backend_alembic": self.settings.app_dir / "alembic",
            "frontend_html": self.settings.frontend_dir,
            "engine": self.settings.engine_dir,
            "worker": self.settings.worker_dir,
        }
        for label, target in targets.items():
            source = restore_dir / label
            if not source.exists():
                continue
            if target.exists() and not (label == "backend_app" and target.is_dir()):
                if target.is_dir():
                    shutil.rmtree(target)
                else:
                    target.unlink()
            target.parent.mkdir(parents=True, exist_ok=True)
            if label == "backend_app":
                target.mkdir(parents=True, exist_ok=True)
                for child in target.iterdir():
                    if child.name != "static":
                        if child.is_dir():
                            shutil.rmtree(child)
                        else:
                            child.unlink()
                for child in source.iterdir():
                    if child.name == "static":
                        continue
                    destination = target / child.name
                    if child.is_dir():
                        shutil.copytree(child, destination)
                    else:
                        shutil.copy2(child, destination)
            elif source.is_dir():
                shutil.copytree(source, target)
            else:
                shutil.copy2(source, target)

    try:
        await asyncio.to_thread(restore)
    finally:
        shutil.rmtree(restore_dir, ignore_errors=True)

async def _extract_package(self, package_path: Path, manifest: dict[str, Any], task_id: str) -> Path:
    version = manifest["version"]
    extracted_dir = self.settings.updates_dir / "extracted" / f"{version}-{task_id}"
    if extracted_dir.exists():
        shutil.rmtree(extracted_dir)
    extracted_dir.mkdir(parents=True, exist_ok=True)

    def extract() -> None:
        with tarfile.open(package_path, "r:gz") as tar:
            self._safe_extract(tar, extracted_dir)

    await asyncio.to_thread(extract)
    self._validate_extracted_package_metadata(extracted_dir, manifest)
    return extracted_dir

def _validate_extracted_package_metadata(self, extracted_dir: Path, manifest: dict[str, Any]) -> None:
    package_manifest_path = extracted_dir / "manifest.json"
    version_path = extracted_dir / "VERSION"
    changelog_path = extracted_dir / "CHANGELOG.md"
    if not package_manifest_path.exists():
        raise ValueError("El paquete no contiene manifest.json en la raiz.")
    if not version_path.exists():
        raise ValueError("El paquete no contiene VERSION en la raiz.")
    if not changelog_path.exists():
        raise ValueError("El paquete no contiene CHANGELOG.md en la raiz.")
    try:
        package_manifest = json.loads(package_manifest_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError("El manifest interno del paquete no es JSON valido.") from exc
    if not isinstance(package_manifest, dict):
        raise ValueError("El manifest interno del paquete debe ser un objeto JSON.")
    expected_version = str(manifest.get("version") or "").strip()
    package_version = str(package_manifest.get("version") or "").strip()
    version_file = version_path.read_text(encoding="utf-8").strip()
    if package_version != expected_version or version_file != expected_version:
        raise ValueError("La version interna del paquete no coincide con el manifest autorizado.")
    if not changelog_path.read_text(encoding="utf-8").strip():
        raise ValueError("El CHANGELOG.md del paquete esta vacio.")
    component_version_paths = (
        "frontend/dist/VERSION",
        "engine/VERSION",
        "automation-worker/VERSION",
    )
    for relative_path in component_version_paths:
        component_version_path = extracted_dir / relative_path
        if not component_version_path.is_file():
            raise ValueError(f"El paquete no contiene {relative_path}.")
        component_version = component_version_path.read_text(encoding="utf-8").strip()
        if component_version != expected_version:
            raise ValueError(f"La version de {relative_path} no coincide con el manifest autorizado.")
    component_metadata_paths = (
        "frontend/dist/version.json",
        "engine/package.json",
        "automation-worker/package.json",
    )
    for relative_path in component_metadata_paths:
        metadata_path = extracted_dir / relative_path
        if not metadata_path.is_file():
            raise ValueError(f"El paquete no contiene {relative_path}.")
        try:
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise ValueError(f"{relative_path} no contiene JSON valido.") from exc
        if not isinstance(metadata, dict) or str(metadata.get("version") or "").strip() != expected_version:
            raise ValueError(f"La version declarada en {relative_path} no coincide con el manifest autorizado.")
    for field_name in ("channel", "edition", "artifact"):
        expected = str(manifest.get(field_name) or "").strip()
        actual = str(package_manifest.get(field_name) or "").strip()
        if expected and actual and expected != actual:
            raise ValueError(f"El campo interno {field_name} no coincide con el manifest autorizado.")

async def _stage_next_entrypoint(self, extracted_dir: Path) -> None:
    source = extracted_dir / "backend" / "entrypoint.sh"
    if not source.is_file():
        raise ValueError("El paquete no contiene backend/entrypoint.sh.")
    target = self.settings.app_dir / "entrypoint.sh"
    target.parent.mkdir(parents=True, exist_ok=True)
    staged = target.with_name(f"{target.name}.{uuid.uuid4().hex}.tmp")
    shutil.copy2(source, staged)
    staged.chmod(0o755)
    staged.replace(target)

async def _write_update_ready_flag(self, extracted_dir: Path, *, task_id: str, version: str | None) -> None:
    self.settings.updates_dir.mkdir(parents=True, exist_ok=True)
    flag_file = self.settings.updates_dir / "update-ready"
    tmp_file = self.settings.updates_dir / f"update-ready.{uuid.uuid4().hex}.tmp"
    tmp_file.write_text(
        json.dumps({"path": str(extracted_dir), "task_id": task_id, "version": version or ""}, sort_keys=True),
        encoding="utf-8",
    )
    tmp_file.replace(flag_file)

def _safe_extract(self, tar: tarfile.TarFile, target: Path) -> None:
    target_resolved = target.resolve()
    for member in tar.getmembers():
        member_path = (target / member.name).resolve()
        if target_resolved != member_path and target_resolved not in member_path.parents:
            raise ValueError("El paquete contiene rutas fuera del directorio de extraccion.")
        if member.issym() or member.islnk():
            raise ValueError("El paquete no puede contener links simbolicos o hardlinks.")
    tar.extractall(target)

def _rotate_backups(self, pattern: str) -> None:
    backups = sorted(self.settings.backups_dir.glob(pattern), key=lambda path: path.stat().st_mtime, reverse=True)
    for old_backup in backups[self.settings.max_backups:]:
        old_backup.unlink(missing_ok=True)
