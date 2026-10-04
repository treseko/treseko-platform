"""GitHub release discovery and digest verification for the Treseko installer."""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
from pathlib import Path
import re
import tempfile
from urllib.parse import urlparse
import urllib.request


OFFICIAL_REPOSITORY = "treseko/treseko-platform"
GITHUB_API = "https://api.github.com/repos/treseko/treseko-platform/releases/latest"
MAX_INDEX_BYTES = 1024 * 1024
MAX_ARTIFACT_BYTES = 2 * 1024 * 1024 * 1024
VERSION_PATTERN = re.compile(r"^treseko-community-v(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)$")
ALLOWED_DOWNLOAD_HOSTS = {"github.com", "api.github.com", "release-assets.githubusercontent.com"}


class ReleaseError(ValueError):
    """Release metadata is missing, inconsistent, or unsafe to consume."""


@dataclass(frozen=True)
class ReleaseArtifact:
    name: str
    url: str
    size: int
    sha256: str


@dataclass(frozen=True)
class PublicRelease:
    version: str
    tag: str
    html_url: str
    archive_url: str
    installer_version: str | None
    artifacts: dict[str, ReleaseArtifact]
    legacy_archive: bool


def _https_url(value: object, hosts: set[str] = ALLOWED_DOWNLOAD_HOSTS) -> str:
    url = str(value or "").strip()
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.hostname not in hosts or parsed.username or parsed.password:
        raise ReleaseError("GitHub devolvió una URL de descarga no autorizada.")
    return url


def _asset_table(payload: dict, expected_version: str, assets: dict[str, dict]) -> tuple[str | None, dict[str, ReleaseArtifact]]:
    index_asset = assets.get("treseko-installer-release.json")
    if index_asset is None:
        return None, {}
    index_url = _https_url(index_asset.get("browser_download_url"))
    request = urllib.request.Request(index_url, headers={"Accept": "application/json", "User-Agent": "Treseko-Installer"})
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            if urlparse(response.geturl()).hostname not in ALLOWED_DOWNLOAD_HOSTS:
                raise ReleaseError("La URL final del índice de instalación no es oficial.")
            raw = response.read(MAX_INDEX_BYTES + 1)
    except ReleaseError:
        raise
    except Exception as exc:
        raise ReleaseError("No se pudo descargar el índice de distribución de GitHub.") from exc
    if len(raw) > MAX_INDEX_BYTES:
        raise ReleaseError("El índice de distribución supera el tamaño permitido.")
    try:
        index = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ReleaseError("El índice de distribución de GitHub no es JSON válido.") from exc
    if not isinstance(index, dict) or index.get("schema") != 1 or index.get("product_version") != expected_version:
        raise ReleaseError("La versión del índice no coincide con el release de GitHub.")
    installer_version = str(index.get("installer_version", ""))
    if not re.fullmatch(r"\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?", installer_version):
        raise ReleaseError("El índice de distribución no declara una versión válida del instalador.")
    entries = index.get("artifacts")
    if not isinstance(entries, dict):
        raise ReleaseError("El índice de distribución no declara artefactos.")
    result: dict[str, ReleaseArtifact] = {}
    for target, entry in entries.items():
        if not isinstance(target, str) or not isinstance(entry, dict):
            raise ReleaseError("El índice contiene un artefacto inválido.")
        name = str(entry.get("name", ""))
        asset = assets.get(name)
        size = entry.get("size")
        digest = str(entry.get("sha256", "")).lower()
        if (not asset or not name or not isinstance(size, int) or not 0 < size <= MAX_ARTIFACT_BYTES
                or asset.get("size") != size or not re.fullmatch(r"[a-f0-9]{64}", digest)):
            raise ReleaseError(f"Metadatos de artefacto inválidos para {target}.")
        result[target] = ReleaseArtifact(name, _https_url(asset.get("browser_download_url")), size, digest)
    return installer_version, result


def parse_latest_release(payload: object) -> PublicRelease:
    if not isinstance(payload, dict):
        raise ReleaseError("La API de GitHub no devolvió un release válido.")
    if payload.get("draft") or payload.get("prerelease"):
        raise ReleaseError("El release más reciente no es estable.")
    tag = str(payload.get("tag_name", ""))
    match = VERSION_PATTERN.fullmatch(tag)
    if not match:
        raise ReleaseError("El tag no sigue el formato de release Community esperado.")
    version = match.group(1)
    html_url = _https_url(payload.get("html_url"), {"github.com"})
    if urlparse(html_url).path != f"/{OFFICIAL_REPOSITORY}/releases/tag/{tag}":
        raise ReleaseError("El release no pertenece al repositorio público oficial.")
    archive_url = _https_url(payload.get("zipball_url"), {"api.github.com"})
    asset_rows = payload.get("assets", [])
    if not isinstance(asset_rows, list):
        raise ReleaseError("La lista de assets del release no es válida.")
    assets: dict[str, dict] = {}
    for row in asset_rows:
        if not isinstance(row, dict):
            raise ReleaseError("GitHub devolvió un asset inválido.")
        name = str(row.get("name", ""))
        if not name or name in assets:
            raise ReleaseError("GitHub devolvió assets con nombres duplicados o vacíos.")
        assets[name] = row
    installer_version, artifacts = _asset_table(payload, version, assets)
    return PublicRelease(version, tag, html_url, archive_url, installer_version, artifacts, not bool(artifacts))


def platform_artifact_key(system: str, machine: str) -> str:
    normalized_machine = machine.lower()
    if system == "Windows" and normalized_machine in {"amd64", "x86_64", "x64"}:
        return "windows-x64"
    if system == "Linux" and normalized_machine in {"amd64", "x86_64", "x64"}:
        return "linux-x64"
    if system == "Darwin" and normalized_machine in {"arm64", "aarch64"}:
        return "macos-arm64"
    if system == "Darwin" and normalized_machine in {"amd64", "x86_64", "x64"}:
        return "macos-x64"
    raise ReleaseError(f"No hay un instalador oficial para {system}/{machine}.")


def download_verified_artifact(artifact: ReleaseArtifact, destination: Path, *, max_bytes: int = MAX_ARTIFACT_BYTES) -> Path:
    if artifact.size > max_bytes:
        raise ReleaseError("El artefacto excede el límite de descarga configurado.")
    request = urllib.request.Request(artifact.url, headers={"User-Agent": "Treseko-Installer"})
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256()
    total = 0
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            if urlparse(response.geturl()).hostname not in ALLOWED_DOWNLOAD_HOSTS:
                raise ReleaseError("La descarga fue redirigida fuera de los hosts oficiales de GitHub.")
            with tempfile.NamedTemporaryFile(dir=destination.parent, prefix=f".{destination.name}.", delete=False) as output:
                temporary = Path(output.name)
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > min(max_bytes, artifact.size):
                        raise ReleaseError("El artefacto descargado excede el tamaño declarado.")
                    digest.update(chunk)
                    output.write(chunk)
        if total != artifact.size or digest.hexdigest() != artifact.sha256:
            raise ReleaseError("El tamaño o SHA-256 del artefacto no coincide con el índice oficial.")
        temporary.replace(destination)
        return destination
    except Exception:
        try:
            temporary.unlink(missing_ok=True)
        except (UnboundLocalError, OSError):
            pass
        raise
