"""La descarga legacy debe usar la URL del DownloadGrant, no la referencia opaca.

Regresión: el manifest Premium firmado del catalogo solo conserva
``treseko-update://...``. El router resuelve el DownloadGrant y entrega la URL
HTTPS utilizable en ``download_manifest``. La rama legacy de ``_run_apply``
ignoraba ese manifest y httpx fallaba con::

    Request URL has an unsupported protocol 'treseko-update://'

Instalaciones legacy (sin ``/run/treseko/update/installation-binding.json``)
son exactamente las que recorren esa rama, así que esta prueba fija el contrato
en modo legacy explícito.
"""

from __future__ import annotations

from pathlib import Path

from app.services.updater import UpdateService, UpdateSettings, UpdateTaskState
from app.services import updater_lifecycle


OPAQUE_URL = "treseko-update://premium-stable/1.0.6/treseko-update-v1.0.6.tar.gz"
GRANT_URL = "https://updates.treseko.com/api/updates/download/grant-token"
DIRECT_URL = "https://updates.treseko.com/api/updates/download/community-stable/1.0.6/treseko-update-v1.0.6.tar.gz"

SIGNED_MANIFEST = {
    "version": "1.0.6",
    "channel": "premium-stable",
    "edition": "premium",
    "package_url": OPAQUE_URL,
    "checksum_sha256": "b" * 64,
    "package_size_bytes": 4280012,
}


def _service(tmp_path: Path) -> UpdateService:
    updates_dir = tmp_path / "updates"
    return UpdateService(
        UpdateSettings(
            updates_dir=updates_dir,
            backups_dir=tmp_path / "backups",
            app_dir=tmp_path / "app",
            frontend_dir=tmp_path / "frontend",
            engine_dir=tmp_path / "engine",
            worker_dir=tmp_path / "worker",
            history_file=updates_dir / "update-history.json",
            database_url="",
        )
    )


def _stub_pipeline(service: UpdateService, captured: dict[str, str]) -> Path:
    """Sustituye todo lo que toca disco/red y captura la URL de descarga."""
    downloads = service.settings.updates_dir / "downloads"
    extracted = service.settings.updates_dir / "extracted" / "fixture"

    service._persist_history = lambda: None
    service._append_event = lambda *_args, **_kwargs: None
    service._update_state = lambda *_args, **_kwargs: None
    service._report_failure_best_effort = _async_none

    async def preflight(_manifest, _task_id):
        return None

    async def download(package_url, checksum, task_id, _state):
        captured["package_url"] = str(package_url)
        captured["checksum"] = str(checksum)
        downloads.mkdir(parents=True, exist_ok=True)
        package = downloads / f"{task_id}.tar.gz"
        package.write_bytes(b"fixture")
        return package

    async def backup_db(_task_id):
        return None

    async def backup_code(_version, _task_id):
        backup = service.settings.backups_dir / "pre-update-code-fixture.tar.gz"
        backup.parent.mkdir(parents=True, exist_ok=True)
        backup.write_bytes(b"fixture")
        return backup

    async def extract(_package_path, _manifest, _task_id):
        extracted.mkdir(parents=True, exist_ok=True)
        return extracted

    async def stage_entrypoint(_extracted_dir):
        return None

    async def write_flag(_extracted_dir, *, task_id, version):
        return None

    service._preflight_update = preflight
    service._download_package = download
    service._backup_database = backup_db
    service._backup_code = backup_code
    service._extract_package = extract
    service._stage_next_entrypoint = stage_entrypoint
    service._write_update_ready_flag = write_flag
    return extracted


async def _async_none(*_args, **_kwargs):
    return None


async def _run(tmp_path: Path, manifest: dict, download_manifest: dict | None, monkeypatch):
    service = _service(tmp_path)
    captured: dict[str, str] = {}
    _stub_pipeline(service, captured)
    monkeypatch.setattr(
        updater_lifecycle, "require_installation_mode", lambda command="request": "legacy"
    )
    task_id = "task-legacy"
    service._tasks[task_id] = UpdateTaskState(
        task_id=task_id,
        status="queued",
        channel=str(manifest.get("channel") or ""),
        version=str(manifest.get("version") or ""),
    )
    service._latest_task_id = task_id

    await service._run_apply(
        task_id, dict(manifest), False, download_manifest=download_manifest
    )
    return service, service._tasks[task_id], captured


async def test_legacy_premium_apply_downloads_from_grant_manifest(tmp_path, monkeypatch):
    """Premium legacy descarga con la URL HTTPS del grant, nunca con la opaca."""
    _service, state, captured = await _run(
        tmp_path,
        SIGNED_MANIFEST,
        {**SIGNED_MANIFEST, "package_url": GRANT_URL},
        monkeypatch,
    )

    assert captured["package_url"] == GRANT_URL
    assert captured["package_url"] != SIGNED_MANIFEST["package_url"]
    assert captured["checksum"] == SIGNED_MANIFEST["checksum_sha256"]
    assert state.status == "done"
    assert state.stage == "prepared"


async def test_legacy_apply_without_grant_manifest_keeps_authorized_url(tmp_path, monkeypatch):
    """Sin manifest de grant (Community) se conserva la URL propia del manifest."""
    community_manifest = {
        "version": "1.0.6",
        "channel": "community-stable",
        "edition": "community",
        "package_url": DIRECT_URL,
        "checksum_sha256": "c" * 64,
        "package_size_bytes": 4280054,
    }
    _service, state, captured = await _run(tmp_path, community_manifest, None, monkeypatch)

    assert captured["package_url"] == DIRECT_URL
    assert state.status == "done"


async def test_legacy_apply_downloads_manifest_is_bound_to_authorized_manifest(tmp_path, monkeypatch):
    """Un manifest de grant que no corresponde al manifest autorizado no se usa."""
    tampered = {**SIGNED_MANIFEST, "package_url": GRANT_URL, "checksum_sha256": "d" * 64}

    _service, state, captured = await _run(tmp_path, SIGNED_MANIFEST, tampered, monkeypatch)

    assert state.status == "failed"
    assert "vinculado al manifest autorizado" in (state.error or "")
    assert "package_url" not in captured


async def test_download_package_rejects_opaque_scheme(tmp_path):
    """Si la referencia opaca llega al downloader, falla antes de tocar la red."""
    service = _service(tmp_path)
    state = UpdateTaskState(task_id="task-opaque", status="queued", channel="premium-stable")

    try:
        await service._download_package(OPAQUE_URL, "b" * 64, "task-opaque", state)
    except ValueError as exc:
        assert "URL HTTPS utilizable" in str(exc)
        assert "treseko-update" in str(exc)
    else:
        raise AssertionError("El downloader acepto una referencia opaca sin URL HTTPS.")
