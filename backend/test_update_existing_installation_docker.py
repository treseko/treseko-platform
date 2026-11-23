from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import uuid

import pytest


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts/update_existing_installation_docker.sh"


def _socket(path: Path) -> None:
    listener = socket.socket(socket.AF_UNIX)
    listener.bind(str(path))
    listener.close()


def _fixture(tmp_path: Path, action: str = "status") -> tuple[Path, list[str], Path]:
    docker = tmp_path / "docker"
    log = tmp_path / "docker.argv"
    docker.write_text(
        "#!/bin/sh\n"
        "printf '%s\\n' \"$*\" >> \"$TRESEKO_DOCKER_LOG\"\n"
        "if [ \"$1\" = image ] && [ \"$2\" = inspect ]; then printf 'sha256:%064d\\n' 1; exit 0; fi\n"
        "case \"$*\" in *update_existing_installation_docker_preflight*)\n"
        "  printf '%s\\t%s\\tro\\tlauncher\\n' \"$TRESEKO_LAUNCHER\" \"$TRESEKO_LAUNCHER\"\n"
        "  printf '%s\\t%s\\tro\\tcontroller\\n' \"$TRESEKO_CONFIG\" \"$TRESEKO_CONFIG\"\n"
        "  printf '%s\\t%s\\trw\\tsocket\\n' \"$TRESEKO_SOCKET\" \"$TRESEKO_SOCKET\"\n"
        "  printf '%s\\t%s\\trw\\tstate\\n' \"$TRESEKO_STATE\" \"$TRESEKO_STATE\"\n"
        "  printf '%s\\t%s\\trw\\tcache\\n' \"$TRESEKO_CACHE\" \"$TRESEKO_CACHE\"\n"
        "  if [ -n \"$TRESEKO_MANIFEST\" ]; then printf '%s\\t%s\\tro\\tmanifest\\n' \"$TRESEKO_MANIFEST\" \"$TRESEKO_MANIFEST\"; fi\n"
        "  if [ \"$TRESEKO_ACTION\" = prepare ]; then printf '%s\\t%s\\tro\\tpackage\\n' \"$TRESEKO_PACKAGE\" \"$TRESEKO_PACKAGE\"; fi\n"
        "  exit 0;; esac\n"
        "printf '{\"schema\":1,\"status\":\"status\",\"journals\":[]}\\n'\n"
    )
    docker.chmod(0o755)
    launcher = tmp_path / "launcher.json"
    config = tmp_path / "controller.json"
    manifest = tmp_path / "manifest.json"
    package = tmp_path / "release.tar.gz"
    socket_root = Path("/private/tmp") if Path("/private/tmp").is_dir() else Path("/tmp")
    socket_path = socket_root / f"treseko-update-{uuid.uuid4().hex}.sock"
    state = tmp_path / "state"
    cache = tmp_path / "cache"
    state.mkdir()
    cache.mkdir()
    _socket(socket_path)
    mounts = [
        {"source": str(launcher), "target": str(launcher), "mode": "ro", "purpose": "launcher"},
        {"source": str(config), "target": str(config), "mode": "ro", "purpose": "controller"},
        {"source": str(socket_path), "target": str(socket_path), "mode": "rw", "purpose": "socket"},
        {"source": str(state), "target": str(state), "mode": "rw", "purpose": "state"},
        {"source": str(cache), "target": str(cache), "mode": "rw", "purpose": "cache"},
    ]
    if action != "status":
        manifest.write_text(json.dumps({"version": "1.0.8"}))
        mounts.append({"source": str(manifest), "target": str(manifest), "mode": "ro", "purpose": "manifest"})
    if action == "prepare":
        package.write_bytes(b"candidate package")
        mounts.append({"source": str(package), "target": str(package), "mode": "ro", "purpose": "package"})
    launcher.write_text(json.dumps({
        "type": "docker", "docker": str(docker), "image": "sha256:" + "1" * 64,
        "socket": str(socket_path), "network": "treseko-update", "mounts": mounts,
    }))
    launcher.chmod(0o600)
    config.write_text(json.dumps({"schema": 1, "directory": str(state)}))
    config.chmod(0o600)
    return docker, [str(launcher), str(config), str(socket_path), str(state), str(cache),
                    str(manifest) if action != "status" else "",
                    str(package) if action == "prepare" else ""], log


