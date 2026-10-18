from __future__ import annotations

import hashlib
from pathlib import Path

from app.services import update_complete_source


def test_complete_source_stage_uses_verified_package_root_and_replays(tmp_path, monkeypatch):
    package = tmp_path / "package.tar.gz"
    package.write_bytes(b"verified release fixture")
    manifest = {
        "version": "1.0.7",
        "checksum_sha256": hashlib.sha256(package.read_bytes()).hexdigest(),
        "package_size_bytes": package.stat().st_size,
    }
    transaction = "qa-complete-source-stage"
    config = {"directory": str(tmp_path / "state")}
    expected_candidate = None

    def stage_verified(_package, _manifest, destination):
        nonlocal expected_candidate
        destination.mkdir(parents=True)
        expected_candidate = destination / "source-release"
        expected_candidate.mkdir()
        (expected_candidate / "VERSION").write_text("1.0.7\n")
        return destination

    monkeypatch.setattr(update_complete_source, "stage_verified_package", stage_verified)

    candidate, first_digest = update_complete_source._load_or_stage_complete_source(
        config, manifest, transaction, package
    )
    assert candidate == expected_candidate
    assert (candidate / "VERSION").read_text() == "1.0.7\n"

    replayed, replayed_digest = update_complete_source._load_or_stage_complete_source(
        config, manifest, transaction, package
    )
    assert replayed == candidate
    assert replayed_digest == first_digest
