"""Replace one Compose service using prepared local image IDs, preserving its config.

Image verification/distribution, ingress fencing, job draining and runtime-volume
replacement belong to the enclosing driver. This primitive never pulls/builds,
starts dependencies, prunes images or removes volumes. Its journal is private.
"""
import copy
import hashlib
import json
from pathlib import Path
import re
import subprocess

from .update_journal import exclusive_lock, save_json
from .update_docker_mutable import preserve_mutable_directory
from .update_transaction import TransactionFailure
from .update_recovery_pipeline import recover_stopped_baseline


class DockerServiceImageSwitch:
    def __init__(self, docker: str, project: str, service: str, config_files: list[Path],
                 project_directory: Path, *, snapshot_mode: str = 'commit'):
        if (not Path(docker).is_absolute() or not re.fullmatch(r"[a-z0-9][a-z0-9_-]*", project)
                or not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_.-]*", service)
                or not config_files or not all(path.is_absolute() for path in config_files)
                or not project_directory.is_absolute()):
            raise ValueError("An explicit Compose service and absolute configuration paths are required")
        self.docker, self.project, self.service = docker, project, service
        self.files, self.project_directory = config_files, project_directory
        if snapshot_mode not in {'commit', 'private-export'}:
            raise ValueError('Explicit supported snapshot mode required')
        self.snapshot_mode = snapshot_mode

    def _run(self, arguments):
        try:
            result = subprocess.run([self.docker, *arguments], capture_output=True, timeout=120, check=False)
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise TransactionFailure("Docker service outcome uncertain; retain maintenance") from exc
        if result.returncode:
            raise TransactionFailure("Docker service operation failed; retain maintenance")
        return result.stdout

    def _compose(self, arguments, files=None):
        command = ["compose", "--project-name", self.project, "--project-directory", str(self.project_directory)]
        for path in files or self.files:
            command += ["--file", str(path)]
        return self._run([*command, *arguments])

    def _current(self):
        ids = self._run(["ps", "--all", "--no-trunc", "--filter", "label=com.docker.compose.project=" + self.project,
                         "--filter", "label=com.docker.compose.service=" + self.service,
                         "--filter", "label=com.docker.compose.oneoff=False", "--format", "{{.ID}}"])
        values = ids.decode().split()
        if not values:
            return None
        if len(values) != 1:
            raise TransactionFailure("Service inventory must identify exactly one replica")
        record = json.loads(self._run(["inspect", "--type", "container", values[0]]))[0]
        labels = record.get("Config", {}).get("Labels") or {}
        if labels.get("com.docker.compose.project") != self.project or labels.get("com.docker.compose.service") != self.service:
            raise TransactionFailure("Container does not match service scope")
        return record

    def _hash(self, files=None):
        return self._compose(["config", "--hash", self.service], files).decode().split()[-1]

    def _load(self, directory):
        state = json.loads((directory / "service.json").read_text())
        if state["project"] != self.project or state["service"] != self.service:
            raise TransactionFailure("Service journal belongs to another target")
        if state.get('snapshot_mode', 'commit') != self.snapshot_mode:
            raise TransactionFailure('Snapshot mode changed during transaction')
        return state

    def prepare(self, directory: Path):
        with exclusive_lock(directory / ".service.lock"):
            if (directory / "service.json").exists():
                return self._load(directory)
            current = self._current()
            if current is None:
                raise TransactionFailure("Original service container is missing")
            self._require_snapshot_source(current)
            expected = self._hash()
            if current["Config"]["Labels"].get("com.docker.compose.config-hash") != expected:
                raise TransactionFailure("Compose configuration differs from the running installation")
            model = json.loads(self._compose(["config", "--format", "json"]))
            # Compose's renderer already escapes literal dollars. Prove its
            # output round-trips on this installed CLI before stopping anything.
            prepared = directory / "prepared-compose.json"
            save_json(prepared, model)
            if self._hash([prepared]) != expected:
                raise TransactionFailure("Installed Compose cannot faithfully replay the captured configuration")
            state = {"schema": 1, "project": self.project, "service": self.service,
                     "original": current["Id"], "current": current["Id"], "model": model,
                     "original_image": current["Image"], "snapshot_image": None, "pending": None,
                     "snapshot_mode": self.snapshot_mode}
            save_json(directory / "service.json", state)
            return state

    def _require_snapshot_source(self, current):
        if self.snapshot_mode == 'private-export':
            platform = (current.get('ImageManifestDescriptor') or {}).get('platform') or {}
            if platform.get('os') != 'linux' or platform.get('architecture') not in {'amd64', 'arm64'}:
                raise TransactionFailure('Private recovery requires recorded Linux image platform')
            return
        # A container can keep running after its parent image was removed.
        # Docker commit then fails; its configured tag may point elsewhere.
        # Never stop it or choose that tag as an implicit rollback baseline.
        try:
            self._run(['image', 'inspect', current['Image']])
        except TransactionFailure as exc:
            raise TransactionFailure('Original image unavailable; recover the pinned baseline before stopping services') from exc

    def _reconcile(self, state, current):
        if current and current["Id"] == state["current"]:
            return
        pending = state.get("pending")
        if pending and (current is None or (
                current["Image"] == pending["image"]
                and current["Config"]["Labels"].get("com.docker.compose.config-hash") == pending["hash"])):
            if current:
                state["current"] = current["Id"]
            return
        raise TransactionFailure("Service changed outside the update transaction")

    def stop(self, directory: Path):
        with exclusive_lock(directory / ".service.lock"):
            state = self._load(directory)
            current = self._current()
            self._reconcile(state, current)
            if current and current['Id'] == state['original'] and not state['snapshot_image']:
                self._require_snapshot_source(current)
            if current and current["State"]["Running"]:
                self._run(["stop", "--time", "30", current["Id"]])
            save_json(directory / "service.json", state)

    def snapshot_stopped(self, directory: Path):
        with exclusive_lock(directory / ".service.lock"):
            state = self._load(directory)
            if self.snapshot_mode == 'private-export':
                current = self._current()
                self._reconcile(state, current)
                if not state['snapshot_image'] and (not current or current['Id'] != state['original']
                                                    or current['State']['Running']):
                    raise TransactionFailure('Original service must be stopped before private recovery')
                owner = hashlib.sha256(str(directory.resolve()).encode()).hexdigest()
                recovered = recover_stopped_baseline(self, state['original'], directory / 'recovery', owner)
                image = recovered['image_id']
                if state['snapshot_image'] is not None and state['snapshot_image'] != image:
                    raise TransactionFailure('Private recovery snapshot changed')
                state['snapshot_image'] = image
                save_json(directory / 'service.json', state)
                return image
            if state["snapshot_image"]:
                self._run(["image", "inspect", state["snapshot_image"]])
                return state["snapshot_image"]
            current = self._current()
            if current is None or current["Id"] != state["original"] or current["State"]["Running"]:
                raise TransactionFailure("Original service must be stopped before pinning its writable layer")
            label = hashlib.sha256(str(directory.resolve()).encode()).hexdigest()
            output = self._run(["commit", "--change",
                                "LABEL io.treseko.update-snapshot=" + label, current["Id"]]).decode()
            images = re.findall(r"(?m)^sha256:[a-f0-9]{64}$", output)
            if len(images) != 1:
                raise TransactionFailure("Docker did not return an unambiguous snapshot image ID")
            image = images[0]
            state["snapshot_image"] = image
            save_json(directory / "service.json", state)
            return image

    def _replace_volumes(self, model, replacements):
        mounts = model["services"][self.service].get("volumes", [])
        for target, name in replacements.items():
            if not isinstance(name, str) or not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_.-]+", name):
                raise ValueError("An existing named runtime volume is required")
            matches = [mount for mount in mounts if mount.get("target") == target]
            if len(matches) != 1 or matches[0].get("type") != "volume" or not matches[0].get("source"):
                raise TransactionFailure("Runtime replacement must target an existing named-volume mount")
            # Inspect first: Compose must not silently create an empty volume.
            self._run(["volume", "inspect", name])
            key = "treseko_update_" + hashlib.sha256(target.encode()).hexdigest()[:24]
            if key in model.get("volumes", {}):
                raise TransactionFailure("Runtime volume alias conflicts with installation configuration")
            model.setdefault("volumes", {})[key] = {"external": True, "name": name}
            matches[0]["source"] = key
            # A prepared runtime must not receive old image content by copy-up.
            matches[0].setdefault("volume", {})["nocopy"] = True

    def replace_stopped(self, directory: Path, image: str | None = None, *, rollback=False,
                        runtime_volumes: dict[str, str] | None = None,
                        mutable_directories: list[str] | None = None):
        with exclusive_lock(directory / ".service.lock"):
            state = self._load(directory)
            if not state["snapshot_image"]:
                raise TransactionFailure("Writable-layer snapshot must be pinned first")
            self._run(["image", "inspect", state["snapshot_image"]])
            image = state["snapshot_image"] if rollback else image
            if not isinstance(image, str) or not re.fullmatch(r"sha256:[a-f0-9]{64}", image):
                raise ValueError("A prepared local immutable image ID is required")
            self._run(["image", "inspect", image])
            current = self._current()
            self._reconcile(state, current)
            if current and current["State"]["Running"]:
                raise TransactionFailure("Service must remain stopped during replacement")
            model = copy.deepcopy(state["model"])
            if rollback and runtime_volumes is not None:
                raise ValueError("Rollback restores the original volume mapping")
            if rollback and mutable_directories is not None:
                raise ValueError("Rollback restores the original writable-layer data")
            if rollback:
                for mount in model["services"][self.service].get("volumes", []):
                    if mount.get("type") == "volume" and mount.get("source"):
                        name = model["volumes"][mount["source"]].get("name")
                        if not name:
                            raise TransactionFailure("Original runtime volume identity is unresolved")
                        self._run(["volume", "inspect", name])
            if not rollback:
                directories = mutable_directories if mutable_directories is not None else state.get("mutable_directories", [])
                if (not isinstance(directories, list) or not all(isinstance(path, str) for path in directories)
                        or len(set(directories)) != len(directories)):
                    raise ValueError("Mutable directories must be an explicit unique path list")
                if "mutable_directories" in state and directories != state["mutable_directories"]:
                    raise TransactionFailure("Prepared mutable directory inventory is immutable")
                state["mutable_directories"] = list(directories)
                replacements = runtime_volumes if runtime_volumes is not None else state.get("runtime_volumes", {})
                if not isinstance(replacements, dict):
                    raise ValueError("Runtime volumes must map mount targets to prepared volume names")
                if "runtime_volumes" in state and replacements != state["runtime_volumes"]:
                    raise TransactionFailure("Prepared runtime volume mapping is immutable")
                self._replace_volumes(model, replacements)
                state["runtime_volumes"] = copy.deepcopy(replacements)
            model["services"][self.service]["image"] = image
            model["services"][self.service].pop("build", None)
            config = directory / ("rollback-compose.json" if rollback else "candidate-compose.json")
            save_json(config, model)
            desired_hash = self._hash([config])
            state["pending"] = {"image": image, "hash": desired_hash}
            save_json(directory / "service.json", state)
            if not current or current["Image"] != image or current["Config"]["Labels"].get("com.docker.compose.config-hash") != desired_hash:
                self._compose(["up", "--no-start", "--no-deps", "--force-recreate", "--no-build",
                               "--pull", "never", self.service], [config])
            current = self._current()
            if (not current or current["Image"] != image or current["State"]["Running"]
                    or current["Config"]["Labels"].get("com.docker.compose.config-hash") != desired_hash):
                raise TransactionFailure("Replacement service does not match prepared image/configuration")
            if not rollback:
                for path in state["mutable_directories"]:
                    preserve_mutable_directory(self.docker, state["snapshot_image"], current["Id"], path)
            state.update(current=current["Id"], pending=None, active_config=str(config))
            save_json(directory / "service.json", state)
            return current["Id"]

    def start(self, directory: Path):
        with exclusive_lock(directory / ".service.lock"):
            state = self._load(directory)
            current = self._current()
            self._reconcile(state, current)
            if current is None or state["pending"]:
                raise TransactionFailure("Replacement has not been reconciled")
            self._run(["start", current["Id"]])
