from __future__ import annotations

import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from installer.release_client import ReleaseArtifact, ReleaseError, download_verified_artifact, parse_latest_release


class _Response:
    def __init__(self, content: bytes, url: str):
        self.content = content
        self.url = url
        self.offset = 0

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def geturl(self):
        return self.url

    def read(self, size: int = -1):
        if size < 0:
            size = len(self.content)
        chunk = self.content[self.offset:self.offset + size]
        self.offset += len(chunk)
        return chunk


def release_payload(**overrides):
    payload = {
        "draft": False,
        "prerelease": False,
        "tag_name": "treseko-community-v1.2.3",
        "html_url": "https://github.com/treseko/treseko-platform/releases/tag/treseko-community-v1.2.3",
        "zipball_url": "https://api.github.com/repos/treseko/treseko-platform/zipball/treseko-community-v1.2.3",
        "assets": [],
    }
    payload.update(overrides)
    return payload


class ReleaseClientTests(unittest.TestCase):
    def test_parses_official_stable_release_and_supports_historical_assetless_tag(self):
        release = parse_latest_release(release_payload())
        self.assertEqual(release.version, "1.2.3")
        self.assertEqual(release.tag, "treseko-community-v1.2.3")
        self.assertTrue(release.legacy_archive)

    def test_rejects_prerelease_wrong_tag_and_nonofficial_release_url(self):
        with self.assertRaises(ReleaseError):
            parse_latest_release(release_payload(prerelease=True))
        with self.assertRaises(ReleaseError):
            parse_latest_release(release_payload(tag_name="main"))
        with self.assertRaises(ReleaseError):
            parse_latest_release(release_payload(html_url="https://evil.example/releases/latest"))

    def test_verified_asset_is_atomically_saved_and_wrong_digest_is_rejected(self):
        content = b"native installer artifact"
        artifact = ReleaseArtifact(
            "Treseko-Installer.exe", "https://github.com/treseko/asset", len(content), hashlib.sha256(content).hexdigest(),
        )
        with tempfile.TemporaryDirectory() as temp:
            destination = Path(temp) / "installer.exe"
            response = _Response(content, artifact.url)
            with patch("installer.release_client.urllib.request.urlopen", return_value=response):
                self.assertEqual(download_verified_artifact(artifact, destination), destination)
            self.assertEqual(destination.read_bytes(), content)

            destination.write_bytes(b"previous")
            bad = ReleaseArtifact(artifact.name, artifact.url, len(content), "0" * 64)
            with patch("installer.release_client.urllib.request.urlopen", return_value=_Response(content, artifact.url)):
                with self.assertRaises(ReleaseError):
                    download_verified_artifact(bad, destination)
            self.assertEqual(destination.read_bytes(), b"previous")

    def test_reads_official_index_for_installer_and_package_assets(self):
        package = b"release package"
        installer = b"native executable"
        index = {
            "schema": 1,
            "product": "treseko-platform",
            "product_version": "1.2.3",
            "installer_version": "2.0.0",
            "artifacts": {
                "community-package": {"name": "treseko-community.tar.gz", "size": len(package), "sha256": hashlib.sha256(package).hexdigest()},
                "macos-arm64": {"name": "Treseko-Installer.app.zip", "size": len(installer), "sha256": hashlib.sha256(installer).hexdigest()},
            },
        }
        rows = [
            {"name": "treseko-installer-release.json", "size": 1, "browser_download_url": "https://github.com/treseko/index"},
            {"name": "treseko-community.tar.gz", "size": len(package), "browser_download_url": "https://github.com/treseko/package"},
            {"name": "Treseko-Installer.app.zip", "size": len(installer), "browser_download_url": "https://github.com/treseko/installer"},
        ]
        payload = release_payload(assets=rows)
        with patch(
            "installer.release_client.urllib.request.urlopen",
            return_value=_Response(json.dumps(index).encode(), rows[0]["browser_download_url"]),
        ):
            release = parse_latest_release(payload)
        self.assertEqual(release.installer_version, "2.0.0")
        self.assertEqual(release.artifacts["community-package"].name, "treseko-community.tar.gz")
        self.assertEqual(release.artifacts["macos-arm64"].size, len(installer))


if __name__ == "__main__":
    unittest.main()
