"""Host-side durable participant. Runtime adapters are installed by the operator.

The runtime callable implements (operation, context, signed_release) -> receipt.
It must pin backups idempotently inside context['directory'], execute only local
authorized service actions, keep maintenance through start, and probe live versions.
No executable hook is selected from the package or the coordinator's request.
"""
import hashlib
import json
from pathlib import Path
import uuid

from .update_journal import exclusive_lock, save_json
from .edition.update_manager import verify_update_manifest_signature
from .update_participant_package import stage_verified_package
from .update_transaction import TransactionFailure
from .update_transport import IDENTIFIER, OPERATIONS


class LocalUpdateParticipant:
    def __init__(self, participant_id: str, directory: Path, cache: Path, runtime):
        if not IDENTIFIER.fullmatch(participant_id):
            raise ValueError("Invalid participant identifier")
        self.name = participant_id
        self.directory = directory
        self.cache = cache
        self.runtime = runtime

    def execute(self, operation: str, transaction: str, release: dict):
        if operation not in OPERATIONS or not IDENTIFIER.fullmatch(transaction):
            raise ValueError("Invalid participant request")
        checksum = release.get("checksum_sha256", "")
        if not isinstance(checksum, str) or len(checksum) != 64 or any(
                char not in "0123456789abcdef" for char in checksum):
            raise ValueError("Invalid artifact checksum")
        identity = hashlib.sha256(json.dumps(release, sort_keys=True).encode()).hexdigest()
        with exclusive_lock(self.directory / ".participant.lock") as lock:
            root = self.directory / transaction
            journal = root / "participant.json"
            active = self.directory / "active.json"
            if active.exists():
                owner = json.loads(active.read_text())["transaction"]
                if not IDENTIFIER.fullmatch(owner):
                    raise TransactionFailure("Invalid participant owner")
                if owner != transaction:
                    old = self.directory / owner / "participant.json"
                    if not old.exists() or not json.loads(old.read_text()).get("finalized"):
                        raise TransactionFailure("Participant has an unfinished transaction")
                    if operation != "prepare" or journal.exists():
                        raise TransactionFailure("Stale transaction cannot control participant")
            if journal.exists():
                state = json.loads(journal.read_text())
                if state["identity"] != identity or state["participant"] != self.name:
                    raise TransactionFailure("Participant release or identity changed")
            else:
                if operation != "prepare":
                    raise TransactionFailure("Participant must prepare first")
                valid, _ = verify_update_manifest_signature(release)
                if not valid:
                    raise ValueError("Invalid release signature")
                root.mkdir(mode=0o700, parents=True, exist_ok=True)
                state = {"schema": 1, "participant": self.name, "identity": identity,
                         "transaction": transaction, "phase": None, "pending": None,
                         "receipts": {}, "apply_attempted": False}
                save_json(journal, state)
            save_json(active, {"transaction": transaction})
            return self._execute(operation, release, root, journal, state, lock.fileno())

    def _execute(self, operation, release, root, journal, state, lock_fd):
        receipts = state["receipts"]
        phase = state["phase"]
        # Cached prepare/snapshot receipts are immutable even after apply or restore.
        if operation in {"prepare", "snapshot", "finalize"} and operation in receipts:
            return receipts[operation]
        if state.get("finalized"):
            raise TransactionFailure("Participant transaction is finalized")
        if state.get("admission_decided") and operation not in {"activate", "finalize"}:
            raise TransactionFailure("Cannot restore after deciding to admit writes")
        if operation == "prepare":
            if not state.get("staged"):
                # A crash before saving this path may leave an orphan, never a
                # partially validated directory reused as a verified release.
                staged = root / ("payload-" + uuid.uuid4().hex)
                stage_verified_package(self.cache / (release["checksum_sha256"] + ".tar.gz"),
                                       release, staged)
                state["staged"] = staged.name
                save_json(journal, state)
        elif "prepare" not in receipts:
            raise TransactionFailure("Participant has no pinned preparation receipt")
        allowed = {
            "quiesce": {"prepare", "quiesce", "snapshot", "apply", "start", "verify",
                        "rollback", "verify_rollback"},
            "snapshot": {"quiesce"}, "apply": {"snapshot", "apply"},
            "rollback": {"quiesce", "rollback"},
            "start": {"apply", "rollback", "start"},
            "verify": {"start", "verify"}, "verify_rollback": {"start", "verify_rollback"},
            "activate": {"verify", "verify_rollback", "activate"}, "finalize": {"activate"},
        }
        if operation != "prepare" and phase not in allowed[operation]:
            raise TransactionFailure("Participant operation is out of order")
        if operation == "apply" and state.get("restored"):
            raise TransactionFailure("Cannot reapply a rolled back transaction")
        if operation == "verify" and state.get("restored"):
            raise TransactionFailure("Expected rollback verification")
        if operation == "verify_rollback" and not state.get("restored"):
            raise TransactionFailure("Rollback has not completed")
        state["pending"] = operation
        if operation == "apply":
            state["apply_attempted"] = True
        if operation == "activate":
            state["admission_decided"] = True
        save_json(journal, state)  # remote mutation may complete without a response
        context = {"directory": str(root), "staged": str(root / state["staged"]),
                   "transaction": state["transaction"], "participant": self.name,
                   "_lock_fd": lock_fd}
        if operation == "finalize" or (operation == "rollback" and not state["apply_attempted"]):
            result = {"ok": True}
        elif operation == "activate" and "activate" in receipts:
            result = receipts["activate"]
        else:
            result = self.runtime(operation, context, release)
        if not isinstance(result, dict) or result.get("ok") is not True:
            raise TransactionFailure("Participant runtime operation failed")
        if operation == "prepare" and (
                not isinstance(result.get("previous_version"), str) or not result["previous_version"]):
            raise TransactionFailure("Participant backup has no previous version")
        if operation in {"verify", "verify_rollback"}:
            expected = (release["version"] if operation == "verify"
                        else receipts["prepare"]["previous_version"])
            if result.get("version") != expected or result.get("transaction") != state["transaction"]:
                raise TransactionFailure("Participant live verification failed")
        receipt = {key: result[key] for key in ("ok", "previous_version", "version") if key in result}
        receipt["transaction"] = state["transaction"]
        receipts[operation] = receipt
        state.update(phase=operation, pending=None)
        if operation == "rollback":
            state["restored"] = True
        if operation == "finalize":
            state["finalized"] = True
        save_json(journal, state)
        return receipt
