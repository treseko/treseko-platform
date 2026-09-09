"""Compose component runtime for LocalUpdateParticipant (not a standalone updater).

The operator must supply a real ingress fence check, workload drain and live
probe. DB migrations/restore and global ingress ownership are separate ordered
participants. No permissive default for these safety checks is provided.
"""
import json
from pathlib import Path
import re

from .update_docker_build import DockerImagePreparation
from .update_docker_runtime import DockerRuntimeVolume
from .update_journal import exclusive_lock, save_json
from .update_transaction import TransactionFailure
from .update_shared_runtime import SharedRuntimeCatalog

ENGINE_BIND_TARGETS = ("/engine/update-control", "/engine/pending-deliveries")


def validate_engine_bind_mounts(value):
    if not isinstance(value, dict) or set(value) != set(ENGINE_BIND_TARGETS):
        raise ValueError("Engine bind inventory must contain exactly the two control slots")
    normalized = {}
    sources = []
    for target in ENGINE_BIND_TARGETS:
        item = value[target]
        if (not isinstance(item, dict) or set(item) != {"source", "rw"}
                or not isinstance(item["source"], str) or not Path(item["source"]).is_absolute()
                or ".." in Path(item["source"]).parts or item["rw"] is not True):
            raise ValueError("Engine bind source or RW policy is invalid")
        # The source is in the Docker daemon namespace.  It need not exist in
        # the controller's macOS filesystem; the helper validates it remotely.
        source = Path(item["source"])
        if source == Path("/"):
            raise ValueError("Engine bind source cannot be root")
        if any(source == other or source in other.parents or other in source.parents for other in sources):
            raise ValueError("Engine bind sources overlap")
        sources.append(source)
        normalized[target] = {"source": str(source), "rw": True}
    return normalized


