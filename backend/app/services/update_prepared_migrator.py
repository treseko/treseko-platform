"""Private adapter that resolves the PostgreSQL migrator image before quiesce."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import stat

from .update_docker_migrator import DockerPostgresMigrator
from .update_runtime_preparation import RuntimeImagePreparation
from .update_migrator_identity import release_digest


_DIGEST = re.compile(r"sha256:[a-f0-9]{64}\Z")
_MAX_CONFIG_BYTES = 1024 * 1024


class PreparedPostgresMigrator:
    """Resolve one signed backend image, then delegate migration operations.

    The trusted runtime-preparation path is constructor configuration, never a
    release/request field.  Preparation is the only method allowed to build;
    migration and idle only accept the binding persisted by the participant.
    """

    def __init__(self, *, docker: str, runtime_preparation_config: str,
                 network: str, env_file: str, scope: str, owner: str,
                 timeout: float = 2100):
        self.docker = docker
        self.runtime_preparation_config = str(runtime_preparation_config)
        self.network = network
        self.env_file = env_file
        self.scope = scope
        self.owner = owner
        self.timeout = timeout
        _, self.runtime_config_sha256 = self._config_snapshot()

    def _config_snapshot(self):
        path = Path(self.runtime_preparation_config)
        if (not path.is_absolute() or ".." in path.parts or path.is_symlink()):
            raise ValueError("A trusted runtime preparation config is required")
        try:
            descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        except OSError as exc:
            raise ValueError("A trusted runtime preparation config is required") from exc
        with os.fdopen(descriptor, "rb") as stream:
            metadata = os.fstat(stream.fileno())
            if (not stat.S_ISREG(metadata.st_mode)
                    or metadata.st_uid not in {0, os.geteuid()}
                    or metadata.st_mode & 0o022
                    or metadata.st_size > _MAX_CONFIG_BYTES):
                raise ValueError("Runtime preparation config must be private and operator-owned")
            raw = stream.read(_MAX_CONFIG_BYTES + 1)
        if len(raw) > _MAX_CONFIG_BYTES:
            raise ValueError("Runtime preparation config is too large")
        try:
            config = json.loads(raw.decode("utf-8"))
        except (UnicodeError, ValueError) as exc:
            raise ValueError("Invalid runtime preparation config") from exc
        if not isinstance(config, dict) or config.get("schema") != 1:
            raise ValueError("Invalid runtime preparation config schema")
        components = config.get("components")
        if not isinstance(components, list) or "backend" not in components:
            raise ValueError("Runtime preparation must declare the backend component")
        return config, hashlib.sha256(raw).hexdigest()

    def _config(self):
        return self._config_snapshot()

    def prepare(self, context, release):
        if not isinstance(context, dict) or not isinstance(context.get("transaction"), str):
            raise ValueError("A preparation transaction is required")
        config, before_digest = self._config()
        if before_digest != self.runtime_config_sha256:
            raise ValueError("Runtime preparation config changed before build")
        result = RuntimeImagePreparation(config, release, context["transaction"]).prepare()
        _, after_digest = self._config()
        if after_digest != before_digest:
            raise ValueError("Runtime preparation config changed during build")
        images = result.get("images") if isinstance(result, dict) else None
        image = images.get("backend") if isinstance(images, dict) else None
        if not isinstance(image, str) or not _DIGEST.fullmatch(image):
            raise ValueError("Runtime preparation returned no pinned backend image")
        return {"ok": True, "prepared_image": image,
                "release_sha256": release_digest(release),
                "runtime_config_sha256": self.runtime_config_sha256}

    def _delegate(self, context, release):
        _, current_digest = self._config()
        if current_digest != self.runtime_config_sha256:
            raise ValueError("Runtime preparation config changed")
        binding = context.get("prepared_migrator") if isinstance(context, dict) else None
        if (not isinstance(binding, dict)
                or set(binding) != {"prepared_image", "release_sha256", "runtime_config_sha256"}
                or not _DIGEST.fullmatch(binding.get("prepared_image", ""))
                or binding.get("release_sha256") != release_digest(release)
                or binding.get("runtime_config_sha256") != self.runtime_config_sha256):
            raise ValueError("Prepared migrator binding is missing or changed")
        return DockerPostgresMigrator(
            docker=self.docker, prepared_image=binding["prepared_image"],
            network=self.network, env_file=self.env_file, scope=self.scope,
            owner=self.owner, timeout=self.timeout)

    def __call__(self, context, release):
        return self._delegate(context, release)(context, release)

    def migration_idle(self, context, release):
        return self._delegate(context, release).migration_idle(context, release)
