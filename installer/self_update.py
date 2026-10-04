"""Installer-version policy shared by the native platform frontends."""

from __future__ import annotations

from dataclasses import dataclass

from installer.release_client import PublicRelease, ReleaseArtifact, platform_artifact_key
from installer.runtime_detection import compare_versions


@dataclass(frozen=True)
class InstallerUpdate:
    current_version: str
    available_version: str
    artifact: ReleaseArtifact
    product_version: str


def available_installer_update(
    release: PublicRelease,
    current_version: str,
    system: str,
    machine: str,
) -> InstallerUpdate | None:
    """Return only a newer, platform-matched installer from a validated index."""
    if not release.installer_version:
        return None
    if compare_versions(release.installer_version, current_version) <= 0:
        return None
    key = platform_artifact_key(system, machine)
    artifact = release.artifacts.get(key)
    if artifact is None:
        return None
    return InstallerUpdate(current_version, release.installer_version, artifact, release.version)
