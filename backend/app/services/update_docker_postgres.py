"""Pinned PostgreSQL snapshots for the Docker runtime adapter.

Call snapshot only after ALL writers have drained. Restore requires the same
fence to remain in place. The container/database are explicit operator inventory,
not fields accepted from a release. No shared database/container is restarted.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile

from .update_journal import exclusive_lock, save_json
from .update_transaction import TransactionFailure


RESET_SCHEMAS = b"""
SELECT pg_advisory_xact_lock(8245932213343);
DO $treseko_restore$
DECLARE schema_name text;
BEGIN
  FOR schema_name IN SELECT nspname FROM pg_namespace
    WHERE nspname <> 'information_schema' AND nspname !~ '^pg_'
  LOOP
    EXECUTE format('DROP SCHEMA IF EXISTS %I CASCADE', schema_name);
  END LOOP;
END $treseko_restore$;
"""


class DockerPostgresSnapshot:
    def __init__(self, docker: str, container: str, project: str, service: str,
                 database: str, username: str, timeout: float = 300):
        if not Path(docker).is_absolute() or not re.fullmatch(r"[a-f0-9]{64}", container):
            raise ValueError("Docker executable and full pinned container ID are required")
        if not project or not service or database in {"postgres", "template0", "template1"}:
            raise ValueError("An explicit application database and service scope are required")
        for value in (database, username):
            if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_-]{0,62}", value):
                raise ValueError("Invalid database or role identifier")
        if not 0 < timeout <= 86400:
            raise ValueError("Invalid PostgreSQL operation timeout")
        self.docker, self.container = docker, container
        self.project, self.service = project, service
        self.database, self.username, self.timeout = database, username, timeout

    def _run(self, arguments, *, stdin=None, stdout=subprocess.PIPE):
        try:
            result = subprocess.run([self.docker, *arguments], stdin=stdin, stdout=stdout,
                                    stderr=subprocess.DEVNULL, timeout=self.timeout, check=False)
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise TransactionFailure("Docker PostgreSQL operation uncertain; keep writers fenced") from exc
        if result.returncode:
            raise TransactionFailure("Docker PostgreSQL operation failed; keep writers fenced")
        return result.stdout

    def _exec(self, command, *, stdin=None, stdout=subprocess.PIPE):
        return self._run(["exec", "-i", self.container, *command], stdin=stdin, stdout=stdout)

    def _check_target(self):
        items = json.loads(self._run(["inspect", "--type", "container", self.container]))
        if len(items) != 1:
            raise TransactionFailure("Database container identity is ambiguous")
        item = items[0]
        labels = item.get("Config", {}).get("Labels") or {}
        if (item.get("Id") != self.container or not item.get("State", {}).get("Running")
                or labels.get("com.docker.compose.project") != self.project
                or labels.get("com.docker.compose.service") != self.service):
            raise TransactionFailure("Database container no longer matches authorized inventory")
        identity = self._exec(["psql", "-X", "-A", "-t", "-U", self.username, "-d", self.database,
                               "-c", "SELECT current_database() || ':' || rolsuper FROM pg_roles WHERE rolname=current_user"])
        if identity.decode().strip() != self.database + ":true":
            raise TransactionFailure("Database restore requires the inventoried database and privileged local role")

    def _identity(self):
        return {"container": self.container, "project": self.project, "service": self.service,
                "database": self.database, "username": self.username}

    def _public_schema(self):
        raw = self._exec(["psql", "-X", "-A", "-t", "-U", self.username, "-d", self.database, "-c",
                          "SELECT json_build_object('owner',pg_get_userbyid(nspowner),"
                          "'version',current_setting('server_version_num')::int) "
                          "FROM pg_namespace WHERE nspname='public'"]).decode().strip()
        return json.loads(raw) if raw else None

    @staticmethod
    def _hash(path):
        with path.open("rb") as stream:
            return hashlib.file_digest(stream, "sha256").hexdigest()

    def snapshot(self, directory: Path):
        with exclusive_lock(directory / ".snapshot.lock"):
            self._check_target()
            receipt_path = directory / "database-receipt.json"
            archive = directory / "database.dump"
            if receipt_path.exists():
                return self._verify_receipt(directory)
            intent_path = directory / "database-intent.json"
            intent = json.loads(intent_path.read_text()) if intent_path.exists() else None
            if intent and intent.get("target") != self._identity():
                raise TransactionFailure("Snapshot belongs to a different database")
            if intent is None:
                if archive.exists():
                    raise TransactionFailure("Unattributed snapshot cannot be adopted")
                intent = {"target": self._identity(), "public_schema": self._public_schema()}
                save_json(intent_path, intent)
            if not archive.exists():
                descriptor, temporary = tempfile.mkstemp(dir=directory, prefix=".database-")
                try:
                    with os.fdopen(descriptor, "wb") as output:
                        self._exec(["pg_dump", "-U", self.username, "-d", self.database,
                                    "--format=custom"], stdout=output)
                        output.flush()
                        os.fsync(output.fileno())
                    os.replace(temporary, archive)
                finally:
                    if os.path.exists(temporary):
                        os.unlink(temporary)
            with archive.open("rb") as source:
                self._exec(["pg_restore", "--list"], stdin=source, stdout=subprocess.DEVNULL)
            receipt = {"schema": 1, "target": self._identity(), "checksum_sha256": self._hash(archive),
                       "size": archive.stat().st_size,
                       "bootstrap_public": intent["public_schema"]}
            save_json(receipt_path, receipt)
            return receipt

    def _verify_receipt(self, directory):
        receipt = json.loads((directory / "database-receipt.json").read_text())
        archive = directory / "database.dump"
        if (receipt.get("schema") != 1 or receipt.get("target") != self._identity()
                or archive.is_symlink() or not archive.is_file()
                or archive.stat().st_size != receipt.get("size")
                or self._hash(archive) != receipt.get("checksum_sha256")):
            raise TransactionFailure("Pinned database snapshot is missing, changed or belongs to another target")
        return receipt

    def restore(self, directory: Path):
        with exclusive_lock(directory / ".snapshot.lock"):
            self._check_target()
            receipt = self._verify_receipt(directory)
            # Render and validate the entire archive BEFORE the database transaction.
            # A transaction plus ON_ERROR_STOP prevents a half-restored database.
            with tempfile.TemporaryFile(dir=directory) as sql:
                sql.write(RESET_SCHEMAS)
                public = receipt.get("bootstrap_public")
                if public:
                    # pg_dump can omit CREATE for the initdb-provided public
                    # schema. Recreate its baseline before dump ACL adjustments.
                    owner = public["owner"].replace('"', '""')
                    privilege = "USAGE" if public["version"] >= 150000 else "ALL"
                    sql.write((f'CREATE SCHEMA public AUTHORIZATION "{owner}";\n'
                               f'GRANT {privilege} ON SCHEMA public TO PUBLIC;\n').encode())
                sql.flush()
                with (directory / "database.dump").open("rb") as source:
                    self._exec(["pg_restore", "--file=-"], stdin=source, stdout=sql)
                sql.flush()
                sql.seek(0)
                self._exec(["psql", "-X", "-v", "ON_ERROR_STOP=1", "--single-transaction",
                            "-U", self.username, "-d", self.database, "-f", "-"],
                           stdin=sql, stdout=subprocess.DEVNULL)
            return {"ok": True, "database": self.database}
