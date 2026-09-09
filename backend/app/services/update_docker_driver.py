"""Private built-in Docker driver child, launched through CommandRuntime.

Configuration comes from the host helper's private file, NEVER the remote
request. The child inherits the participant lock for crash/timeout safety.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import time

from .update_docker_component import DockerComponentRuntime, validate_engine_bind_mounts
from .update_docker_service import DockerServiceImageSwitch
from .update_participant_commands import CommandRuntime, RUNTIME_OPERATIONS
from .update_worker_control import DockerWorkerControl
from .update_worker_drain import DockerWorkerDrain
from .update_backend_control import DockerBackendControl
from .update_transaction import TransactionFailure
from .update_engine_control import DockerEngineControl


def create_driver(config, context, release):
    if isinstance(config, dict) and config.get("type") == "docker-postgres":
        from .update_postgres_driver import create_driver as create_postgres_driver
        return create_postgres_driver(config, context, release)
    required = {"type", "docker", "project", "service", "project_directory", "config_files",
                "component", "platform", "runtime_volumes", "mutable_directories", "checks"}
    optional = {"data_mounts", "shared_directory", "shared_mounts", "check_timeout_seconds", "worker_control", 'ai_queue_control', 'backend_control', 'snapshot_mode', 'engine_control', 'engine_bind_mounts'}
    if (not isinstance(config, dict) or not required <= set(config) or set(config) - required - optional
            or config["type"] != "docker-compose"
            or not isinstance(config["checks"], dict) or set(config["checks"]) != {"fence", "drain", "probe"}
            or not isinstance(config["config_files"], list) or not config["config_files"]
            or not all(isinstance(p, str) for p in config["config_files"])
            or not isinstance(config["runtime_volumes"], dict)
            or config["platform"] not in {"linux/amd64", "linux/arm64"}
            or not isinstance(config["mutable_directories"], list)
            or not all(isinstance(p, str) and Path(p).is_absolute() for p in config["mutable_directories"])):
        raise ValueError("Invalid private Docker driver configuration")
    engine_config = config.get("engine_control")
    engine_bind_mounts = config.get("engine_bind_mounts")
    if engine_bind_mounts is not None:
        if config["component"] != "engine":
            raise ValueError("Engine bind inventory is only valid for engine")
        engine_bind_mounts = validate_engine_bind_mounts(engine_bind_mounts)
        if isinstance(engine_config, dict) and (
                engine_config.get("control_path") != engine_bind_mounts["/engine/update-control"]["source"]
                or engine_config.get("target_path") != "/engine/update-control"):
            raise ValueError("Engine control config must match its inventoried bind")
    if engine_config is not None:
        if config["component"] != "engine":
            raise ValueError("Engine control is only valid for engine")
        if (not isinstance(engine_config, dict)
                or set(engine_config) != {"control_path", "target_path", "owner_uid", "port",
                                          "token_env", "token_file_env", "callback_check",
                                          "callback_wait_seconds"}
                or not isinstance(engine_config["control_path"], str)
                or not Path(engine_config["control_path"]).is_absolute()
                or Path(engine_config["control_path"]) == Path("/")
                or ".." in Path(engine_config["control_path"]).parts
                or not isinstance(engine_config["target_path"], str)
                or not Path(engine_config["target_path"]).is_absolute()
                or Path(engine_config["target_path"]) == Path("/")
                or ".." in Path(engine_config["target_path"]).parts
                or type(engine_config["owner_uid"]) is not int or engine_config["owner_uid"] < 0
                or engine_config["owner_uid"] > 2**31 - 1
                or not isinstance(engine_config["port"], int) or isinstance(engine_config["port"], bool)
                or not 1 <= engine_config["port"] <= 65535
                or not all(isinstance(engine_config[name], str) and engine_config[name]
                           for name in ("token_env", "token_file_env"))
                or not all(re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", engine_config[name])
                           for name in ("token_env", "token_file_env"))
                or not isinstance(engine_config["callback_check"], list)
                or not engine_config["callback_check"]
                or not all(isinstance(arg, str) and arg and "\x00" not in arg
                           for arg in engine_config["callback_check"])
                or not Path(engine_config["callback_check"][0]).is_absolute()
                or not isinstance(engine_config["callback_wait_seconds"], (int, float))
                or isinstance(engine_config["callback_wait_seconds"], bool)
                or not 0 < engine_config["callback_wait_seconds"] <= 300):
            raise ValueError("Invalid private Engine control configuration")
    service = DockerServiceImageSwitch(config["docker"], config["project"], config["service"],
                                      [Path(p) for p in config["config_files"]], Path(config["project_directory"]),
                                      snapshot_mode=config.get('snapshot_mode', 'commit'))
    checks = {name: CommandRuntime({op: argv for op in RUNTIME_OPERATIONS}, config.get("check_timeout_seconds", 60))
              for name, argv in config["checks"].items()}
    def check(name, current=None):
        # Do not serialize Docker inspect: it can contain environment secrets.
        check_context = {**context, "check": name, "component": config["component"],
                         "project": config["project"], "service": config["service"]}
        if current:
            check_context.update(container_id=current["Id"], image_id=current["Image"])
        operation = "verify" if name == "probe" else "quiesce"
        result = checks[name](operation, check_context, release)
        if result.get("ok") is not True:
            return None
        return result.get("version") if name == "probe" else True
    worker_control = None
    if "worker_control" in config:
        control = config['worker_control']
        if (config['component'] != 'automation_worker' or not isinstance(control, dict)
                or set(control) != {'directory', 'script'}
                or not isinstance(control['directory'], str)
                or not isinstance(control['script'], str)
                or not any(Path(root) in Path(control['directory']).parents for root in config['mutable_directories'])):
            raise ValueError("Worker control must be preserved inside an inventoried mutable directory")
        controller = DockerWorkerControl(config['docker'], control['directory'])
        drain = DockerWorkerDrain(config['docker'], control['directory'], control['script'])
        def worker_control(action, current):
            pinned = {**context, 'component':'automation_worker', 'project':config['project'],
                      'service':config['service'], 'container_id':current['Id'], 'image_id':current['Image']}
            controller.change(action, pinned)
            if action == 'pause':
                deadline = time.monotonic() + 30
                while True:
                    try:
                        drain.drain(pinned)
                        break
                    except TransactionFailure:
                        if time.monotonic() >= deadline:
                            raise
                        time.sleep(0.2)
            return True
    backend_control = None
    if 'backend_control' in config:
        control = config['backend_control']
        if (config['component'] != 'backend' or not isinstance(control, dict)
                or set(control) != {'directory', 'port'}
                or not isinstance(control['directory'], str)
                or not any(Path(root) in Path(control['directory']).parents for root in config['mutable_directories'])):
            raise ValueError('Backend control must be preserved inside an inventoried mutable directory')
        backend_controller = DockerBackendControl(config['docker'], control['directory'], control['port'])
        def backend_control(action, current):
            pinned = {**context, 'component':'backend', 'project':config['project'],
                      'service':config['service'], 'container_id':current['Id'], 'image_id':current['Image']}
            ready = backend_controller.change(action, pinned)
            if action == 'pause':
                return ready is False
            deadline = time.monotonic() + config.get('check_timeout_seconds', 60)
            while not ready:
                if time.monotonic() >= deadline:
                    raise TransactionFailure('Backend initialization remains unavailable')
                time.sleep(.2)
                ready = backend_controller.change('ready', pinned)
            return True
    engine_control = None
    engine_control_identity = None
    if engine_config is not None:
        callback_command = CommandRuntime(
            {op: list(engine_config["callback_check"]) for op in RUNTIME_OPERATIONS},
            engine_config["callback_wait_seconds"])

        def engine_control(action, current):
            if not isinstance(current, dict) or not isinstance(current.get("Id"), str):
                raise TransactionFailure("Engine control requires the service-selected container")
            container_id = current["Id"]

            def callback_proof(transaction):
                # Only stable identity and transaction metadata cross this boundary;
                # token values and the parent context are deliberately excluded.
                callback_context = {"transaction": transaction, "participant": context.get("participant"),
                                    "component": "engine", "project": config["project"],
                                    "service": config["service"], "action": "callback_check",
                                    "container_id": container_id, "image_id": current.get("Image")}
                result = callback_command("verify", callback_context,
                                          {"version": release.get("version"),
                                           "checksum_sha256": release.get("checksum_sha256")})
                return result.get("ok") is True

            controller = DockerEngineControl(
                config["docker"], container_id, config["project"], config["service"],
                Path(engine_config["control_path"]), engine_config["target_path"],
                engine_config["port"], engine_config["token_env"], engine_config["token_file_env"],
                engine_config["owner_uid"], config.get("check_timeout_seconds", 60), callback_proof)
            transaction = context["transaction"]
            if action == "pause":
                controller.pause(container_id, transaction)
                controller.drain(container_id, transaction, engine_config["callback_wait_seconds"])
                return True
            if action == "verify":
                controller.assert_closed(container_id, transaction)
                status = controller.status(container_id)
                terminal = status["terminal_delivery"]
                return (status["fenced"] and not status["admission_open"]
                        and status["active_leases"] == 0 and status["drainable"]
                        and terminal["pending_local_deliveries"] == 0
                        and terminal["local_spool_state"] in {"empty", "available"})
            if action == "resume":
                controller.resume(container_id, transaction)
                return True
            raise ValueError("Unknown Engine control action")

        engine_control_identity = hashlib.sha256(
            json.dumps(engine_config, sort_keys=True).encode()).hexdigest()
    runtime = DockerComponentRuntime(service, config["component"], config["platform"],
        fence=lambda transaction: transaction == context["transaction"] and check("fence"),
        drain=lambda current: check("drain", current), probe=lambda current: check("probe", current),
        runtime_volumes=config["runtime_volumes"], mutable_directories=config["mutable_directories"],
        data_mounts=config.get("data_mounts"), shared_mounts=config.get("shared_mounts"),
        shared_directory=Path(config["shared_directory"]) if config.get("shared_directory") else None,
        configuration_identity=hashlib.sha256(json.dumps(config, sort_keys=True).encode()).hexdigest(),
        worker_control=worker_control, backend_control=backend_control,
                                     engine_control=engine_control, engine_control_identity=engine_control_identity,
                                     engine_bind_mounts=engine_bind_mounts)
    if 'ai_queue_control' in config:
        if config['component'] != 'backend':
            raise ValueError('AI queue control must wrap the backend participant')
        from .update_ai_queue_guard import AIQueueAdmissionGuard
        runtime = AIQueueAdmissionGuard(runtime, config['ai_queue_control'])
    return runtime


class DockerCommandRuntime:
    def __init__(self, config, timeout=2100):
        self.config = config
        self.command = CommandRuntime({op: [sys.executable, "-m", __name__] for op in RUNTIME_OPERATIONS}, timeout)
        # Validate all local commands/layout before the participant starts work.
        create_driver(config, {"transaction": "configuration-validation"}, {})

    def __call__(self, operation, context, release):
        if "_lock_fd" not in context:
            raise ValueError("Docker driver requires the participant lock")
        enriched = {**context, "docker_config": self.config, "_driver_lock_fd": context["_lock_fd"]}
        return self.command(operation, enriched, release)


def main():
    try:
        raw = sys.stdin.buffer.read(1024 * 1024 + 1)
        if len(raw) > 1024 * 1024:
            raise ValueError("Driver request exceeds limit")
        request = json.loads(raw)
        context = dict(request["context"])
        config = context.pop("docker_config")
        lock_fd = context.pop("_driver_lock_fd")
        if not isinstance(lock_fd, int) or lock_fd < 3:
            raise ValueError("Invalid inherited lock")
        os.fstat(lock_fd)
        context["_lock_fd"] = lock_fd
        operation = request["operation"]
        if request.get("schema") != 1 or operation not in RUNTIME_OPERATIONS:
            raise ValueError("Invalid driver envelope")
        driver = create_driver(config, context, request["release"])
        result = driver(operation, context, request["release"])
        print(json.dumps({**result, "schema": 1, "operation": operation,
                          "transaction": context["transaction"], "participant": context["participant"]}))
        return 0
    except Exception:
        print(json.dumps({"ok": False, "error": "docker_driver_failed"}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
