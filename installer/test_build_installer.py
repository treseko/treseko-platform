from __future__ import annotations

import unittest
from unittest.mock import patch

from installer.build_installer import artifact_name


class InstallerArtifactNameTests(unittest.TestCase):
    def test_windows_and_linux_artifact_names_are_stable_and_versionless(self):
        self.assertEqual(artifact_name("windows"), "Treseko-Windows-x64.exe")
        self.assertEqual(artifact_name("linux"), "Treseko-Linux-x64.AppImage")

    def test_macos_artifact_name_preserves_architecture(self):
        with patch("installer.build_installer.macos_architecture", return_value="arm64"):
            self.assertEqual(artifact_name("macos"), "Treseko-macOS-arm64.app")


if __name__ == "__main__":
    unittest.main()
