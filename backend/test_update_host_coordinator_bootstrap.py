from __future__ import annotations

import os
import plistlib
from pathlib import Path
import socket
import subprocess
import shutil

import pytest

from app.services.update_host_coordinator_bootstrap import (
    HostCoordinatorBootstrapError,
    plan_linux_user_bootstrap,
)
from app.services.update_host_coordinator_installer import (
    render_linux_user_artifacts,
    write_linux_user_artifacts,
    install_linux_user_bootstrap,
)
from app.services.update_host_coordinator_cli import (
    HostCoordinatorBootstrapError,
    _socket_from_docker_context,
)


@pytest.fixture
def candidate(tmp_path: Path) -> dict:
    root = tmp_path / "treseko"
    root.mkdir()
    env = root / "compose.production.env"
    env.write_text("secret=not-used-by-planner\n")
    compose = root / "docker-compose.prod.yml"
    compose.write_text("services: {}\n")
    working = root / ".treseko-local" / "releases" / "1.0.7"
    working.mkdir(parents=True)
    return {
        "operational": False,
        "deployment": "single-host-compose",
        "host_os": "linux",
        "service_manager_candidate": "systemd-user",
        "compose_project": "treseko-qa",
        "compose_working_dir": str(working),
        "compose_files": [str(compose)],
        "service_roles": {
            "backend": "backend",
            "frontend": "frontend",
            "engine": "engine",
            "automation_worker": "automation-worker",
            "db": "db",
        },
        "transaction_overlays_to_rebase": [],
    }, root, env, working


def test_plan_is_deterministic_and_does_not_claim_operational(candidate):
    inventory, root, env, _ = candidate
    kwargs = dict(project_root=str(root), env_file=str(env), home="/home/operator",
                  uid=1000, gid=1000, helper_image_id="sha256:" + "a" * 64)

    first = plan_linux_user_bootstrap(inventory, **kwargs)
    second = plan_linux_user_bootstrap(inventory, **kwargs)

    assert first == second
    assert first["operational"] is False
    assert first["fixed_settings"]["service_manager"] == "systemd-user"
    assert "--once --spool" in first["wrapper"]
    assert first["controller_config"]["atomic_compose"]["project"] == "treseko-qa"
    assert first["bridge_runtime_config"]["request_uid"] == 1000
    assert first["bridge_spool_config"]["bridge_config"] == first["paths"]["bridge_runtime_config"]
    assert f"src={first['paths']['bridge_runtime_config']},dst={first['paths']['bridge_runtime_config']},readonly" in first["wrapper"]
    assert f"src={first['state']['root']},dst={first['state']['root']}" in first["wrapper"]
    assert (f"src={first['paths']['compose_override']},"
            f"dst={first['paths']['compose_override']},readonly" in first["wrapper"])


def test_plan_accounts_for_docker_socket_group(candidate):
    inventory, root, env, _ = candidate
    plan = plan_linux_user_bootstrap(inventory, project_root=str(root), env_file=str(env),
                                     home="/home/operator", uid=1000, gid=1000,
                                     docker_socket_gid=998)
    assert "--group-add 998" in plan["wrapper"]


def test_plan_allows_inactive_optional_workers(candidate):
    inventory, root, env, _ = candidate
    inventory["service_roles"].pop("automation_worker")
    plan = plan_linux_user_bootstrap(inventory, project_root=str(root), env_file=str(env),
                                     home="/home/operator", uid=1000, gid=1000)
    assert set(plan["topology_binding_existing"]["services"]) == {
        "backend", "frontend", "engine", "db"
    }


def test_plan_mounts_external_compose_files_read_only(candidate, tmp_path):
    inventory, root, env, _ = candidate
    external = tmp_path / "operator-compose.yaml"
    external.write_text("services: {}\n")
    inventory["compose_files"].append(str(external))
    plan = plan_linux_user_bootstrap(inventory, project_root=str(root), env_file=str(env),
                                     home="/home/operator", uid=1000, gid=1000)
    assert plan["external_compose_files"] == [str(external)]
    assert f"src={external},dst={external},readonly" in plan["wrapper"]
    assert plan["helper_compose_files"].count(str(external)) == 1
    assert plan["helper_compose_files"].count(plan["paths"]["compose_override"]) == 1


