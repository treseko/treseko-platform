"""Private factory for the Docker PostgreSQL update participant.

The factory only validates and binds operator-owned resources.  Docker,
PostgreSQL, snapshots and migrations are invoked later by the participant
callbacks; no release field can select any command, target or credential.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import re

from .update_docker_migrator import DockerPostgresMigrator
from .update_docker_postgres import DockerPostgresSnapshot
from .update_docker_postgres_participant import DockerPostgresParticipant
from .update_prepared_migrator import PreparedPostgresMigrator
from .update_participant_commands import CommandRuntime, RUNTIME_OPERATIONS, load_private_json
from .update_postgres_probe import PostgresUpdateProbe


_IDENTIFIER = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}\Z")
_REVISION = _IDENTIFIER
_DIGEST = re.compile(r"sha256:[a-f0-9]{64}\Z")
_REQUIRED = {"type", "docker", "target", "expected_revision", "revision_versions",
             "migrator", "checks"}
_TARGET_FIELDS = {"container", "project", "service", "database", "username"}
_MIGRATOR_COMMON_FIELDS = {"network", "env_file", "scope", "owner"}
_CHECK_FIELDS = {"fence", "drain"}


def _safe_string(value, label, pattern=None):
    if type(value) is not str or not value or value != value.strip():
        raise ValueError(f"{label} must be a non-empty safe string")
    if any(ord(character) < 32 or ord(character) == 127 for character in value):
        raise ValueError(f"{label} contains control characters")
    if pattern is not None and not pattern.fullmatch(value):
        raise ValueError(f"Invalid {label}")
    return value


def _private_env_hash(path_value):
    path = Path(_safe_string(path_value, "Migration env-file"))
    if not path.is_absolute() or path.is_symlink() or not path.is_file():
        raise ValueError("A private regular migration env-file is required")
    if path.stat().st_mode & 0o077:
        raise ValueError("The migration env-file must not be readable by others")
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _validate_argv(value, label):
    if (not isinstance(value, list) or not value
            or not all(isinstance(argument, str) and argument and "\0" not in argument
                       for argument in value)
            or not Path(value[0]).is_absolute()):
        raise ValueError(f"{label} must be an absolute private argv")
    return list(value)


def _validate_config(config):
    if (not isinstance(config, dict) or set(config) != _REQUIRED
            or config.get("type") != "docker-postgres"):
        raise ValueError("Invalid private Docker PostgreSQL driver configuration")
    docker = _safe_string(config["docker"], "Docker executable")
    if not Path(docker).is_absolute() or not Path(docker).is_file():
        raise ValueError("An absolute Docker executable is required")

    target = config["target"]
    if not isinstance(target, dict) or set(target) != _TARGET_FIELDS:
        raise ValueError("Invalid pinned PostgreSQL target configuration")
    _safe_string(target["container"], "Pinned PostgreSQL container",
                 re.compile(r"[a-f0-9]{64}\Z"))
    for field in ("project", "service", "database", "username"):
        _safe_string(target[field], field, _IDENTIFIER)
    if target["database"] in {"postgres", "template0", "template1"}:
        raise ValueError("An application PostgreSQL database is required")

    expected_revision = _safe_string(config["expected_revision"], "Expected revision", _REVISION)
    revision_versions = config["revision_versions"]
    if not isinstance(revision_versions, dict) or not revision_versions:
        raise ValueError("An explicit revision-to-version mapping is required")
    for revision, version in revision_versions.items():
        _safe_string(revision, "Alembic revision", _REVISION)
        _safe_string(version, "Commercial version", _IDENTIFIER)
    if expected_revision not in revision_versions:
        raise ValueError("Expected revision must be present in revision_versions")
    migrator = config["migrator"]
    if not isinstance(migrator, dict) or not (
            set(migrator) == _MIGRATOR_COMMON_FIELDS | {"prepared_image"}
            or set(migrator) == _MIGRATOR_COMMON_FIELDS | {"runtime_preparation_config"}):
        raise ValueError("Invalid private PostgreSQL migrator configuration")
    runtime_config_sha256 = None
    if "prepared_image" in migrator:
        # Image preparation/build remains a separate global release step.
        if not _DIGEST.fullmatch(_safe_string(migrator["prepared_image"], "Prepared migrator image")):
            raise ValueError("A pinned prepared migrator image digest is required")
    else:
        path = Path(_safe_string(migrator["runtime_preparation_config"],
                                 "Runtime preparation config"))
        if not path.is_absolute() or path.is_symlink() or not path.is_file():
            raise ValueError("A trusted runtime preparation config is required")
        runtime_config_sha256 = hashlib.sha256(path.read_bytes()).hexdigest()
        runtime_config = load_private_json(path)
        if "backend" not in (runtime_config.get("components") or []):
            raise ValueError("Runtime preparation must declare the backend component")
    for field in ("network", "scope", "owner"):
        _safe_string(migrator[field], field, _IDENTIFIER)
    env_hash = _private_env_hash(migrator["env_file"])

    checks = config["checks"]
    if not isinstance(checks, dict) or set(checks) != _CHECK_FIELDS:
        raise ValueError("PostgreSQL checks must define only fence and drain")
    checked_commands = {name: _validate_argv(checks[name], f"{name} check")
                        for name in _CHECK_FIELDS}
    return (docker, target, expected_revision, revision_versions, migrator,
            checked_commands, env_hash, runtime_config_sha256)


def _configuration_identity(config, env_hash, checked_commands):
    runner_binding = {
        "checks": {name: checked_commands[name] for name in sorted(checked_commands)},
        "command_runtime_operations": sorted(RUNTIME_OPERATIONS),
    }
    material = {"config": config, "env_file_sha256": env_hash,
                "runner_binding": runner_binding}
    encoded = json.dumps(material, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()
    return hashlib.sha256(encoded).hexdigest()


def create_driver(config, context, release):
    """Build a PostgreSQL participant without contacting Docker or PostgreSQL."""
    docker, target, expected_revision, revision_versions, migrator_config, checks, env_hash, runtime_config_sha256 = (
        _validate_config(config)
    )
    if release:
        if (not isinstance(release, dict)
                or release.get("version") != revision_versions[expected_revision]):
            raise ValueError("Release version does not match expected PostgreSQL revision")
    participant_id = context.get("participant", "postgres") if isinstance(context, dict) else "postgres"
    if not isinstance(participant_id, str) or not _IDENTIFIER.fullmatch(participant_id):
        raise ValueError("Invalid PostgreSQL participant identifier")

    snapshot = DockerPostgresSnapshot(docker=docker, **target)
    probe = PostgresUpdateProbe(snapshot, revision_versions)
    if "runtime_preparation_config" in migrator_config:
        migrator = PreparedPostgresMigrator(docker=docker, **migrator_config)
        prepare_migration = migrator.prepare
    else:
        migrator = DockerPostgresMigrator(docker=docker, **migrator_config)
        prepare_migration = None
    identity = _configuration_identity(config, env_hash, checks)
    if runtime_config_sha256:
        identity = hashlib.sha256((identity + runtime_config_sha256).encode()).hexdigest()

    def safe_release(release_value):
        if not isinstance(release_value, dict):
            return {}
        return {key: release_value[key] for key in ("version", "checksum_sha256")
                if key in release_value}

    def check_runner(name, operation_context, release_value):
        runner = CommandRuntime(
            {operation: checks[name] for operation in RUNTIME_OPERATIONS}
        )
        command_context = {
            "transaction": operation_context.get("transaction"),
            "participant": participant_id,
            "component": "postgres",
            "check": name,
        }
        result = runner("quiesce", command_context, safe_release(release_value))
        return isinstance(result, dict) and result.get("ok") is True

    return DockerPostgresParticipant(
        snapshot,
        fence=lambda transaction: check_runner("fence", {"transaction": transaction}, {}),
        drain=lambda: check_runner("drain", {"transaction": "drain-check"}, {}),
        migrate=migrator,
        probe=probe,
        migration_idle=migrator.migration_idle,
        prepare_migration=prepare_migration,
        expected_revision=expected_revision,
        config_identity=identity,
        participant_id=participant_id,
    )
