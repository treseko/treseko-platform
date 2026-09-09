"""Fail-closed, read-only PostgreSQL migration probe for the updater."""

import json
import re
from collections.abc import Mapping

from .update_transaction import TransactionFailure


_VERSION_QUERY = "SELECT version_num FROM alembic_version LIMIT 2"
_MAX_OUTPUT = 64 * 1024
_REVISION = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}\Z")


def _valid_text(value, label):
    if type(value) is not str or not value or value != value.strip() or any(
        ord(character) < 32 or ord(character) == 127 for character in value
    ):
        raise ValueError(f"{label} must be a non-empty safe string")
    return value


class PostgresUpdateProbe:
    """Resolve the live Alembic revision to an explicit commercial version.

    ``snapshot`` is deliberately an adapter rather than a Docker configuration
    object.  Its identity checks and pinned ``_exec`` implementation remain the
    single authority for the authorized database container.
    """

    def __init__(self, snapshot, revision_versions: Mapping):
        if not callable(getattr(snapshot, "_check_target", None)) or not callable(
            getattr(snapshot, "_exec", None)
        ):
            raise TypeError("A DockerPostgresSnapshot-compatible adapter is required")
        if not isinstance(revision_versions, Mapping) or not revision_versions:
            raise ValueError("An explicit revision-to-version mapping is required")
        checked = {}
        for revision, version in revision_versions.items():
            _valid_text(revision, "Alembic revision")
            if not _REVISION.fullmatch(revision):
                raise ValueError("Alembic revision has an invalid format")
            checked[revision] = _valid_text(version, "commercial version")
        self.snapshot = snapshot
        self._revision_versions = checked

    def _read_revision(self):
        try:
            raw = self.snapshot._exec([
                "psql", "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1",
                "-U", self.snapshot.username, "-d", self.snapshot.database,
                "-c", _VERSION_QUERY,
            ])
        except Exception as exc:
            if isinstance(exc, TransactionFailure):
                raise
            raise TransactionFailure("PostgreSQL revision probe failed") from exc
        if not isinstance(raw, (bytes, bytearray)) or len(raw) > _MAX_OUTPUT:
            raise TransactionFailure("PostgreSQL revision output is malformed")
        try:
            text = bytes(raw).decode("utf-8")
        except UnicodeDecodeError as exc:
            raise TransactionFailure("PostgreSQL revision output is malformed") from exc
        rows = text.splitlines()
        if len(rows) != 1 or not _REVISION.fullmatch(rows[0]):
            raise TransactionFailure("PostgreSQL must expose exactly one known Alembic revision")
        return rows[0]

    def probe(self):
        self.snapshot._check_target()
        try:
            revision = self._read_revision()
        except BaseException as read_error:
            try:
                self.snapshot._check_target()
            except BaseException as identity_error:
                raise identity_error from read_error
            raise
        self.snapshot._check_target()
        version = self._revision_versions.get(revision)
        if version is None:
            raise TransactionFailure("PostgreSQL Alembic revision is unknown")
        result = {"revision": revision, "version": version}
        # Keep the callable contract JSON-shaped and bounded without exposing
        # adapter details, command output, credentials, or container metadata.
        if len(json.dumps(result, ensure_ascii=True, separators=(",", ":"))) > 1024:
            raise TransactionFailure("PostgreSQL probe result is malformed")
        return result

    __call__ = probe


DockerPostgresProbe = PostgresUpdateProbe