@pytest.mark.parametrize(
    "change,expected",
    [
        ({"host_os": "windows"}, "unsupported_host_topology"),
        ({"deployment": "distributed-compose"}, "unsupported_host_topology"),
        ({"service_manager_candidate": None}, "persistent_user_service_manager_unavailable"),
        ({"compose_project": "../other"}, "compose_project_invalid"),
        ({"service_roles": {"backend": "same", "frontend": "same", "engine": "engine",
                             "automation_worker": "worker", "db": "db"}},
         "compose_service_inventory_invalid"),
    ],
)
def test_plan_blocks_unsupported_or_ambiguous_installations(candidate, change, expected):
    inventory, root, env, _ = candidate
    inventory.update(change)
    with pytest.raises(HostCoordinatorBootstrapError, match=expected):
        plan_linux_user_bootstrap(inventory, project_root=str(root), env_file=str(env),
                                  home="/home/operator", uid=1000, gid=1000)


def test_plan_rejects_environment_file_outside_installation(candidate, tmp_path):
    inventory, root, _, _ = candidate
    elsewhere = tmp_path / "secrets.env"
    elsewhere.write_text("secret\n")
    with pytest.raises(HostCoordinatorBootstrapError, match="env_file_outside_installation"):
        plan_linux_user_bootstrap(inventory, project_root=str(root), env_file=str(elsewhere),
                                  home="/home/operator", uid=1000, gid=1000)


def test_plan_rejects_docker_mount_delimiter_in_installation_path(candidate, tmp_path):
    inventory, _, _, working = candidate
    root = tmp_path / "unsafe,root"
    root.mkdir()
    env = root / "compose.production.env"
    env.write_text("secret\n")
    inventory["compose_working_dir"] = str(working)
    with pytest.raises(HostCoordinatorBootstrapError, match="project_root_invalid"):
        plan_linux_user_bootstrap(inventory, project_root=str(root), env_file=str(env),
                                  home="/home/operator", uid=1000, gid=1000)


def test_plan_does_not_write_private_configuration(candidate):
    inventory, root, env, _ = candidate
    home = Path("/home/nonexistent-treseko-bootstrap-test")
    plan_linux_user_bootstrap(inventory, project_root=str(root), env_file=str(env),
                              home=str(home), uid=os.getuid(), gid=os.getgid())
    assert not home.exists()


def test_macos_accepts_only_docker_desktop_default_socket_symlink(tmp_path, monkeypatch):
    socket_root = Path("/tmp") / f"treseko-{os.getpid()}-mac-allowed"
    shutil.rmtree(socket_root, ignore_errors=True)
    home = socket_root / "home"
    target = home / ".docker" / "run" / "docker.sock"
    target.parent.mkdir(parents=True)
    listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    listener.bind(str(target))
    monkeypatch.setattr("app.services.update_host_coordinator_cli.sys.platform", "darwin")
    monkeypatch.setattr(Path, "home", lambda: home)
    link = socket_root / "docker.sock"
    link.symlink_to(target)
    try:
        assert _socket_from_docker_context("/usr/bin/docker", f"unix://{link}") == target.resolve()
    finally:
        listener.close()
        shutil.rmtree(socket_root, ignore_errors=True)


def test_macos_rejects_nonstandard_docker_socket_symlink(tmp_path, monkeypatch):
    socket_root = Path("/tmp") / f"treseko-{os.getpid()}-mac-denied"
    shutil.rmtree(socket_root, ignore_errors=True)
    home = socket_root / "home"
    home.mkdir(parents=True)
    target = socket_root / "untrusted.sock"
    listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    listener.bind(str(target))
    link = socket_root / "docker.sock"
    link.symlink_to(target)
    monkeypatch.setattr("app.services.update_host_coordinator_cli.sys.platform", "darwin")
    monkeypatch.setattr(Path, "home", lambda: home)
    try:
        with pytest.raises(HostCoordinatorBootstrapError, match="docker_socket_invalid"):
            _socket_from_docker_context("/usr/bin/docker", f"unix://{link}")
    finally:
        listener.close()
        shutil.rmtree(socket_root, ignore_errors=True)


