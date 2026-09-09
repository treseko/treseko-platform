"""Durable coordinator; participants own authenticated transport and idempotency.

No shell commands, host credentials or executable payloads belong in the journal.
The caller supplies an already verified release and an authorized inventory.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Protocol

from .update_journal import exclusive_lock, save_json


class Participant(Protocol):
    def execute(self, operation: str, transaction: str, release: dict) -> dict:
        """Idempotently perform operation, returning {ok: bool, ...}.

        prepare validates manageability, pins source/config and returns previous_version.
        snapshot pins recoverable code/data after the global quiesce barrier. Repeating it
        must never overwrite that snapshot. rollback must not restore data if
        this participant never attempted apply.
        verify/verify_rollback must check the running process, not a disk marker.
        quiesce stops new work and drains existing work; start retains maintenance.
        activate resumes admission only after every participant verified.
        rollback restores the pinned backup while admission remains disabled.
        finalize releases the host transaction only after global activation.
        """


class TransactionFailure(RuntimeError):
    pass


def activation_sequence(participants, order=None):
    result = list(participants) if order is None else order
    if (not isinstance(result, (list, tuple)) or not all(isinstance(name, str) for name in result)
            or len(result) != len(participants) or len(set(result)) != len(result)
            or set(result) != set(participants)):
        raise ValueError('Activation order must contain every participant exactly once')
    return list(result)


def quiesce_sequence(participants, order=None):
    result = list(participants) if order is None else order
    if (not isinstance(result, (list, tuple)) or not all(isinstance(name, str) for name in result)
            or len(result) != len(participants) or len(set(result)) != len(result)
            or set(result) != set(participants)):
        raise ValueError('Quiesce order must contain every participant exactly once')
    return list(result)


class UpdateTransaction:
    """One journal directory per installation, shared across all its transactions."""

    def __init__(self, journal: Path, participants: dict[str, Participant], *, inventory_identity: str | None = None,
                 activation_order=None, quiesce_order=None, admission_gates=None):
        if not participants or any(not name for name in participants):
            raise ValueError("An explicit, nonempty participant inventory is required")
        self.path = journal
        self.participants = dict(participants)
        self.activation_order = activation_sequence(participants, activation_order)
        self.quiesce_order = quiesce_sequence(participants, quiesce_order)
        if inventory_identity is not None and (len(inventory_identity) != 64
                or any(c not in "0123456789abcdef" for c in inventory_identity)):
            raise ValueError("Inventory identity must be a SHA-256 digest")
        self.inventory_identity = inventory_identity
        self.gates = dict(admission_gates or {})
        if self.gates and (inventory_identity is None or any(not name for name in self.gates)):
            raise ValueError('Admission gates require a bound private inventory identity')

    @staticmethod
    def _normalize_seal_state(state):
        state.setdefault('sealed', False)
        for gate in state.get('gates', {}).values():
            gate.setdefault('pending_seal', None)
            gate.setdefault('sealed', False)

    def _gate_call(self, state, name, action):
        state['gates'][name]['pending'] = action
        self._save(state)
        getattr(self.gates[name], action)(state['id'])
        info = state['gates'][name]
        info.update(pending=None, state='open' if action == 'release' else 'closed')
        if action == 'release':
            info['sealed'] = False
            state['sealed'] = all(item.get('sealed') is True
                                  for item in state['gates'].values())
        self._save(state)

    def _close_gates(self, state):
        self._normalize_seal_state(state)
        for name in self.gates:
            info = state['gates'][name]
            if info['sealed']:
                self._assert_gate_sealed(state, name)
                continue
            if info['pending_seal'] is not None:
                try:
                    self._assert_gate_sealed(state, name)
                except Exception:
                    self.gates[name].assert_closed(state['id'])
                continue
            self._gate_call(state, name, 'acquire')
            self.gates[name].assert_closed(state['id'])

    def _check_gates(self, state):
        self._normalize_seal_state(state)
        for name, gate in self.gates.items():
            info = state['gates'][name]
            if info.get('sealed') is True:
                self._assert_gate_sealed(state, name)
            elif info.get('pending_seal') is not None:
                # A seal may have taken effect while its acknowledgement was
                # lost. Adopt it only after the gate itself confirms it.
                try:
                    self._assert_gate_sealed(state, name)
                except Exception:
                    gate.assert_closed(state['id'])
                else:
                    info['pending_seal'] = None
                    info['sealed'] = True
                    state['sealed'] = all(item.get('sealed') is True
                                          for item in state['gates'].values())
                    self._save(state)
            else:
                gate.assert_closed(state['id'])

    @staticmethod
    def _assert_gate_sealed_object(gate, transaction):
        checker = getattr(gate, 'assert_sealed', None)
        if callable(checker):
            checker(transaction)
        else:
            gate.assert_closed(transaction)

    def _assert_gate_sealed(self, state, name):
        self._assert_gate_sealed_object(self.gates[name], state['id'])

    def _seal_gates(self, state):
        """Persist and reconcile the global seal barrier before snapshot/rollback."""
        self._normalize_seal_state(state)
        for name, gate in self.gates.items():
            info = state['gates'][name]
            if info['sealed']:
                self._assert_gate_sealed(state, name)
                continue
            info['pending_seal'] = 'seal'
            self._save(state)
            sealer = getattr(gate, 'seal', None)
            if callable(sealer):
                sealer(state['id'])
            else:
                # Legacy hard-only gates have no stronger operation. Their
                # closed assertion is the compatibility seal contract.
                gate.assert_closed(state['id'])
            self._assert_gate_sealed(state, name)
            info['pending_seal'] = None
            info['sealed'] = True
            self._save(state)
        state['sealed'] = all(info.get('sealed') is True
                              for info in state['gates'].values())
        self._save(state)
        self._check_gates(state)

    def _lock(self):
        return exclusive_lock(self.path.parent / ".installation-update.lock")

    def _claim_installation(self, transaction):
        active = self.path.parent / ".installation-update-active.json"
        if active.exists():
            owner = json.loads(active.read_text())
            if owner != {"journal": self.path.name, "transaction": transaction}:
                name = owner.get("journal", "")
                if not name or Path(name).name != name:
                    raise TransactionFailure("Invalid installation update owner")
                previous = self.path.parent / name
                if not previous.is_file():
                    raise TransactionFailure("Previous transaction journal is unavailable")
                status = json.loads(previous.read_text()).get("status")
                if status not in {"complete", "rolled_back"}:
                    raise TransactionFailure("Another installation transaction needs recovery")
        self._save({"journal": self.path.name, "transaction": transaction}, path=active)

    def _save(self, state, *, path=None):
        save_json(path or self.path, state)

    def _call(self, state, name, operation):
        node = state["participants"][name]
        node["pending"] = operation
        self._save(state)  # intent survives lost responses and coordinator crashes
        result = self.participants[name].execute(operation, state["id"], state["release"])
        if not isinstance(result, dict) or result.get("ok") is not True:
            raise TransactionFailure(f"{name}: {operation} failed")
        if operation == "prepare":
            if not isinstance(result.get("previous_version"), str) or not result["previous_version"]:
                raise TransactionFailure(f"{name}: backup version is missing")
            node["previous_version"] = result["previous_version"]
        if operation in {"verify", "verify_rollback"}:
            expected = state["release"]["version"] if operation == "verify" else node["previous_version"]
            if result.get("version") != expected or result.get("transaction") != state["id"]:
                raise TransactionFailure(f"{name}: running version or transaction does not match")
        node["completed"].append(operation)
        node["pending"] = None
        self._save(state)

    def run(self, transaction: str, release: dict):
        if not transaction or not release.get("version"):
            raise ValueError("Transaction and release version are required")
        checksum = release.get("checksum_sha256", "")
        if len(checksum) != 64 or any(c not in "0123456789abcdef" for c in checksum):
            raise ValueError("Verified artifact checksum is required")
        # Artifact identity matters even when republishing the same commercial version.
        identity = hashlib.sha256(json.dumps(release, sort_keys=True).encode()).hexdigest()
        with self._lock():
            self._claim_installation(transaction)
            if self.path.exists():
                state = json.loads(self.path.read_text())
                terminal = state["status"] in {"complete", "rolled_back"}
                legacy_quiesce = "quiesce_order" not in state
                # Legacy journals have no quiesce_order: their participant key
                # order is not reliable because save_json sorts object keys.
                if (state["id"] != transaction or state["identity"] != identity
                        or set(state["participants"]) != set(self.participants)
                        or state.get('activation_order') != self.activation_order
                        or set(state.get('gates', {})) != set(self.gates)
                        or state.get("inventory_identity") != self.inventory_identity):
                    raise ValueError("Journal does not match release and inventory")
                if not terminal and legacy_quiesce:
                    if not self.inventory_identity:
                        raise ValueError("Legacy journal quiesce order cannot be verified")
                    if self.quiesce_order != list(self.participants):
                        raise ValueError("Legacy journal quiesce order cannot be verified")
                elif not legacy_quiesce and state['quiesce_order'] != self.quiesce_order:
                    raise ValueError("Journal does not match release and inventory")
                if terminal:
                    return state
                self._normalize_seal_state(state)
                self._save(state)
                if state.get("decision") in {"commit", "rollback"}:
                    return self._activate(state)
                # An unacknowledged mutation may have run remotely. Recover all
                # prepared participants rather than interpreting silence as failure.
                return self._recover(state)
            state = {
                "schema": 1, "id": transaction, "identity": identity,
                "inventory_identity": self.inventory_identity,
                'activation_order': self.activation_order,
                'quiesce_order': self.quiesce_order,
                "release": release, "status": "preparing",
                'gates': {name: {'pending': None, 'state': 'unknown',
                                 'pending_seal': None, 'sealed': False}
                          for name in self.gates},
                'sealed': False,
                "participants": {name: {"completed": [], "pending": None}
                                 for name in self.participants},
            }
            self._save(state)
            try:
                self._close_gates(state)
            except Exception:
                state['status'] = 'ingress_pending'
                self._save(state)
                return state
            try:
                for operation in ("prepare", "quiesce"):
                    state["status"] = operation
                    self._save(state)
                    names = self.quiesce_order if operation == "quiesce" else self.participants
                    for name in names:
                        self._check_gates(state)
                        self._call(state, name, operation)
                self._seal_gates(state)
                for operation in ("snapshot", "apply", "start", "verify"):
                    state["status"] = operation
                    self._save(state)
                    for name in self.participants:
                        self._check_gates(state)
                        self._call(state, name, operation)
            except Exception:
                # Do not persist arbitrary remote error bodies (may contain secrets).
                return self._recover(state)
            # Point of no return: every runtime verified while writes were fenced.
            # Persist the decision BEFORE any participant resumes business writes.
            state["decision"] = "commit"
            self._save(state)
            return self._activate(state)

    def _activate(self, state):
        state["status"] = "activation_pending"
        self._save(state)
        for name in self.activation_order:
            node = state['participants'][name]
            if not node["completed"] and not node["pending"]:
                continue
            if "activate" in node["completed"] and node["pending"] != "activate":
                continue
            try:
                self._check_gates(state)
                self._call(state, name, "activate")
            except Exception:
                # Later consumers depend on the predecessors being available.
                # A missing acknowledgement cannot authorize their admission.
                return state
        # Runtime activation is globally verified before opening public ingress.
        # A lost release acknowledgement retries only release, never rollback.
        for name in self.gates:
            if state['gates'][name]['state'] == 'open' and state['gates'][name]['pending'] is None:
                continue
            try:
                self._gate_call(state, name, 'release')
            except Exception:
                return state
        return self._finalize(state)

    def _finalize(self, state):
        state["status"] = "finalization_pending"
        self._save(state)
        failed = False
        for name, node in state["participants"].items():
            if not node["completed"] or "finalize" in node["completed"]:
                continue
            try:
                self._call(state, name, "finalize")
            except Exception:
                failed = True
        if not failed:
            state["status"] = "complete" if state["decision"] == "commit" else "rolled_back"
            self._save(state)
        return state

    def _recover(self, state):
        state["status"] = "recovery_pending"
        self._save(state)
        try:
            self._close_gates(state)
        except Exception:
            return state
        involved = [name for name, node in state["participants"].items()
                    if node["completed"] or node["pending"]]
        # Recover the backup receipt if prepare succeeded but its response was lost.
        for name in involved:
            if "previous_version" not in state["participants"][name]:
                try:
                    self._check_gates(state)
                    self._call(state, name, "prepare")
                except Exception:
                    return state
        # Barrier: no restore until all participants stop admitting work.
        # Keep maintenance on every host if any recovery step fails.
        for operation in ("quiesce", "rollback", "start", "verify_rollback"):
            if operation == "rollback":
                try:
                    self._seal_gates(state)
                except Exception:
                    return state
            failed = False
            names = ([name for name in self.quiesce_order if name in involved]
                     if operation == "quiesce" else reversed(involved))
            for name in names:
                try:
                    self._check_gates(state)
                    self._call(state, name, operation)
                except Exception:
                    if operation == "quiesce":
                        # Quiescing is ordered: a dependent runtime must not
                        # be stopped while an earlier runtime may still be
                        # delivering callbacks.  Keep all gates closed and
                        # leave the intent pending for a later retry.
                        return state
                    failed = True
            if failed:
                return state
        # The same rule applies to a restored installation: once admission opens,
        # retry activation only, never restore the database a second time.
        state["decision"] = "rollback"
        self._save(state)
        return self._activate(state)
