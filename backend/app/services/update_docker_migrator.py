"""Durable one-shot Docker participant for PostgreSQL migrations.

The container is deliberately not a service replacement.  Creation and start
are separate, journaled mutations so a lost Docker CLI response can be
reconciled without creating or starting a second migration job.
"""
from __future__ import annotations

import json
from pathlib import Path
import re
import subprocess
import time

from .update_journal import exclusive_lock, save_json
from .update_migrator_identity import (build_identity, env_digest, image_baseline,
                                        read_env, release_digest)
from .update_transaction import TransactionFailure


_DIGEST = re.compile(r"sha256:[a-f0-9]{64}\Z")
_IDENTIFIER = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}\Z")
_LABEL = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}\Z")
_ENTRYPOINT = ["/app/entrypoint.sh"]
_COMMAND = ["migrate-only"]


class DockerPostgresMigrator:
    """Execute one pinned ``/entrypoint.sh migrate-only`` Docker job.

    ``context`` must contain ``transaction`` and an absolute ``directory``
    used for the private journal.  The release is only bound by digest; its
    contents are never copied to the journal or a Docker command.
    """

    def __init__(self, docker: str, prepared_image: str, network: str, env_file: str,
                 scope: str, owner: str, timeout: float = 2100):
        if not Path(docker).is_absolute() or not Path(docker).is_file():
            raise ValueError("An absolute Docker executable is required")
        if not _DIGEST.fullmatch(prepared_image):
            raise ValueError("A pinned prepared image digest is required")
        if not _LABEL.fullmatch(network) or network in {"host", "none", "container"}:
            raise ValueError("An explicit Docker network is required")
        if not _LABEL.fullmatch(scope) or not _LABEL.fullmatch(owner):
            raise ValueError("Explicit migration scope and owner are required")
        if not isinstance(timeout, (int, float)) or isinstance(timeout, bool) or not 0 < timeout <= 86400:
            raise ValueError("Invalid Docker migration timeout")
        self.docker = str(docker)
        self.prepared_image = prepared_image
        self.network = network
        self.env_file = str(env_file)
        self.scope = scope
        self.owner = owner
        self.timeout = timeout
        self._env_values()

    def _env_values(self):
        return read_env(self.env_file)

    def _image_baseline(self):
        return image_baseline(self)

    def _env_digest(self):
        return env_digest(self)

    @staticmethod
    def _release_digest(release):
        return release_digest(release)

    def _paths(self, context):
        if not isinstance(context, dict) or not _IDENTIFIER.fullmatch(context.get("transaction", "")):
            raise ValueError("An explicit transaction identifier is required")
        directory = Path(context.get("directory", ""))
        if not directory.is_absolute() or directory.is_symlink():
            raise ValueError("An absolute private migration directory is required")
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        return directory, directory / "docker-migration.json", directory / ".docker-migration.lock"

    def _identity(self, context, release):
        return build_identity(self, context, release)

    def _run(self, arguments, *, timeout=None, stdout=subprocess.PIPE, wrap_errors=True):
        try:
            result = subprocess.run([self.docker, *arguments], stdout=stdout,
                                    stderr=subprocess.DEVNULL, timeout=timeout or self.timeout,
                                    check=False)
        except (OSError, subprocess.TimeoutExpired) as exc:
            if not wrap_errors:
                raise
            raise TransactionFailure("Docker migration outcome uncertain; journal retained") from exc
        return result

    def _inspect(self, container_id):
        result = self._run(["inspect", "--type", "container", container_id])
        if result.returncode:
            raise TransactionFailure("Docker migration inspection failed; job state is not inspectable")
        try:
            records = json.loads(result.stdout)
        except (TypeError, ValueError, json.JSONDecodeError) as exc:
            raise TransactionFailure("Docker migration inspection is invalid; journal retained") from exc
        if not isinstance(records, list) or len(records) != 1 or not isinstance(records[0], dict):
            raise TransactionFailure("Docker migration identity is ambiguous; journal retained")
        return records[0]

    def _exact(self, record, identity):
        if not record or not record.get("Id"):
            return False
        config = record.get("Config") or {}
        labels = config.get("Labels") or {}
        state = record.get("State") or {}
        networks = (record.get("NetworkSettings") or {}).get("Networks") or {}
        host = record.get("HostConfig") or {}
        configured_env = {}
        for entry in config.get("Env") or []:
            if not isinstance(entry, str) or "=" not in entry:
                return False
            key, value = entry.split("=", 1)
            if key in configured_env:
                return False
            configured_env[key] = value
        try:
            current_env_digest, _ = self._env_digest()
        except (OSError, UnicodeError, ValueError):
            return False
        if current_env_digest != identity.get("env_file_sha256"):
            return False
        expected_env = identity.get("_expected_env")
        if not isinstance(expected_env, dict):
            return False
        return (
            config.get("Image") == identity["image"]
            and record.get("Image") == identity["image_id"]
            and config.get("Entrypoint") == identity["entrypoint"]
            and config.get("Cmd") == identity["command"]
            and labels == identity["labels"]
            and record.get("Name", "").lstrip("/") == identity["name"]
            and set(networks) == {identity["network"]}
            and host.get("NetworkMode") == identity["network"]
            and configured_env == expected_env
            and not (config.get("Volumes") or host.get("Binds") or record.get("Mounts"))
            and isinstance(state.get("Running"), bool)
        )

    def _find_candidate(self, identity):
        result = self._run(["ps", "--all", "--no-trunc", "--quiet",
                            "--filter", "label=io.treseko.migration.scope=" + self.scope,
                            "--filter", "label=io.treseko.migration.owner=" + self.owner,
                            "--filter", "label=io.treseko.migration.transaction="
                            + identity["reserved_labels"]["io.treseko.migration.transaction"]])
        if result.returncode:
            raise TransactionFailure("Docker migration candidate listing failed; job state is not inspectable")
        ids = result.stdout.decode().split() if isinstance(result.stdout, bytes) else str(result.stdout or "").split()
        matches = []
        for container_id in ids:
            record = self._inspect(container_id)
            if record and self._exact(record, identity):
                matches.append(record)
        if len(matches) > 1:
            raise TransactionFailure("Multiple exact Docker migration candidates found; journal retained")
        return matches[0] if matches else None

    def _validate_state(self, state, identity, transaction):
        if (not isinstance(state, dict) or state.get("schema") != 1
                or state.get("transaction") != transaction
                or state.get("configuration_digest") != identity["configuration_digest"]):
            raise TransactionFailure("Docker migration configuration changed; no second job started")

    def _save_intent(self, journal, identity, transaction):
        state = {
            "schema": 1, "transaction": transaction, "scope": self.scope, "owner": self.owner,
            "configuration_digest": identity["configuration_digest"],
            "release_sha256": identity["release_sha256"], "image": identity["image"],
            "image_id": identity["image_id"], "image_env_sha256": identity["image_env_sha256"],
            "image_labels_sha256": identity["image_labels_sha256"],
            "network": identity["network"], "env_file_sha256": identity["env_file_sha256"],
            "effective_env_sha256": identity["effective_env_sha256"],
            "name": identity["name"], "labels": identity["reserved_labels"],
            "entrypoint": identity["entrypoint"], "command": identity["command"],
            "container_id": None, "create_attempted": False, "start_attempted": False,
            "start_outcome_uncertain": False,
            "status": "pending",
        }
        save_json(journal, state)
        return state

    def _adopt(self, state, record):
        state["container_id"] = record["Id"]
        state["status"] = "created" if not (record.get("State") or {}).get("Running") else "running"
        save_json(self._journal, state)

    def _record_state(self, state, record):
        docker_state = record.get("State") or {}
        status = docker_state.get("Status")
        if status == "running" or docker_state.get("Running"):
            state["status"] = "running"
            save_json(self._journal, state)
            return False
        if status != "exited" or not docker_state.get("StartedAt") or not docker_state.get("FinishedAt"):
            state["status"] = "uncertain"
            save_json(self._journal, state)
            return False
        exit_code = docker_state.get("ExitCode")
        state["exit_code"] = exit_code
        state["start_outcome_uncertain"] = False
        if exit_code == 0:
            state["status"] = "complete"
            save_json(self._journal, state)
            return True
        state["status"] = "failed"
        state["evidence"] = "migration_failed"
        save_json(self._journal, state)
        raise TransactionFailure("Docker migration failed; inspect the owned container and retained journal")

    def _observe(self, state, identity):
        deadline = time.monotonic() + self.timeout
        while True:
            record = self._inspect(state["container_id"])
            if record is None:
                state["status"] = "uncertain"
                save_json(self._journal, state)
                raise TransactionFailure("Docker migration container disappeared; journal retained")
            if not self._exact(record, identity):
                state["status"] = "uncertain"
                save_json(self._journal, state)
                raise TransactionFailure("Docker migration container configuration changed; journal retained")
            if self._record_state(state, record):
                return {"ok": True, "transaction": state["transaction"], "container_id": state["container_id"]}
            if time.monotonic() >= deadline:
                state["status"] = "uncertain"
                save_json(self._journal, state)
                raise TransactionFailure("Docker migration is still running; journal retained")
            time.sleep(min(0.2, max(0.01, deadline - time.monotonic())))

    def _verified_terminal(self, state, identity):
        record = self._inspect(state["container_id"])
        if not record or not self._exact(record, identity):
            return None
        docker_state = record.get("State") or {}
        if (docker_state.get("Status") != "exited" or not docker_state.get("StartedAt")
                or not docker_state.get("FinishedAt")):
            return None
        return record

    def __call__(self, context, release):
        directory, journal, lock = self._paths(context)
        identity = self._identity(context, release)
        self._journal = journal
        with exclusive_lock(lock):
            state = json.loads(journal.read_text()) if journal.exists() else self._save_intent(
                journal, identity, context["transaction"])
            self._validate_state(state, identity, context["transaction"])
            if state.get("status") == "complete":
                try:
                    terminal = self._verified_terminal(state, identity)
                except TransactionFailure:
                    terminal = None
                if terminal and (terminal.get("State") or {}).get("ExitCode") == 0:
                    return {"ok": True, "transaction": state["transaction"],
                            "container_id": state["container_id"]}
                state["status"] = "uncertain"
                save_json(journal, state)
                raise TransactionFailure("Completed Docker migration cannot be re-verified; journal retained")
            if state.get("status") == "failed":
                raise TransactionFailure("Docker migration failed; retained journal is terminal")
            if state.get("container_id"):
                record = self._inspect(state["container_id"])
                if record is None or not self._exact(record, identity):
                    state["status"] = "uncertain"
                    save_json(journal, state)
                    raise TransactionFailure("Docker migration candidate cannot be reconciled; journal retained")
            else:
                if state.get("create_attempted"):
                    candidate = self._find_candidate(identity)
                    if candidate is None:
                        raise TransactionFailure("Docker create response lost; journal retained and no retry allowed")
                    state["container_id"] = candidate["Id"]
                    state["status"] = "running" if (candidate.get("State") or {}).get("Running") else "created"
                    save_json(journal, state)
                else:
                    state["create_attempted"] = True
                    save_json(journal, state)
                    candidate = None
                    try:
                        result = self._run(["create", "--pull", "never", "--name", identity["name"],
                                            "--label", "io.treseko.migration.scope=" + self.scope,
                                            "--label", "io.treseko.migration.owner=" + self.owner,
                                            "--label", "io.treseko.migration.transaction=" + context["transaction"],
                                            "--network", self.network, "--env-file", self.env_file,
                                            "--entrypoint", "/app/entrypoint.sh", self.prepared_image, "migrate-only"],
                                           wrap_errors=False)
                    except (OSError, subprocess.TimeoutExpired):
                        # The daemon may have created the stopped job even though
                        # the CLI response was lost.  Search and verify before
                        # allowing the normal pre-start phase to continue.
                        try:
                            candidate = self._find_candidate(identity)
                        except TransactionFailure as exc:
                            state["status"] = "uncertain"
                            save_json(journal, state)
                            raise TransactionFailure("Docker create response lost; candidate is not inspectable") from exc
                        if candidate is None:
                            state["status"] = "uncertain"
                            save_json(journal, state)
                            raise TransactionFailure("Docker create response lost; journal retained and no retry allowed")
                        result = None
                    if result is not None and result.returncode:
                        candidate = self._find_candidate(identity)
                        if candidate is None:
                            state["status"] = "uncertain"
                            save_json(journal, state)
                            raise TransactionFailure("Docker create failed; journal retained and outcome uncertain")
                        state["container_id"] = candidate["Id"]
                    elif result is not None:
                        container_id = result.stdout.decode().strip() if isinstance(result.stdout, bytes) else str(result.stdout).strip()
                        if not re.fullmatch(r"[a-f0-9]{12,64}", container_id):
                            raise TransactionFailure("Docker create returned an invalid container ID; journal retained")
                        state["container_id"] = container_id
                    if result is None:
                        state["container_id"] = candidate["Id"]
                    record = self._inspect(state["container_id"])
                    if record is None or not self._exact(record, identity):
                        state["status"] = "uncertain"
                        save_json(journal, state)
                        raise TransactionFailure("Created Docker migration does not match exact configuration")
                    state["status"] = "running" if (record.get("State") or {}).get("Running") else "created"
                    save_json(journal, state)
            record = self._inspect(state["container_id"])
            if record is None or not self._exact(record, identity):
                state["status"] = "uncertain"
                save_json(journal, state)
                raise TransactionFailure("Docker migration candidate cannot be reconciled; journal retained")
            if (record.get("State") or {}).get("Running"):
                return self._observe(state, identity)
            if (record.get("State") or {}).get("Status") == "exited":
                return self._observe(state, identity)
            if state.get("start_attempted"):
                return self._observe(state, identity)
            state["start_attempted"] = True
            save_json(journal, state)
            try:
                start = self._run(["start", state["container_id"]], wrap_errors=False)
            except (OSError, subprocess.TimeoutExpired) as exc:
                # Never turn a lost start acknowledgement into rollback-safe
                # idle.  The job may be running, completed, or still unknown.
                state["status"] = "uncertain"
                state["start_outcome_uncertain"] = True
                save_json(journal, state)
                raise TransactionFailure("Docker start response lost; migration outcome uncertain") from exc
            if start.returncode:
                state["status"] = "uncertain"
                save_json(journal, state)
                raise TransactionFailure("Docker start failed; journal retained and outcome uncertain")
            state["start_acknowledged"] = True
            save_json(journal, state)
            return self._observe(state, identity)

    def reconcile(self, context, release):
        directory, journal, lock = self._paths(context)
        identity = self._identity(context, release)
        self._journal = journal
        with exclusive_lock(lock):
            if not journal.exists():
                return {"status": "absent", "idle": True}
            state = json.loads(journal.read_text())
            self._validate_state(state, identity, context["transaction"])
            if not state.get("container_id"):
                candidate = self._find_candidate(identity) if state.get("create_attempted") else None
                if candidate:
                    state["container_id"] = candidate["Id"]
                    save_json(journal, state)
                return state
            try:
                record = self._inspect(state["container_id"])
            except TransactionFailure:
                state["status"] = "uncertain"
                save_json(journal, state)
                return state
            if not record or not self._exact(record, identity):
                state["status"] = "uncertain"
                save_json(journal, state)
                return state
            docker_state = record.get("State") or {}
            if docker_state.get("Running"):
                state["status"] = "running"
            elif docker_state.get("Status") == "created" and not state.get("start_attempted"):
                # The daemon has only staged a stopped job.  No migration can
                # have run; retain this phase for the participant to start.
                state["status"] = "created"
            elif docker_state.get("Status") == "exited" and docker_state.get("StartedAt") and docker_state.get("FinishedAt"):
                state["status"] = "complete" if docker_state.get("ExitCode") == 0 else "failed"
                state["start_outcome_uncertain"] = False
            else:
                state["status"] = "uncertain"
            save_json(journal, state)
            return state

    def is_idle(self, context, release):
        try:
            state = self.reconcile(context, release)
        except (OSError, TransactionFailure, ValueError, json.JSONDecodeError):
            return False
        # A created-but-never-started container is safe for rollback: the
        # participant remains in this phase and has not run PostgreSQL.
        if state.get("status") == "created" and not state.get("start_attempted"):
            return True
        if state.get("start_outcome_uncertain") or state.get("status") in {"pending", "running", "uncertain"}:
            return False
        if state.get("status") == "absent":
            return True
        if state.get("status") == "pending" and not state.get("create_attempted"):
            return True
        return state.get("status") in {"complete", "failed"}

    def idle(self, context, release):
        return self.is_idle(context, release)

    def migration_idle(self, context, release):
        """Return rollback-safe idleness, never based only on CLI completion."""
        return self.is_idle(context, release)


DockerMigrationExecutor = DockerPostgresMigrator
