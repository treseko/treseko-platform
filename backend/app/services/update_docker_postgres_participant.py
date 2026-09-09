"""Durable PostgreSQL participant for the coordinated update transaction.

This module is intentionally an adapter, not a controller or a command runner.
The operator supplies the already-authorized snapshot adapter and callbacks.
Nothing in a release or runtime request can select a command, database, or
credential.  The coordinator still owns global admission: ``activate`` only
records the local decision and never opens traffic.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import re

from .update_journal import exclusive_lock, save_json
from .update_transaction import TransactionFailure


OPERATIONS = {
    "prepare", "quiesce", "snapshot", "apply", "rollback", "start",
    "verify", "verify_rollback", "activate",
}
_IDENTIFIER = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}\Z")


class DockerPostgresParticipant:
    """Runtime callable implementing the PostgreSQL participant contract.

    Callback signatures are private and deliberately small:

    * ``fence(transaction) -> True`` closes database admission;
    * ``drain() -> True`` confirms writers are drained;
    * ``migrate(context, release) -> {"ok": True, ...}`` runs an idempotent
      migration attempt;
    * ``migration_idle(context, release) -> True`` proves the separate
      migrator is no longer running before recovery;
    * ``probe() -> {"version", "revision"}`` reads
      the live process/database state;
    * ``snapshot_adapter._check_target()``, ``._identity()``, ``.snapshot(path)``
      and ``.restore(path)`` operate on the pinned
      ``DockerPostgresSnapshot``-compatible adapter.

    A callback exception after it may have changed PostgreSQL leaves the
    operation pending.  Replaying the same operation calls the callback again;
    the participant never interprets a timeout/exception as proof that no
    migration or restore happened.
    """

    def __init__(self, snapshot_adapter, *, fence, drain, migrate, probe,
                 migration_idle, expected_revision: str, config_identity: str,
                 participant_id: str = "postgres", prepare_migration=None):
        if not all(hasattr(snapshot_adapter, name)
                   and callable(getattr(snapshot_adapter, name))
                   for name in ("_check_target", "_identity", "snapshot", "restore")):
            raise ValueError("A pinned snapshot adapter contract is required")
        if not all(callable(callback)
                   for callback in (fence, drain, migrate, probe, migration_idle)):
            raise ValueError("PostgreSQL callbacks are required")
        if prepare_migration is not None and not callable(prepare_migration):
            raise ValueError("Invalid migration preparation callback")
        if not isinstance(expected_revision, str) or not expected_revision:
            raise ValueError("Expected database revision must be explicit")
        if not isinstance(config_identity, str) or not config_identity:
            raise ValueError("A stable private PostgreSQL configuration identity is required")
        if not _IDENTIFIER.fullmatch(participant_id):
            raise ValueError("Invalid PostgreSQL participant identifier")
        self.snapshot_adapter = snapshot_adapter
        self.fence = fence
        self.drain = drain
        self.migrate = migrate
        self.probe = probe
        self.migration_idle = migration_idle
        self.expected_revision = expected_revision
        self.config_identity = config_identity
        self.participant_id = participant_id
        self.prepare_migration = prepare_migration

    def __call__(self, operation: str, context: dict, release: dict):
        transaction, directory = self._validate_request(operation, context, release)
        with exclusive_lock(directory / ".postgres-participant.lock"):
            journal = directory / "postgres.json"
            release_identity = self._release_identity(release)
            state = self._load_or_create(journal, transaction, release_identity, operation)
            self._validate_binding(state, transaction, release_identity)
            # Reconcile the authorized Docker target before any operation can
            # mutate PostgreSQL or its journaled snapshot state.
            self._validate_target_binding(state)
            return self._execute(operation, context, release, directory, journal, state)

    def _validate_request(self, operation, context, release):
        if operation not in OPERATIONS or not isinstance(context, dict) or not isinstance(release, dict):
            raise ValueError("Invalid PostgreSQL participant request")
        transaction = context.get("transaction")
        if not isinstance(transaction, str) or not _IDENTIFIER.fullmatch(transaction):
            raise ValueError("Invalid transaction binding")
        raw_directory = context.get("directory")
        if not isinstance(raw_directory, str):
            raise ValueError("A private participant directory is required")
        directory = Path(raw_directory)
        if (not directory.is_absolute() or len(directory.parts) < 3
                or ".." in directory.parts):
            raise ValueError("A dedicated absolute participant directory is required")
        if not isinstance(release.get("version"), str) or not release["version"]:
            raise ValueError("Commercial release version is required")
        checksum = release.get("checksum_sha256")
        if (not isinstance(checksum, str) or len(checksum) != 64
                or any(char not in "0123456789abcdef" for char in checksum)):
            raise ValueError("Verified artifact checksum is required")
        return transaction, directory

    @staticmethod
    def _release_identity(release):
        return hashlib.sha256(json.dumps(release, sort_keys=True).encode()).hexdigest()

    def _load_or_create(self, journal, transaction, release_identity, operation):
        if journal.exists():
            try:
                state = json.loads(journal.read_text())
            except (OSError, ValueError) as exc:
                raise TransactionFailure("Invalid PostgreSQL participant journal") from exc
            if not isinstance(state, dict):
                raise TransactionFailure("Invalid PostgreSQL participant journal")
            return state
        if operation != "prepare":
            raise TransactionFailure("PostgreSQL participant must prepare first")
        state = {
            "schema": 1,
            "participant": self.participant_id,
            "transaction": transaction,
            "release_identity": release_identity,
            "config_identity": self.config_identity,
            "expected_revision": self.expected_revision,
            "target_identity": self._target_identity_after_check(),
            "phase": None,
            "pending": None,
            "receipts": {},
            "apply_attempted": False,
            "restored": False,
            "activated": False,
        }
        save_json(journal, state)
        return state

    def _validate_binding(self, state, transaction, release_identity):
        if (state.get("schema") != 1 or state.get("participant") != self.participant_id
                or state.get("transaction") != transaction
                or state.get("release_identity") != release_identity
                or state.get("config_identity") != self.config_identity
                or state.get("expected_revision") != self.expected_revision):
            raise TransactionFailure("PostgreSQL participant binding changed")

    def _execute(self, operation, context, release, directory, journal, state):
        receipts = state["receipts"]
        if operation in {"activate"} and operation in receipts:
            return receipts[operation]
        if state.get("activated") and operation not in {"activate"}:
            raise TransactionFailure("Cannot mutate or restore after activation")

        phase = state.get("phase")
        if operation == "prepare":
            self._check_target(state)
            if "prepare" not in receipts:
                if self.prepare_migration is not None and "migration_binding" not in state:
                    state["pending"] = "prepare_migration"
                    save_json(journal, state)
                    binding = self.prepare_migration(self._context(context, directory, state), release)
                    state["migration_binding"] = self._validate_migration_binding(binding)
                    state["pending"] = None
                    save_json(journal, state)
                current = self._probe()
                state.update(previous_version=current["version"],
                             previous_revision=current["revision"])
                result = {"ok": True, "previous_version": current["version"],
                          "previous_revision": current["revision"]}
                self._complete(state, journal, operation, result)
            return receipts["prepare"]

        if "prepare" not in receipts:
            raise TransactionFailure("PostgreSQL participant has no preparation receipt")
        if operation == "quiesce":
            state["pending"] = "quiesce"
            save_json(journal, state)
            self._require_closed(context, state["transaction"])
            if state.get("apply_attempted"):
                self._require_migration_idle(context, release, state)
            self._complete(state, journal, operation, {"ok": True})
        elif operation == "snapshot":
            if phase not in {"quiesce", "snapshot", "apply", "start", "verify", "rollback", "verify_rollback"}:
                raise TransactionFailure("Snapshot requires quiesce")
            self._check_target(state)
            self._require_closed(context, state["transaction"])
            if "snapshot" not in receipts:
                result = self.snapshot_adapter.snapshot(directory / "snapshot")
                if not isinstance(result, dict):
                    raise TransactionFailure("Snapshot adapter returned an invalid receipt")
                self._complete(state, journal, operation, {"ok": True, "snapshot": result})
            return receipts["snapshot"]
        elif operation == "apply":
            if phase not in {"snapshot", "apply"} or "snapshot" not in receipts:
                raise TransactionFailure("Apply requires an immutable snapshot")
            self._check_target(state)
            state["pending"] = "apply"
            save_json(journal, state)
            self._require_closed(context, state["transaction"])
            state["apply_attempted"] = True
            save_json(journal, state)
            try:
                result = self.migrate(self._context(context, directory, state), release)
                self._require_ok(result, "Migration callback failed")
            except Exception as exc:
                # Keep pending/apply_attempted: the outcome may already exist in DB.
                raise TransactionFailure("Migration outcome is uncertain; replay apply") from exc
            self._complete(state, journal, operation, result)
        elif operation == "rollback":
            if not state.get("apply_attempted"):
                self._complete(state, journal, operation, {"ok": True, "restored": False})
            elif state.get("restored"):
                # Recovery may re-enter after another participant lost its
                # acknowledgement.  The restore is already complete, but the
                # local phase must still advance so start/verify_rollback can
                # replay safely.
                result = receipts.get("rollback", {"ok": True, "restored": True})
                self._complete(state, journal, operation, result)
                return receipts[operation]
            else:
                self._check_target(state)
                state.update(pending="rollback")
                save_json(journal, state)
                self._require_closed(context, state["transaction"])
                self._require_migration_idle(context, release, state)
                save_json(journal, state)
                try:
                    result = self.snapshot_adapter.restore(directory / "snapshot")
                    self._require_ok(result, "Snapshot restore failed")
                except Exception as exc:
                    raise TransactionFailure("Restore outcome is uncertain; replay rollback") from exc
                state["restored"] = True
                self._complete(state, journal, operation, {"ok": True, "restored": True, **result})
        elif operation == "start":
            if phase not in {"apply", "rollback", "start"}:
                raise TransactionFailure("Start is out of order")
            self._complete(state, journal, operation, {"ok": True})
        elif operation in {"verify", "verify_rollback"}:
            expected_phase = {"verify": {"start", "verify"},
                              "verify_rollback": {"start", "verify_rollback"}}[operation]
            if phase not in expected_phase:
                raise TransactionFailure("Verification is out of order")
            self._require_closed(context, state["transaction"])
            expected_version = (release["version"] if operation == "verify"
                                else state["previous_version"])
            expected_revision = (self.expected_revision if operation == "verify"
                                 else state["previous_revision"])
            current = self._probe()
            if (current["version"] != expected_version
                    or current["revision"] != expected_revision):
                raise TransactionFailure("Live PostgreSQL version or revision mismatch")
            self._complete(state, journal, operation,
                           {"ok": True, "version": expected_version,
                            "revision": expected_revision,
                            "transaction": state["transaction"]})
        elif operation == "activate":
            if phase not in {"verify", "verify_rollback", "activate"}:
                raise TransactionFailure("Activation requires live verification")
            state["activated"] = True
            self._complete(state, journal, operation, {"ok": True, "activated": True})
        else:
            raise ValueError("Unknown PostgreSQL participant operation")
        return receipts[operation]

    def _context(self, context, directory, state):
        result = {**context, "directory": str(directory), "participant": self.participant_id,
                "previous_revision": state.get("previous_revision"),
                "expected_revision": self.expected_revision}
        if "migration_binding" in state:
            result["prepared_migrator"] = dict(state["migration_binding"])
        return result

    @staticmethod
    def _validate_migration_binding(binding):
        if (not isinstance(binding, dict)
                or set(binding) != {"ok", "prepared_image", "release_sha256",
                                     "runtime_config_sha256"}
                or binding.get("ok") is not True
                or not isinstance(binding["prepared_image"], str)
                or not re.fullmatch(r"sha256:[a-f0-9]{64}", binding["prepared_image"])
                or not re.fullmatch(r"[a-f0-9]{64}", binding["release_sha256"])
                or not re.fullmatch(r"[a-f0-9]{64}", binding["runtime_config_sha256"])):
            raise TransactionFailure("Invalid prepared migrator receipt")
        return {key: binding[key] for key in ("prepared_image", "release_sha256",
                                               "runtime_config_sha256")}

    def _target_identity_after_check(self):
        identity = self.snapshot_adapter._identity()
        try:
            json.dumps(identity, sort_keys=True)
        except (TypeError, ValueError) as exc:
            raise TransactionFailure("Snapshot adapter identity is not journalable") from exc
        return identity

    def _check_target(self, state):
        self.snapshot_adapter._check_target()
        if self._target_identity_after_check() != state.get("target_identity"):
            raise TransactionFailure("PostgreSQL snapshot target identity changed")

    def _validate_target_binding(self, state):
        self.snapshot_adapter._check_target()
        if self._target_identity_after_check() != state.get("target_identity"):
            raise TransactionFailure("PostgreSQL snapshot target identity changed")

    def _require_closed(self, context, transaction):
        if self.fence(transaction) is not True or self.drain() is not True:
            raise TransactionFailure("PostgreSQL writers are not fenced and drained")

    def _probe(self):
        result = self.probe()
        if (not isinstance(result, dict) or not isinstance(result.get("version"), str)
                or not result["version"] or not isinstance(result.get("revision"), str)
                or not result["revision"]):
            raise TransactionFailure("Live PostgreSQL probe lacks version or database revision")
        return result

    def _require_migration_idle(self, context, release, state):
        try:
            idle = self.migration_idle(self._context(context, Path(context["directory"]), state), release)
        except Exception as exc:
            raise TransactionFailure("Migrator is not confirmed idle") from exc
        if idle is not True:
            raise TransactionFailure("Migrator is not confirmed idle")

    @staticmethod
    def _require_ok(result, message):
        if not isinstance(result, dict) or result.get("ok") is not True:
            raise TransactionFailure(message)

    @staticmethod
    def _complete(state, journal, operation, result):
        receipt = {key: value for key, value in result.items()
                   if key in {"ok", "previous_version", "previous_revision", "version",
                              "revision", "transaction", "snapshot", "restored",
                              "activated"}}
        state["receipts"][operation] = receipt
        state.update(phase=operation, pending=None)
        save_json(journal, state)
