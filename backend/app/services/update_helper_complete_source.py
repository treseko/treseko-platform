"""Installation-time mount validation for complete-source host updates."""

from pathlib import Path

from .update_participant_commands import load_private_json
from .update_helper_installation import _absolute, _reject_symlink_components, _under

def validate_complete_source_mounts(bridge_config_path, root, launcher_config):
    """Bind the full-source transaction to the exact read-only installed tree."""
    bridge = load_private_json(bridge_config_path)
    controller_path = bridge.get("controller_config")
    if not isinstance(controller_path, str):
        return
    controller_path = _under(root, _absolute(controller_path, "controller config"))
    _reject_symlink_components(root, controller_path)
    controller = load_private_json(controller_path)
    atomic = controller.get("atomic_compose")
    if atomic is None:
        return
    if (not isinstance(atomic, dict) or set(atomic) != {
            "schema", "project", "project_root", "env_file"}
            or type(atomic.get("schema")) is not int or atomic["schema"] != 1):
        raise ValueError("Invalid private complete-source Compose configuration")
    project_root = _under(root, _absolute(atomic["project_root"], "Compose project root"))
    env_file = _under(root, _absolute(atomic["env_file"], "Compose environment file"))
    mounts = launcher_config.get("mounts", {}).get("host_bridge", [])
    project_ro = any(item["source"] == str(project_root) and item["mode"] == "ro"
                     for item in mounts)
    env_ro = any(item["source"] == str(env_file) and item["mode"] == "ro"
                 for item in mounts)
    env_covered = env_file == project_root or project_root in env_file.parents
    state_root = _under(root, _absolute(controller["directory"], "controller state directory"))
    state_rw = any((Path(item["source"]) == state_root or Path(item["source"]) in state_root.parents)
                   and item["mode"] == "rw" for item in mounts)
    if not project_ro or (not env_ro and not env_covered) or not state_rw:
        raise ValueError("Complete-source paths must mount the project/environment readonly and state writable")
    if not project_root.is_dir() or not env_file.is_file():
        raise ValueError("Complete-source Compose project or environment file is unavailable")
