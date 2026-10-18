"""Installation-time mount validation for complete-source host updates."""

from pathlib import Path

from .update_participant_commands import load_private_json
from .update_helper_installation import _absolute, _reject_symlink_components, _under

def validate_complete_source_mounts(bridge_config_path, root, launcher_config):
    """Validate the spool -> bridge -> controller chain and its Docker mounts."""
    root = Path(root).resolve()
    mounts = launcher_config.get("mounts", {}).get("host_bridge", [])

    def mounted(path, mode):
        return any(item.get("source") == str(path) and item.get("mode") == mode
                   for item in mounts)

    def require_mount(path, mode, label):
        if not mounted(path, mode):
            raise ValueError(f"Host bridge {label} must be mounted {mode}")

    # The installed wrapper always invokes update_host_bridge_cli with
    # --spool. That CLI consumes this outer config and then loads bridge_config.
    spool = load_private_json(bridge_config_path)
    if (set(spool) != {"schema", "bridge_config", "request_inbox", "spool_dir"}
            or spool.get("schema") != 1):
        raise ValueError("Invalid private host bridge spool configuration")
    spool_path = Path(bridge_config_path).resolve()
    require_mount(spool_path, "ro", "spool configuration")

    bridge_path = _under(root, _absolute(spool["bridge_config"], "bridge config"))
    _reject_symlink_components(root, bridge_path)
    require_mount(bridge_path, "ro", "bridge configuration")
    bridge = load_private_json(bridge_path)
    if bridge.get("schema") != 1:
        raise ValueError("Invalid private host bridge configuration")
    controller_path = bridge.get("controller_config")
    if not isinstance(controller_path, str):
        raise ValueError("Host bridge controller configuration is required")
    controller_path = _under(root, _absolute(controller_path, "controller config"))
    _reject_symlink_components(root, controller_path)
    require_mount(controller_path, "ro", "controller configuration")
    controller = load_private_json(controller_path)
    atomic = controller.get("atomic_compose")
    if atomic is None:
        raise ValueError("Complete-source controller configuration is required")
    if (not isinstance(atomic, dict) or set(atomic) != {
            "schema", "project", "project_root", "env_file"}
            or type(atomic.get("schema")) is not int or atomic["schema"] != 1):
        raise ValueError("Invalid private complete-source Compose configuration")
    project_root = _under(root, _absolute(atomic["project_root"], "Compose project root"))
    env_file = _under(root, _absolute(atomic["env_file"], "Compose environment file"))
    project_ro = any(item["source"] == str(project_root) and item["mode"] == "ro"
                     for item in mounts)
    env_ro = any(item["source"] == str(env_file) and item["mode"] == "ro"
                 for item in mounts)
    env_covered = env_file == project_root or project_root in env_file.parents
    controller_state = _under(root, _absolute(controller["directory"], "controller state directory"))
    bridge_paths = {
        "spool request inbox": _under(root, _absolute(spool["request_inbox"], "spool request inbox")),
        "spool state": _under(root, _absolute(spool["spool_dir"], "spool state")),
        "bridge request inbox": _under(root, _absolute(bridge["inbox"], "bridge inbox")),
        "bridge state": _under(root, _absolute(bridge["state_dir"], "bridge state")),
        "bridge reports": _under(root, _absolute(bridge["report_dir"], "bridge reports")),
        "controller state": controller_state,
    }
    for label, path in bridge_paths.items():
        _reject_symlink_components(root, path)
        require_mount(path, "rw", label)
    if not project_ro or (not env_ro and not env_covered):
        raise ValueError("Complete-source paths must mount the project/environment readonly and state writable")
    if not project_root.is_dir() or not env_file.is_file():
        raise ValueError("Complete-source Compose project or environment file is unavailable")