def test_wrapper_uses_fixed_docker_argv_without_host_python_or_user_command(tmp_path):
    docker, paths, log = _fixture(tmp_path)
    launcher, config, socket_path, state, cache = paths[:5]
    env = {
        **os.environ,
        "TRESEKO_DOCKER_LOG": str(log),
        "TRESEKO_LAUNCHER": launcher,
        "TRESEKO_CONFIG": config,
        "TRESEKO_SOCKET": socket_path,
        "TRESEKO_STATE": state,
        "TRESEKO_CACHE": cache,
        "DOCKER_HOST": "unix://ignored-by-wrapper",
    }
    try:
        result = subprocess.run([
            str(SCRIPT), "status", "--launcher-config", launcher, "--image", "sha256:" + "1" * 64,
            "--docker", str(docker), "--socket", socket_path, "--network", "treseko-update",
            "--config", config,
        ], capture_output=True, text=True, env=env, timeout=30)
        assert result.returncode == 0, result.stderr
        assert json.loads(result.stdout)["status"] == "status"
        calls = log.read_text()
        assert "--entrypoint /usr/local/bin/python" in calls
        assert "-m app.services.update_existing_installation" in calls
        assert f"--env DOCKER_HOST=unix://{socket_path}" in calls
        assert "unix://ignored-by-wrapper" not in calls
        assert "python3" not in SCRIPT.read_text()
        assert "awk" not in SCRIPT.read_text()
        assert "sed" not in SCRIPT.read_text()

        rejected = subprocess.run([
            str(SCRIPT), "status", "--launcher-config", launcher, "--image", "sha256:" + "1" * 64,
            "--docker", str(docker), "--socket", socket_path, "--network", "treseko-update",
            "--config", config, "--unexpected", "request",
        ], capture_output=True, text=True, env=env, timeout=30)
        assert rejected.returncode == 2
    finally:
        Path(socket_path).unlink(missing_ok=True)


@pytest.mark.parametrize(("action", "needs_package"), [("plan", False), ("prepare", True)])
def test_wrapper_mounts_operation_inputs_in_initial_preflight(tmp_path, action, needs_package):
    docker, paths, log = _fixture(tmp_path, action)
    launcher, config, socket_path, state, cache, manifest, package = paths
    env = {
        **os.environ,
        "TRESEKO_DOCKER_LOG": str(log),
        "TRESEKO_LAUNCHER": launcher,
        "TRESEKO_CONFIG": config,
        "TRESEKO_SOCKET": socket_path,
        "TRESEKO_STATE": state,
        "TRESEKO_CACHE": cache,
        "TRESEKO_MANIFEST": manifest,
        "TRESEKO_PACKAGE": package,
        "TRESEKO_ACTION": action,
    }
    argv = [
        str(SCRIPT), action, "--launcher-config", launcher, "--image", "sha256:" + "1" * 64,
        "--docker", str(docker), "--socket", socket_path, "--network", "treseko-update",
        "--config", config, "--manifest", manifest, "--transaction", "qa-preflight-inputs",
    ]
    if needs_package:
        argv.extend(["--package", package])
    try:
        result = subprocess.run(argv, capture_output=True, text=True, env=env, timeout=30)
        assert result.returncode == 0, result.stderr
        preflight_calls = [line for line in log.read_text().splitlines()
                           if "update_existing_installation_docker_preflight" in line]
        assert len(preflight_calls) == 2
        initial = preflight_calls[0]
        assert f"--mount type=bind,src={config},dst={config},readonly" in initial
        assert f"--mount type=bind,src={manifest},dst={manifest},readonly" in initial
        if needs_package:
            assert f"--mount type=bind,src={package},dst={package},readonly" in initial
    finally:
        Path(socket_path).unlink(missing_ok=True)


@pytest.mark.skipif(
    os.environ.get("TRESEKO_RUN_DOCKER_UPDATE_TESTS") != "1",
    reason="trusted Docker image test requires TRESEKO_RUN_DOCKER_UPDATE_TESTS=1",
)
def test_wrapper_real_trusted_image_status_without_host_python(tmp_path):
    docker = shutil.which("docker")
    image = os.environ.get("TRESEKO_UPDATE_TRUSTED_IMAGE")
    if not docker or not image:
        pytest.skip("set TRESEKO_UPDATE_TRUSTED_IMAGE to a locally inspected trusted image")
    socket_path = Path(os.environ.get("DOCKER_HOST", "unix:///var/run/docker.sock").removeprefix("unix://"))
    if not socket_path.exists():
        pytest.skip("Docker socket unavailable")
    config = tmp_path / "controller.json"
    state = tmp_path / "state"
    cache = tmp_path / "cache"
    state.mkdir()
    cache.mkdir()
    config.write_text(json.dumps({"schema": 1, "directory": str(state)}))
    config.chmod(0o600)
    launcher = tmp_path / "launcher.json"
    launcher.write_text(json.dumps({
        "type": "docker", "docker": str(Path(docker).resolve()), "image": image,
        "socket": str(socket_path), "network": "treseko-update",
        "mounts": [
            {"source": str(launcher), "target": str(launcher), "mode": "ro", "purpose": "launcher"},
            {"source": str(config), "target": str(config), "mode": "ro", "purpose": "controller"},
            {"source": str(socket_path), "target": str(socket_path), "mode": "rw", "purpose": "socket"},
            {"source": str(state), "target": str(state), "mode": "rw", "purpose": "state"},
            {"source": str(cache), "target": str(cache), "mode": "rw", "purpose": "cache"},
        ],
    }))
    launcher.chmod(0o600)
    result = subprocess.run([
        str(SCRIPT), "status", "--launcher-config", str(launcher), "--image", image,
        "--docker", str(Path(docker).resolve()), "--socket", str(socket_path),
        "--network", "treseko-update", "--config", str(config),
    ], capture_output=True, text=True, timeout=90)
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout)["status"] == "status"