def test_render_produces_complete_linux_user_installation(candidate):
    inventory, root, env, _ = candidate
    plan = plan_linux_user_bootstrap(inventory, project_root=str(root), env_file=str(env),
                                     home="/home/operator", uid=1000, gid=1000,
                                     helper_image_id="sha256:" + "b" * 64)
    rendered = render_linux_user_artifacts(plan, "install-test-1")

    assert set(rendered) == set(plan["paths"][key] for key in (
        "controller_config", "bridge_runtime_config", "bridge_config", "binding",
        "compose_override", "service", "timer", "wrapper",
    ))
    override = rendered[plan["paths"]["compose_override"]][0].decode()
    service = rendered[plan["paths"]["service"]][0].decode()
    assert 'command: ["coordinated-serve"]' in override
    assert "TRESEKO_UPDATE_MODE" in override
    assert "installation-binding.json" in override
    assert rendered[plan["paths"]["wrapper"]][1] == 0o755
    assert f"ConditionPathExists={plan['paths']['bridge_config']}\n" in service
    assert f"ConditionPathExists={plan['paths']['wrapper']}\n" in service
    assert f"ExecStart={plan['paths']['wrapper']}\n" in service
    assert f'ConditionPathExists="{plan["paths"]["wrapper"]}"' not in service


def test_write_installs_files_idempotently_and_keeps_private_modes(candidate, tmp_path):
    inventory, root, env, _ = candidate
    home = tmp_path / "home"
    home.mkdir(mode=0o700)
    plan = plan_linux_user_bootstrap(inventory, project_root=str(root), env_file=str(env),
                                     home=str(home), uid=os.getuid(), gid=os.getgid(),
                                     helper_image_id="sha256:" + "c" * 64)

    first = write_linux_user_artifacts(plan, "install-test-2")
    second = write_linux_user_artifacts(plan, "install-test-2")
    assert first["ok"] and second["files"] == first["files"]
    assert Path(plan["paths"]["controller_config"]).stat().st_mode & 0o777 == 0o600
    assert Path(plan["paths"]["bridge_config"]).stat().st_mode & 0o777 == 0o600
    assert Path(plan["paths"]["wrapper"]).stat().st_mode & 0o777 == 0o755


def test_install_activates_user_timer_and_coordinated_backend(candidate, tmp_path):
    inventory, root, env, working = candidate
    home = tmp_path / "home"
    home.mkdir(mode=0o700)
    active_compose = working / "docker-compose.prod.yml"
    active_compose.write_text("services: {}\n")
    inventory["compose_files"] = [str(active_compose)]
    backend = working / "backend"
    backend.mkdir()
    (backend / "entrypoint.sh").write_text("case coordinated-serve in *) ;; esac\n")
    plan = plan_linux_user_bootstrap(inventory, project_root=str(root), env_file=str(env),
                                     home=str(home), uid=os.getuid(), gid=os.getgid(),
                                     helper_image_id="sha256:" + "d" * 64)
    calls = []

    def runner(argv, **kwargs):
        calls.append(argv)
        return subprocess.CompletedProcess(argv, 0, "enabled\n", "")

    result = install_linux_user_bootstrap(plan, "install-test-3", runner=runner)
    assert result["ok"] and result["operational"]
    assert any(argv[:3] == ["systemctl", "--user", "enable"] for argv in calls)
    compose = next(argv for argv in calls if "compose" in argv and "up" in argv)
    assert compose[-1] == "backend"
    assert compose[compose.index("--project-directory") + 1] == str(working)
    assert plan["paths"]["compose_override"] in compose


