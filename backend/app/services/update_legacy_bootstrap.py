"""Admission evidence for legacy installations, without runtime orchestration.

The existing update transaction owns snapshot, migration, apply, verify and
rollback. This module only binds consent to one inventory and provides a
fail-closed fence/pending-observation boundary.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import stat
from pathlib import Path
from typing import Any, Mapping, Protocol, Sequence

from .edition.update_manager import verify_update_manifest_signature
from .update_journal import exclusive_lock, save_json
from .update_transaction import TransactionFailure
from .update_transport import IDENTIFIER

SCHEMA = 1
ACK_PREFIX = "TRESEKO_LEGACY_MAINTENANCE_ACK:"
HEX64 = re.compile(r"[0-9a-f]{64}\Z")


class LegacyBootstrapError(TransactionFailure):
    """Legacy admission cannot safely advance without operator action."""


class Fence(Protocol):
    scope: Sequence[str]
    def acquire(self, transaction: str) -> Any: ...
    def assert_closed(self, transaction: str) -> Any: ...


class PendingObserver(Protocol):
    def observe(self, transaction: str) -> Mapping[str, Any]: ...


def _canonical(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()


def _validate_binding(transaction: str, inventory_digest: str, source_ids: Sequence[str]) -> None:
    if not isinstance(transaction, str) or not IDENTIFIER.fullmatch(transaction):
        raise LegacyBootstrapError("Invalid legacy transaction")
    if not isinstance(inventory_digest, str) or not HEX64.fullmatch(inventory_digest):
        raise LegacyBootstrapError("Invalid inventory digest")
    if (not isinstance(source_ids, Sequence) or isinstance(source_ids, (str, bytes))
            or not source_ids or len(set(source_ids)) != len(source_ids)
            or not all(isinstance(item, str) and IDENTIFIER.fullmatch(item) for item in source_ids)):
        raise LegacyBootstrapError("Explicit unique source IDs are required")


def consent_for(transaction: str, inventory_digest: str, source_ids: Sequence[str]) -> str:
    _validate_binding(transaction, inventory_digest, source_ids)
    binding = {"transaction": transaction, "inventory_digest": inventory_digest,
               "source_ids": list(source_ids)}
    return ACK_PREFIX + hashlib.sha256(_canonical(binding)).hexdigest()


def _manifest(manifest: Mapping[str, Any]) -> dict[str, Any]:
    if not isinstance(manifest, Mapping):
        raise LegacyBootstrapError("Signed manifest object is required")
    valid, error = verify_update_manifest_signature(dict(manifest))
    if not valid:
        raise LegacyBootstrapError(error or "Release signature is invalid")
    version = manifest.get("version")
    if not isinstance(version, str) or not re.fullmatch(r"\d+\.\d+\.\d+", version):
        raise LegacyBootstrapError("Manifest version is invalid")
    return dict(manifest)


def _safe_directory(value: Any) -> Path:
    directory = Path(value) if isinstance(value, str) else value
    if (not isinstance(directory, Path) or not directory.is_absolute()
            or ".." in directory.parts or len(directory.parts) < 3):
        raise LegacyBootstrapError("Dedicated absolute legacy state directory is required")
    for ancestor in (directory, *directory.parents):
        try:
            info = ancestor.lstat()
        except FileNotFoundError:
            continue
        if stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode):
            raise LegacyBootstrapError("Legacy state path cannot contain symlinks or files")
        if ancestor == directory:
            if info.st_uid not in {0, os.geteuid()} or info.st_mode & 0o022:
                raise LegacyBootstrapError("Legacy state directory is not private")
            break
    return directory


def _read(path: Path) -> dict[str, Any] | None:
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except FileNotFoundError:
        return None
    try:
        info = os.fstat(descriptor)
        if (not stat.S_ISREG(info.st_mode) or info.st_uid not in {0, os.geteuid()}
                or info.st_mode & 0o077 or info.st_size > 1024 * 1024):
            raise LegacyBootstrapError("Unsafe legacy journal")
        with os.fdopen(descriptor, "rb") as stream:
            descriptor = -1
            try:
                value = json.load(stream)
            except (OSError, ValueError, RecursionError) as exc:
                raise LegacyBootstrapError("Invalid legacy journal") from exc
    finally:
        if descriptor >= 0:
            os.close(descriptor)
    if not isinstance(value, dict) or value.get("schema") != SCHEMA:
        raise LegacyBootstrapError("Invalid legacy journal")
    return value


def _binding(transaction: str, inventory_digest: str, source_ids: Sequence[str], manifest: Mapping[str, Any]) -> dict[str, Any]:
    _validate_binding(transaction, inventory_digest, source_ids)
    return {"transaction": transaction, "inventory_digest": inventory_digest,
            "source_ids": list(source_ids), "release_digest": hashlib.sha256(_canonical(manifest)).hexdigest()}


class LegacyBootstrap:
    """Gate adapter consumed by a separately-owned update transaction."""

    def __init__(self, config: Mapping[str, Any], *, fence: Fence | None = None,
                 pending_observer: PendingObserver | None = None):
        if (not isinstance(config, Mapping) or set(config) - {"schema", "state_dir"}
                or config.get("schema") != SCHEMA):
            raise ValueError("Schema 1 legacy bootstrap configuration is required")
        self.state_dir = _safe_directory(config.get("state_dir"))
        self.fence, self.pending_observer = fence, pending_observer

    def plan(self, manifest: Mapping[str, Any], transaction: str, inventory_digest: str,
             source_ids: Sequence[str]) -> dict[str, Any]:
        release = _manifest(manifest)
        binding = _binding(transaction, inventory_digest, source_ids, release)
        return {"schema": SCHEMA, "status": "plan_validated", "transaction": transaction,
                "version": release["version"], "binding": binding, "runtime_mutated": False}

    def prepare(self, manifest: Mapping[str, Any], transaction: str, inventory_digest: str,
                source_ids: Sequence[str]) -> dict[str, Any]:
        release = _manifest(manifest)
        binding = _binding(transaction, inventory_digest, source_ids, release)
        path = self._path(transaction)
        self.state_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        _safe_directory(self.state_dir)
        with exclusive_lock(self.state_dir / ".legacy.lock"):
            state = _read(path)
            if state is not None and state.get("binding") != binding:
                raise LegacyBootstrapError("Legacy journal binding changed")
            if state is not None and state.get("phase") not in {"prepared", "consent_recorded", "admitted", "released"}:
                raise LegacyBootstrapError("Legacy journal is not resumable")
            if state is None:
                state = {"schema": SCHEMA, "binding": binding, "phase": "prepared",
                         "consent": None, "evidence": None}
                save_json(path, state)
            return self._safe(state)

    def record_consent(self, manifest: Mapping[str, Any], transaction: str, inventory_digest: str,
                       source_ids: Sequence[str], *, consent: str, evidence: Mapping[str, Any]) -> dict[str, Any]:
        release = _manifest(manifest)
        if consent != consent_for(transaction, inventory_digest, source_ids):
            raise LegacyBootstrapError("Consent does not match transaction inventory")
        self._validate_evidence(evidence, transaction, inventory_digest, source_ids)
        path = self._path(transaction)
        with exclusive_lock(self.state_dir / ".legacy.lock"):
            state = _read(path)
            binding = _binding(transaction, inventory_digest, source_ids, release)
            if state is None or state.get("binding") != binding or state.get("phase") not in {"prepared", "consent_recorded", "admitted"}:
                raise LegacyBootstrapError("Prepared legacy transaction is required")
            if state.get("phase") == "admitted":
                recorded = {"type": "operator_confirmed", "transaction": transaction,
                            "inventory_digest": inventory_digest, "source_ids": list(source_ids)}
                if state.get("consent") != consent or state.get("evidence") != recorded:
                    raise LegacyBootstrapError("Admitted legacy consent cannot be replaced")
                return self._safe(state)
            state.update(phase="consent_recorded", consent=consent,
                         evidence={"type": "operator_confirmed", "transaction": transaction,
                                   "inventory_digest": inventory_digest, "source_ids": list(source_ids)})
            save_json(path, state)
            return self._safe(state)

    def preflight(self, manifest: Mapping[str, Any], transaction: str, inventory_digest: str,
                  source_ids: Sequence[str], *, consent: str, evidence: Mapping[str, Any]) -> dict[str, Any]:
        release = _manifest(manifest)
        if consent != consent_for(transaction, inventory_digest, source_ids):
            raise LegacyBootstrapError("Consent does not match transaction inventory")
        self._validate_evidence(evidence, transaction, inventory_digest, source_ids)
        if self.fence is None or self.pending_observer is None:
            raise LegacyBootstrapError("Explicit fence and pending observer adapters are required")
        path = self._path(transaction)
        with exclusive_lock(self.state_dir / ".legacy.lock"):
            state = _read(path)
            binding = _binding(transaction, inventory_digest, source_ids, release)
            if (state is None or state.get("binding") != binding
                    or state.get("phase") not in {"consent_recorded", "admitted"}
                    or state.get("consent") != consent or state.get("evidence") != {
                        "type": "operator_confirmed", "transaction": transaction,
                        "inventory_digest": inventory_digest, "source_ids": list(source_ids)}):
                raise LegacyBootstrapError("Recorded legacy consent is required")
            self._assert_scope()
            if state.get("phase") == "admitted":
                self.fence.assert_closed(transaction)
            else:
                self.fence.acquire(transaction)
                self.fence.assert_closed(transaction)
            pending = dict(self.pending_observer.observe(transaction))
            if not self._pending_safe(pending):
                state.update(phase="consent_recorded", error="precondition_failed")
                save_json(path, state)
                raise LegacyBootstrapError("Pending SQL or admission control is not proven")
            state.update(phase="admitted", pending=pending)
            save_json(path, state)
            return self._safe(state)

    def release(self, transaction: str) -> dict[str, Any]:
        path = self._path(transaction)
        with exclusive_lock(self.state_dir / ".legacy.lock"):
            state = _read(path)
            if state is None or state.get("phase") not in {"admitted", "released"}:
                raise LegacyBootstrapError("An admitted legacy fence is required")
            if state.get("phase") == "released":
                return self._safe(state) | {"replayed": True}
            if self.fence is None or not callable(getattr(self.fence, "release", None)):
                raise LegacyBootstrapError("Fence release adapter is required")
            self.fence.release(transaction)
            state["phase"] = "released"
            save_json(path, state)
            return self._safe(state)

    def status(self, transaction: str) -> dict[str, Any]:
        if not isinstance(transaction, str) or not IDENTIFIER.fullmatch(transaction):
            raise LegacyBootstrapError("Invalid legacy transaction")
        state = _read(self._path(transaction))
        return self._safe(state) if state else {"schema": SCHEMA, "status": "absent", "transaction": transaction}

    def _assert_scope(self) -> None:
        scope = getattr(self.fence, "scope", ())
        if (not isinstance(scope, Sequence) or isinstance(scope, (str, bytes))
                or not {"claims", "crud", "callbacks"} <= set(scope)):
            raise LegacyBootstrapError("External fence scope must cover claims, CRUD, and callbacks")

    @staticmethod
    def _pending_safe(value: Mapping[str, Any]) -> bool:
        if value.get("source") == "sql":
            return (value.get("observed") is True and value.get("admission_controlled") is True
                    and type(value.get("pending")) is int and value["pending"] == 0)
        return (value.get("source") == "operator_maintenance" and value.get("evidence") == "operator_confirmed"
                and value.get("admission_controlled") is True)

    @staticmethod
    def _validate_evidence(evidence: Mapping[str, Any], transaction: str,
                           inventory_digest: str, source_ids: Sequence[str]) -> None:
        if (not isinstance(evidence, Mapping) or evidence.get("type") != "operator_confirmed"
                or evidence.get("transaction") != transaction
                or evidence.get("inventory_digest") != inventory_digest
                or evidence.get("source_ids") != list(source_ids)):
            raise LegacyBootstrapError("Separate operator confirmation evidence is required")

    def _path(self, transaction: str) -> Path:
        if not isinstance(transaction, str) or not IDENTIFIER.fullmatch(transaction):
            raise LegacyBootstrapError("Invalid legacy transaction")
        return self.state_dir / (transaction + ".json")

    @staticmethod
    def _safe(state: Mapping[str, Any]) -> dict[str, Any]:
        return {key: state[key] for key in ("schema", "phase", "binding", "consent", "evidence", "pending", "error") if key in state} | {"status": state.get("phase")}


class LegacyAdmissionGate:
    """UpdateTransaction gate backed by one fixed, private legacy binding.

    ``scope`` describes route coverage only. It is never merged into the
    participant inventory, whose names remain owned by UpdateTransaction.
    """

    route_scope = frozenset({"claims", "crud", "callbacks"})

    def __init__(self, bootstrap: LegacyBootstrap, manifest: Mapping[str, Any],
                 transaction: str, inventory_digest: str, source_ids: Sequence[str],
                 consent: str, evidence: Mapping[str, Any]):
        self.bootstrap = bootstrap
        self.manifest = dict(manifest)
        self.transaction = transaction
        self.inventory_digest = inventory_digest
        self.source_ids = list(source_ids)
        self.consent = consent
        self.evidence = dict(evidence)
        _binding(transaction, inventory_digest, source_ids, self.manifest)
        if consent != consent_for(transaction, inventory_digest, source_ids):
            raise LegacyBootstrapError("Consent does not match transaction inventory")
        LegacyBootstrap._validate_evidence(evidence, transaction, inventory_digest, source_ids)

    def _check(self, transaction: str) -> None:
        if transaction != self.transaction:
            raise LegacyBootstrapError("Gate transaction differs from fixed consent binding")

    def acquire(self, transaction: str) -> Any:
        self._check(transaction)
        return self.bootstrap.preflight(self.manifest, transaction, self.inventory_digest,
                                        self.source_ids, consent=self.consent, evidence=self.evidence)

    def assert_closed(self, transaction: str) -> Any:
        self._check(transaction)
        return self.bootstrap.preflight(self.manifest, transaction, self.inventory_digest,
                                        self.source_ids, consent=self.consent, evidence=self.evidence)

    def release(self, transaction: str) -> Any:
        self._check(transaction)
        return self.bootstrap.release(transaction)