class DockerComponentRuntime:
    def __init__(self, service, component, platform, *, fence, drain, probe,
                 runtime_volumes: dict[str, str], mutable_directories: list[str],
                 data_mounts: dict[str, str] | None = None,
                 shared_directory: Path | None = None, shared_mounts: dict[str, str] | None = None,
                 configuration_identity: str | None = None, worker_control=None, backend_control=None,
                 engine_control=None, engine_control_identity: str | None = None,
                 engine_bind_mounts: dict | None = None):
        if component not in {"backend", "frontend", "engine", "automation_worker"}:
            raise ValueError("Unknown component")
        if not all(callable(item) for item in (fence, drain, probe)):
            raise ValueError("Explicit fence, drain and live probe required")
        runtime_root = {"frontend": "/usr/share/nginx/html", "engine": "/engine",
                        "automation_worker": "/worker"}.get(component)
        if any(root != runtime_root or not isinstance(name, str)
               or not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_.-]+", name)
               for root, name in runtime_volumes.items()):
            raise ValueError("Unsupported runtime-volume layout; inventory it before stopping services")
        self.service, self.component, self.platform = service, component, platform
        self.configuration_identity = configuration_identity
        if worker_control is not None and (component != 'automation_worker' or not callable(worker_control)):
            raise ValueError("Worker control is only valid for automation_worker")
        self.worker_control = worker_control
        if backend_control is not None and (component != 'backend' or not callable(backend_control)):
            raise ValueError('Backend control is only valid for backend')
        self.backend_control = backend_control
        if engine_control is not None and (component != "engine" or not callable(engine_control)):
            raise ValueError("Engine control is only valid for engine")
        self.engine_control = engine_control
        self.engine_control_identity = engine_control_identity if engine_control is not None else None
        if engine_bind_mounts is not None and component != "engine":
            raise ValueError("Engine bind inventory is only valid for engine")
        self.engine_bind_mounts = (validate_engine_bind_mounts(engine_bind_mounts)
                                   if engine_bind_mounts is not None else None)
        self.fence, self.drain, self.probe = fence, drain, probe
        self.volumes, self.mutable = dict(runtime_volumes), list(mutable_directories)
        self.data = dict(data_mounts or {})
        self.shared_directory, self.shared = shared_directory, dict(shared_mounts or {})
        if (shared_directory is not None and not shared_directory.is_absolute()) or (self.shared and shared_directory is None):
            raise ValueError("Shared runtime consumers require an absolute private catalog")
        if any(root not in {"/engine", "/worker", "/usr/share/nginx/html"} - {runtime_root}
               or not isinstance(name, str) or not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_.-]+", name)
               for root, name in self.shared.items()):
            raise ValueError("Explicit shared runtime roots and original volumes required")
        allowed_data = {"/app/app/static"} if component == "backend" else set()
        if any(target not in allowed_data or not isinstance(name, str)
               or not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_.-]+", name)
               for target, name in self.data.items()):
            raise ValueError("Only inventoried backend static data can be retained inside code roots")

    def __call__(self, operation, context, release):
        directory = Path(context["directory"]) / "docker-component"
        with exclusive_lock(directory / ".component.lock"):
            scope = {"component": self.component, "platform": self.platform,
                     "configuration_identity": self.configuration_identity,
                     "worker_control": self.worker_control is not None,
                     "engine_control": self.engine_control is not None,
                     "engine_control_identity": self.engine_control_identity,
                     "transaction": context["transaction"], "checksum": release["checksum_sha256"],
                     "version": release["version"], "volumes": self.volumes, "mutable": self.mutable,
                     "data_mounts": self.data,
                     "shared_mounts": self.shared, "shared_directory": str(self.shared_directory) if self.shared_directory else None,
                     "project": self.service.project, "service": self.service.service,
                     "docker": self.service.docker, "files": [str(p) for p in self.service.files],
                     "project_directory": str(self.service.project_directory)}
            if self.backend_control is not None:
                scope['backend_control'] = True
            if self.engine_bind_mounts is not None:
                scope['engine_bind_mounts'] = self.engine_bind_mounts
            journal = directory / "component.json"
            state = json.loads(journal.read_text()) if journal.exists() else None
            if state and state["scope"] != scope:
                raise TransactionFailure("Component runtime inventory changed")
            service_dir = directory / "service"
            if operation == "prepare":
                self.service.prepare(service_dir)
                if state is None:
                    current = self.service._current()
                    if not current or not current["State"]["Running"]:
                        raise TransactionFailure("Original component must be running for live inventory")
                    self._check_mounts(current)
                    previous = self.probe(current)
                    if not isinstance(previous, str) or not previous:
                        raise TransactionFailure("Live previous version unavailable")
                    state = {"scope": scope, "previous_version": previous, "image": None}
                    save_json(journal, state)
                image = DockerImagePreparation(self.service.docker, Path(context["staged"]),
                                               self.component, release["checksum_sha256"], self.platform)
                state["image"] = image.prepare(directory / "image")["image"]
                save_json(journal, state)
                return {"ok": True, "previous_version": state["previous_version"]}
            if state is None or not state["image"]:
                raise TransactionFailure("Component preparation has not completed")
            if operation in {"activate", "finalize"}:
                # Admission is owned by the global ingress participant, not by
                # individual app services. LocalUpdateParticipant guards order.
                if operation == "activate" and self.worker_control:
                    current = self.service._current()
                    if not current or not current['State']['Running']:
                        raise TransactionFailure("Worker must be running before admission resumes")
                    self.service._reconcile(self.service._load(service_dir), current)
                    if self.worker_control('resume', current) is not True:
                        raise TransactionFailure("Worker admission resume unconfirmed")
                if operation == 'activate' and self.backend_control:
                    current = self.service._current()
                    if not current or not current['State']['Running'] or not state.get('verified_version'):
                        raise TransactionFailure('Verified backend must be running before activation')
                    self.service._reconcile(self.service._load(service_dir), current)
                    if self.probe(current) != state['verified_version']:
                        raise TransactionFailure('Backend changed before activation')
                    if self.backend_control('resume', current) is not True:
                        raise TransactionFailure('Backend initialization is not confirmed')
                    if self.probe(current) != state['verified_version']:
                        raise TransactionFailure('Backend changed during activation')
                if operation == "activate" and self.engine_control:
                    current = self.service._current()
                    if not current or not current['State']['Running']:
                        raise TransactionFailure("Engine must be running before admission resumes")
                    self.service._reconcile(self.service._load(service_dir), current)
                    if self.engine_control('resume', current) is not True:
                        raise TransactionFailure("Engine admission resume unconfirmed")
                return {"ok": True}
            if self.fence(context["transaction"]) is not True:
                raise TransactionFailure("Verified installation maintenance fence required")
            if operation == "quiesce":
                current = self.service._current()
                if current and current['State']['Running'] and self.backend_control:
                    if self.backend_control('pause', current) is not True:
                        raise TransactionFailure('Backend API admission pause unconfirmed')
                if current and current['State']['Running'] and self.worker_control:
                    if self.worker_control('pause', current) is not True:
                        raise TransactionFailure("Worker admission pause unconfirmed")
                if current and current['State']['Running'] and self.engine_control:
                    if self.engine_control('pause', current) is not True:
                        raise TransactionFailure("Engine admission drain unconfirmed")
                if current and current["State"]["Running"] and self.drain(current) is not True:
                    raise TransactionFailure("Component workload has not drained")
                self.service.stop(service_dir)
            elif operation == "snapshot":
                self.service.snapshot_stopped(service_dir)
                replacements = {}
                for index, (root, volume) in enumerate(sorted(self.volumes.items())):
                    replacements[root] = DockerRuntimeVolume(self.service.docker).prepare(
                        directory / f"runtime-{index}", state["image"], volume, root, release["version"])
                    if self.shared_directory is not None:
                        SharedRuntimeCatalog(self.shared_directory, context["transaction"], release).publish(
                            volume, root, replacements[root])
                state["replacements"] = replacements
                save_json(journal, state)
            elif operation == "apply":
                current = self.service._current()
                self._check_mounts(current)
                for name in self.data.values():
                    # Never let Compose recreate an empty data volume on retry.
                    self.service._run(["volume", "inspect", name])
                if "replacements" not in state:
                    raise TransactionFailure("Runtime snapshot preparation has not completed")
                replacements = dict(state["replacements"])
                for root, source in self.shared.items():
                    replacements[root] = SharedRuntimeCatalog(self.shared_directory, context["transaction"], release).resolve(source, root)
                self.service.replace_stopped(service_dir, state["image"], runtime_volumes=replacements,
                                             mutable_directories=self.mutable)
            elif operation == "rollback":
                current = self.service._current()
                self._check_mounts(current)
                self.service.replace_stopped(service_dir, rollback=True)
            elif operation == "start":
                self.service.start(service_dir)
            elif operation in {"verify", "verify_rollback"}:
                current = self.service._current()
                self.service._reconcile(self.service._load(service_dir), current)
                expected = release["version"] if operation == "verify" else state["previous_version"]
                if not current or not current["State"]["Running"] or self.probe(current) != expected:
                    raise TransactionFailure("Running component did not pass live verification")
                if self.engine_control is not None:
                    if self.engine_control('verify', current) is not True:
                        raise TransactionFailure("Engine admission closure is not verified")
                if self.backend_control is not None:
                    state['verified_version'] = expected
                    save_json(journal, state)
                return {"ok": True, "version": expected, "transaction": context["transaction"]}
            else:
                raise ValueError("Unknown component operation")
            return {"ok": True}

    def _check_mounts(self, current):
        code_root = {"backend": "/app", "frontend": "/usr/share/nginx/html",
                     "engine": "/engine", "automation_worker": "/worker"}[self.component]
        mounts = current.get("Mounts", [])
        if self.engine_bind_mounts:
            for target, expected in self.engine_bind_mounts.items():
                matches = [m for m in mounts if m.get("Destination") == target]
                if len(matches) != 1:
                    raise TransactionFailure("Engine control bind is missing or duplicated")
                mount = matches[0]
                if (mount.get("Type") != "bind"
                        or mount.get("Source") != expected["source"]
                        or mount.get("RW") is not True):
                    raise TransactionFailure("Engine control bind differs from inventory")
        for root, source in {**self.volumes, **self.data, **self.shared}.items():
            matches = [m for m in mounts if m.get("Destination") == root]
            if len(matches) != 1 or matches[0].get("Type") != "volume" or matches[0].get("Name") != source:
                raise TransactionFailure("Runtime volume does not match the live installation")
        for mount in mounts:
            target = mount["Destination"].rstrip("/") or "/"
            if self.engine_bind_mounts and target in self.engine_bind_mounts:
                expected = self.engine_bind_mounts[target]
                if (mount.get("Type") != "bind"
                        or mount.get("Source") != expected["source"]
                        or mount.get("RW") is not True):
                    raise TransactionFailure("Engine control bind differs from inventory")
                continue
            for shared_root in {"/engine", "/worker", "/usr/share/nginx/html"} - {code_root}:
                if (target == shared_root or target.startswith(shared_root + "/")
                        or shared_root.startswith(target.rstrip("/") + "/")) and target not in self.shared:
                    raise TransactionFailure("Shared component runtime requires a coordinated volume mapping")
            if (target == code_root or code_root.startswith(target.rstrip("/") + "/")
                    or target.startswith(code_root + "/")) and target not in self.volumes and target not in self.data:
                raise TransactionFailure("Code-covering mount requires an explicit runtime replacement")
