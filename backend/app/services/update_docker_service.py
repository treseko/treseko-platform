"""Replace one Compose service using prepared local image IDs, preserving its config.

Image verification/distribution, ingress fencing, job draining and runtime-volume
replacement belong to the enclosing driver. This primitive never pulls/builds,
starts dependencies, prunes images or removes volumes. Its journal is private.
"""
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess

from .update_journal import exclusive_lock, save_json
from .update_docker_mutable import preserve_mutable_directory
from .update_transaction import TransactionFailure
from .update_recovery_pipeline import recover_stopped_baseline


class DockerServiceImageSwitch:
    def __init__(self, docker: str, project: str, service: str, config_files: list[Path],
                 project_directory: Path, *, snapshot_mode: str = 'commit',
                 active_compose_file: Path | None = None):
        if (not Path(docker).is_absolute() or not re.fullmatch(r"[a-z0-9][a-z0-9_-]*", project)
                or not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_.-]*", service)
                or not config_files or not all(path.is_absolute() for path in config_files)
                or not project_directory.is_absolute()):
            raise ValueError("An explicit Compose service and absolute configuration paths are required")
        self.docker, self.project, self.service = docker, project, service
        self.files, self.project_directory = config_files, project_directory
        if active_compose_file is not None and (
                not active_compose_file.is_absolute() or active_compose_file == Path('/')
                or '..' in active_compose_file.parts):
            raise ValueError('A dedicated absolute active Compose state file is required')
        self.active_compose_file = active_compose_file
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
        effective_files = files if files is not None else self._effective_files()
        for path in effective_files:
            command += ["--file", str(path)]
        return self._run([*command, *arguments])

    def _effective_files(self):
        if self.active_compose_file is None or not self.active_compose_file.exists():
            return self.files
        if self.active_compose_file.is_symlink() or not self.active_compose_file.is_file():
            raise TransactionFailure('Persisted active Compose model is unsafe')
        metadata = self.active_compose_file.stat()
        if metadata.st_mode & 0o077 or metadata.st_uid not in {0, os.geteuid()}:
            raise TransactionFailure('Persisted active Compose model is unsafe')
        return [self.active_compose_file]

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

    def active_runtime_volumes(self, targets):
        """Resolve current named-volume identities from the persisted Compose model."""
        model = json.loads(self._compose(["config", "--format", "json"]))
        service = model.get('services', {}).get(self.service)
        if not isinstance(service, dict):
            raise TransactionFailure('Active Compose service model is unavailable')
        declared = {}
        for mount in service.get('volumes', []):
            if not isinstance(mount, dict) or mount.get('target') not in targets:
                continue
            source = mount.get('source')
            volume = model.get('volumes', {}).get(source)
            name = volume.get('name', source) if isinstance(volume, dict) else source
            if mount.get('type') != 'volume' or not isinstance(name, str) or not name:
                raise TransactionFailure('Active runtime volume identity is invalid')
            declared[mount['target']] = name
        if set(declared) != set(targets):
            raise TransactionFailure('Active Compose model omits an inventoried runtime volume')
        return declared

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
            self._seed_active_compose_model(model, expected)
            state = {"schema": 1, "project": self.project, "service": self.service,
                     "original": current["Id"], "current": current["Id"], "model": model,
                     "original_image": current["Image"],
                     "original_reference": current["Config"]["Image"],
                     "snapshot_image": None, "pending": None,
                     "snapshot_mode": self.snapshot_mode}
            save_json(directory / "service.json", state)
            return state

    def _seed_active_compose_model(self, model, expected_hash):
        """Initialize the per-service canonical model before the first mutation."""
        target = self.active_compose_file
        if target is None:
            return
        try:
            parent = target.parent.lstat()
        except OSError as exc:
            raise TransactionFailure("Persistent active Compose directory is unavailable") from exc
        if (not target.parent.is_dir() or target.parent.is_symlink()
                or parent.st_uid not in {0, os.geteuid()} or parent.st_mode & 0o077):
            raise TransactionFailure("Persistent active Compose directory is unsafe")
        with exclusive_lock(target.with_name(target.name + ".lock")):
            try:
                existing = target.lstat()
            except FileNotFoundError:
                existing = None
            if existing is not None:
                if not stat.S_ISREG(existing.st_mode) or target.is_symlink():
                    raise TransactionFailure("Persisted active Compose model is unsafe")
                if existing.st_mode & 0o077 or existing.st_uid not in {0, os.geteuid()}:
                    raise TransactionFailure("Persisted active Compose model is unsafe")
                if self._hash([target]) != expected_hash:
                    raise TransactionFailure("Persisted active Compose model differs from the running installation")
                return
            save_json(target, model)
            target.chmod(0o600)
            if self._hash([target]) != expected_hash:
                raise TransactionFailure("Initial active Compose model does not match the running installation")

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
            definitions = model.setdefault("volumes", {})
            existing = definitions.get(key)
            if existing is not None and (
                    not isinstance(existing, dict) or existing.get("external") is not True
                    or not isinstance(existing.get("name"), str)):
                raise TransactionFailure("Runtime volume alias conflicts with installation configuration")
            definitions[key] = {"external": True, "name": name}
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

    def verify_original_running(self, directory: Path):
        """Verify a pre-apply recovery without recreating the original service.

        A coordinator can choose rollback after another participant fails in
        ``prepare``.  In that case this service was quiesced and restarted, but
        it was never snapshotted or replaced.  Treating that no-op recovery as
        a writable-layer rollback is both unnecessary and unsafe: there is no
        private snapshot or mutable-directory inventory to canonicalize.
        """
        with exclusive_lock(directory / ".service.lock"):
            state = self._load(directory)
            if state.get("snapshot_image") is not None:
                raise TransactionFailure("Original verification is only valid before snapshot")
            if state.get("pending") is not None:
                raise TransactionFailure("Original service still has a pending replacement")
            current = self._current()
            self._reconcile(state, current)
            if (not current or not current["State"]["Running"]
                    or current["Id"] != state["original"]
                    or current["Image"] != state["original_image"]):
                raise TransactionFailure("Pre-apply rollback did not preserve the original service")
            desired_hash = self._hash()
            if current["Config"]["Labels"].get("com.docker.compose.config-hash") != desired_hash:
                raise TransactionFailure("Installed Compose model changed during pre-apply rollback")
            reference = state.get("original_reference")
            if not isinstance(reference, str) or not reference:
                raise TransactionFailure("Original image reference is unavailable")
            inspected = json.loads(self._run(["image", "inspect", reference]))
            if len(inspected) != 1 or inspected[0].get("Id") != state["original_image"]:
                raise TransactionFailure("Original image reference changed during pre-apply rollback")
            return current["Id"]

    def canonicalize_running(self, directory: Path):
        """Return a verified rollback to the installed Compose model.

        Snapshot images preserve a stopped container's writable layer, but a
        container recreated from that private image has a different Compose
        hash.  Once rollback verification has succeeded, immutable services
        with no declared mutable directories can safely return to their exact
        original image/reference and canonical model while ingress is fenced.
        """
        with exclusive_lock(directory / ".service.lock"):
            state = self._load(directory)
            current = self._current()
            self._reconcile(state, current)
            if not current or not current["State"]["Running"]:
                raise TransactionFailure("Verified rollback service must be running")
            if state.get("mutable_directories") != []:
                raise TransactionFailure("Rollback with mutable writable-layer data cannot be canonicalized")
            reference = state.get("original_reference")
            if not isinstance(reference, str) or not reference:
                raise TransactionFailure("Original image reference is unavailable")
            inspected = json.loads(self._run(["image", "inspect", reference]))
            if len(inspected) != 1 or inspected[0].get("Id") != state["original_image"]:
                raise TransactionFailure("Original image reference changed after rollback")
            model = copy.deepcopy(state["model"])
            config = directory / "canonical-compose.json"
            save_json(config, model)
            desired_hash = self._hash([config])
            if desired_hash != self._hash():
                raise TransactionFailure("Installed Compose model changed during rollback")
            state["pending"] = {"image": state["original_image"], "hash": desired_hash}
            save_json(directory / "service.json", state)
            self._compose(["up", "-d", "--no-deps", "--force-recreate", "--no-build",
                           "--pull", "never", self.service], [config])
            current = self._current()
            if (not current or not current["State"]["Running"]
                    or current["Image"] != state["original_image"]
                    or current["Config"]["Labels"].get("com.docker.compose.config-hash") != desired_hash):
                raise TransactionFailure("Canonical rollback service did not converge")
            state.update(current=current["Id"], pending=None,
                         active_config=str(config), canonicalized=True)
            save_json(directory / "service.json", state)
            return current["Id"]

    def persist_active_compose(self, directory: Path):
        """Commit the verified Compose model as the source for the next release."""
        if self.active_compose_file is None:
            raise TransactionFailure('Persistent active Compose model is not configured')
        with exclusive_lock(directory / '.service.lock'):
            state = self._load(directory)
            source = state.get('active_config')
            if not isinstance(source, str) or not Path(source).is_absolute():
                raise TransactionFailure('Verified active Compose model is unavailable')
            current = self._current()
            self._reconcile(state, current)
            if not current or not current['State']['Running']:
                raise TransactionFailure('Active Compose model requires a running verified service')
            model_path = Path(source)
            if model_path.is_symlink() or not model_path.is_file():
                raise TransactionFailure('Verified active Compose model is unsafe')
            expected_hash = self._hash([model_path])
            if current['Config']['Labels'].get('com.docker.compose.config-hash') != expected_hash:
                raise TransactionFailure('Verified service does not match its active Compose model')
            model = json.loads(model_path.read_text(encoding='utf-8'))
            target = self.active_compose_file
            target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            with exclusive_lock(target.with_name(target.name + '.lock')):
                try:
                    existing = target.lstat()
                except FileNotFoundError:
                    existing = None
                if existing is not None and (
                        not stat.S_ISREG(existing.st_mode) or target.is_symlink()
                        or existing.st_mode & 0o077
                        or existing.st_uid not in {0, os.geteuid()}):
                    raise TransactionFailure('Persisted active Compose model is unsafe')
                save_json(target, model)
                target.chmod(0o600)
            if self._hash() != expected_hash:
                raise TransactionFailure('Persisted active Compose model did not preserve the running identity')
