"""Private identity material for the Docker PostgreSQL migrator.

This module reads operator-owned env files and inspects the prepared image
only when a migration operation is being reconciled.  Secret values are kept
in the transient identity and only their hashes enter the journal.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import stat

from .update_transaction import TransactionFailure


_ENV_KEY = re.compile(r"[A-Za-z_][A-Za-z0-9_]*\Z")
_MAX_ENV_FILE_BYTES = 1024 * 1024


def read_env(path_value):
    path = Path(path_value)
    if not path.is_absolute() or ".." in path.parts:
        raise ValueError("A private absolute env-file is required")
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except OSError as exc:
        raise ValueError("A private regular env-file is required") from exc
    with os.fdopen(descriptor, "rb") as stream:
        metadata = os.fstat(stream.fileno())
        if (not stat.S_ISREG(metadata.st_mode)
                or metadata.st_uid not in {0, os.geteuid()}
                or metadata.st_mode & 0o077
                or metadata.st_size > _MAX_ENV_FILE_BYTES):
            raise ValueError("The migration env-file must be operator-owned and private")
        raw = stream.read(_MAX_ENV_FILE_BYTES + 1)
    if len(raw) > _MAX_ENV_FILE_BYTES:
        raise ValueError("The migration env-file is too large")
    values = {}
    for line in raw.decode("utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if "=" not in line:
            raise ValueError("The migration env-file contains an invalid entry")
        key, value = line.split("=", 1)
        if not _ENV_KEY.fullmatch(key) or key in values:
            raise ValueError("The migration env-file contains an invalid or duplicate key")
        values[key] = value
    return raw, values


def image_baseline(migrator):
    result = migrator._run(["image", "inspect", migrator.prepared_image])
    if result.returncode:
        raise TransactionFailure("Prepared migrator image inspection failed")
    try:
        records = json.loads(result.stdout)
    except (TypeError, ValueError, json.JSONDecodeError) as exc:
        raise TransactionFailure("Prepared migrator image inspection is invalid") from exc
    if not isinstance(records, list) or len(records) != 1 or not isinstance(records[0], dict):
        raise TransactionFailure("Prepared migrator image identity is ambiguous")
    record = records[0]
    image_id = record.get("Id")
    if image_id != migrator.prepared_image:
        raise TransactionFailure("Prepared migrator image ID does not match its pinned digest")
    config = record.get("Config") or {}
    baseline = {}
    for entry in config.get("Env") or []:
        if not isinstance(entry, str) or "=" not in entry:
            raise TransactionFailure("Prepared migrator image environment is malformed")
        key, value = entry.split("=", 1)
        if not _ENV_KEY.fullmatch(key) or key in baseline:
            raise TransactionFailure("Prepared migrator image environment has duplicate keys")
        baseline[key] = value
    image_labels = config.get("Labels") or {}
    if not isinstance(image_labels, dict) or any(
            not isinstance(key, str) or not key or not isinstance(value, str)
            for key, value in image_labels.items()):
        raise TransactionFailure("Prepared migrator image labels are malformed")
    return image_id, baseline, dict(image_labels)


def env_digest(migrator):
    raw, values = read_env(migrator.env_file)
    return hashlib.sha256(raw).hexdigest(), values


def release_digest(release):
    if not isinstance(release, dict):
        raise ValueError("A release dictionary is required")
    try:
        encoded = json.dumps(release, sort_keys=True, separators=(",", ":"),
                             ensure_ascii=True).encode()
    except (TypeError, ValueError) as exc:
        raise ValueError("Release must be JSON-serializable") from exc
    return hashlib.sha256(encoded).hexdigest()


def build_identity(migrator, context, release):
    transaction = context["transaction"]
    env_file_digest, env_values = migrator._env_digest()
    image_id, baseline, image_labels = migrator._image_baseline()
    expected_env = {**baseline, **env_values}
    effective_env_digest = hashlib.sha256(
        json.dumps(sorted(expected_env.items()), separators=(",", ":")).encode()
    ).hexdigest()
    baseline_digest = hashlib.sha256(
        json.dumps(sorted(baseline.items()), separators=(",", ":")).encode()
    ).hexdigest()
    labels = {
        "io.treseko.migration.scope": migrator.scope,
        "io.treseko.migration.owner": migrator.owner,
        "io.treseko.migration.transaction": transaction,
    }
    expected_labels = {**image_labels, **labels}
    image_labels_digest = hashlib.sha256(
        json.dumps(sorted(image_labels.items()), separators=(",", ":")).encode()
    ).hexdigest()
    release_sha256 = migrator._release_digest(release)
    name = "treseko-pg-migrate-" + hashlib.sha256(
        json.dumps([migrator.scope, migrator.owner, transaction],
                   separators=(",", ":")).encode()
    ).hexdigest()[:32]
    configuration = {
        "image": migrator.prepared_image, "image_id": image_id,
        "image_env_sha256": baseline_digest, "network": migrator.network,
        "env_file_sha256": env_file_digest, "effective_env_sha256": effective_env_digest,
        "entrypoint": ["/app/entrypoint.sh"], "command": ["migrate-only"],
        "labels": expected_labels, "reserved_labels": labels,
        "image_labels_sha256": image_labels_digest, "name": name,
        "release_sha256": release_sha256,
    }
    digest = hashlib.sha256(json.dumps(configuration, sort_keys=True,
                                       separators=(",", ":")).encode()).hexdigest()
    return {**configuration, "configuration_digest": digest, "_expected_env": expected_env}
