from __future__ import annotations

import unittest

from installer.release_client import PublicRelease, ReleaseArtifact
from installer.self_update import available_installer_update


class SelfUpdateTests(unittest.TestCase):
    def setUp(self):
        self.release = PublicRelease(
            version="1.2.3",
            tag="treseko-community-v1.2.3",
            html_url="https://github.com/treseko/treseko-platform/releases/tag/treseko-community-v1.2.3",
            archive_url="https://api.github.com/repos/treseko/treseko-platform/zipball/treseko-community-v1.2.3",
            installer_version="1.1.0",
            artifacts={
                "macos-arm64": ReleaseArtifact("Treseko.app.zip", "https://github.com/treseko/app", 100, "a" * 64),
            },
            legacy_archive=False,
        )

    def test_offers_only_newer_matching_platform_installer(self):
        update = available_installer_update(self.release, "1.0.0", "Darwin", "arm64")
        self.assertIsNotNone(update)
        self.assertEqual(update.available_version, "1.1.0")
        self.assertIsNone(available_installer_update(self.release, "1.1.0", "Darwin", "arm64"))
        self.assertIsNone(available_installer_update(self.release, "1.0.0", "Linux", "x86_64"))


if __name__ == "__main__":
    unittest.main()
