"""Private per-host rendezvous for runtimes shared by multiple Compose services.

Only the authorized owner publishes AFTER DockerRuntimeVolume.prepare succeeds.
All consumers resolve after the coordinator's global snapshot barrier. This is
not a public API or a substitute for verifying the owner inventory/signature.
"""
import hashlib
import json
from pathlib import Path

from .update_journal import exclusive_lock, save_json
from .update_transaction import TransactionFailure


class SharedRuntimeCatalog:
    def __init__(self, directory: Path, transaction: str, release: dict):
        if not directory.is_absolute():
            raise ValueError("Explicit private host catalog required")
        self.directory = directory
        self.identity = {"transaction": transaction, "checksum": release["checksum_sha256"],
                         "version": release["version"]}

    def _path(self, source, root):
        key = hashlib.sha256(json.dumps([self.identity, source, root], sort_keys=True).encode()).hexdigest()
        return self.directory / (key + ".json")

    def publish(self, source, root, volume):
        with exclusive_lock(self.directory / ".shared-runtime.lock"):
            path = self._path(source, root)
            record = {**self.identity, "source": source, "root": root, "volume": volume}
            if path.exists() and json.loads(path.read_text()) != record:
                raise TransactionFailure("Shared runtime already has another prepared volume")
            save_json(path, record)

    def resolve(self, source, root):
        with exclusive_lock(self.directory / ".shared-runtime.lock"):
            path = self._path(source, root)
            if not path.is_file():
                raise TransactionFailure("Shared runtime owner has not completed snapshot preparation")
            record = json.loads(path.read_text())
            if any(record.get(k) != v for k, v in {**self.identity, "source": source, "root": root}.items()):
                raise TransactionFailure("Shared runtime receipt identity changed")
            return record["volume"]