def test_install_rolls_back_files_when_coordinated_backend_fails(candidate, tmp_path):
    inventory, root, env, working = candidate
    home = tmp_path / "home"
    home.mkdir(mode=0o700)
    active_compose = working / "docker-compose.prod.yml"
    active_compose.write_text("services: {}\n")
    inventory["compose_files"] = [str(active_compose)]
    backend = working / "backend"
    backend.mkdir()
    (backend / "entrypoint.sh").write_text("coordinated-serve\n")
    plan = plan_linux_user_bootstrap(inventory, project_root=str(root), env_file=str(env),
                                     home=str(home), uid=os.getuid(), gid=os.getgid(),
                                     helper_image_id="sha256:" + "e" * 64)
    override = plan["paths"]["compose_override"]
    rollback_saw_binding = []

    def runner(argv, **kwargs):
        if "compose" in argv and "up" in argv and override in argv:
            return subprocess.CompletedProcess(argv, 1, "", "failed")
        if "compose" in argv and "up" in argv:
            rollback_saw_binding.append(Path(plan["paths"]["binding"]).is_file())
        return subprocess.CompletedProcess(argv, 0, "inactive\n", "")

    with pytest.raises(HostCoordinatorBootstrapError, match="bootstrap_activation_failed"):
        install_linux_user_bootstrap(plan, "install-test-4", runner=runner)
    assert not Path(override).exists()
    assert not Path(plan["paths"]["service"]).exists()
    assert not Path(plan["paths"]["wrapper"]).exists()
    assert rollback_saw_binding == [True]


def test_macos_plan_renders_launch_agent_without_systemd_timer(candidate, tmp_path):
    inventory, root, env, _ = candidate
    inventory.update(host_os="darwin", service_manager_candidate="launchd-user")
    home = tmp_path / "home"
    home.mkdir(mode=0o700)
    home.chmod(0o700)
    plan = plan_linux_user_bootstrap(
        inventory, project_root=str(root), env_file=str(env), home=str(home),
        uid=os.getuid(), gid=os.getgid(), helper_image_id="sha256:" + "f" * 64,
    )
    rendered = render_linux_user_artifacts(plan, "macos-install-test")

    service_path = plan["paths"]["service"]
    assert plan["fixed_settings"]["service_manager"] == "launchd-user"
    assert plan["paths"]["timer"] is None
    assert set(rendered) == set(plan["paths"][key] for key in (
        "controller_config", "bridge_runtime_config", "bridge_config", "binding",
        "compose_override", "service", "wrapper",
    ))
    plist = plistlib.loads(rendered[service_path][0])
    assert plist["Label"] == "com.treseko.update-spool.treseko-qa"
    assert plist["StartInterval"] == 30
    assert plist["RunAtLoad"] is True


def test_macos_bootstrap_loads_launch_agent_and_activates_backend(candidate, tmp_path):
    inventory, root, env, working = candidate
    inventory.update(host_os="darwin", service_manager_candidate="launchd-user")
    home = tmp_path / "home"
    home.mkdir(mode=0o700)
    home.chmod(0o700)
    active_compose = working / "docker-compose.prod.yml"
    active_compose.write_text("services: {}\n")
    backend = working / "backend"
    backend.mkdir()
    (backend / "entrypoint.sh").write_text("coordinated-serve\n")
    plan = plan_linux_user_bootstrap(
        inventory, project_root=str(root), env_file=str(env), home=str(home),
        uid=os.getuid(), gid=os.getgid(), helper_image_id="sha256:" + "9" * 64,
    )
    calls = []

    def runner(argv, **kwargs):
        calls.append(argv)
        return subprocess.CompletedProcess(argv, 0, "loaded\n", "")

    result = install_linux_user_bootstrap(plan, "macos-install-test-2", runner=runner)
    assert result["operational"] is True
    assert result["timer"] is None
    assert any(argv[:2] == ["launchctl", "bootstrap"] for argv in calls)
    assert any("compose" in argv and "up" in argv
               and plan["paths"]["compose_override"] in argv for argv in calls)
