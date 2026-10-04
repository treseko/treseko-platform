from __future__ import annotations

import tempfile
from pathlib import Path
import unittest

from installer.build_release_index import build_index


class BuildReleaseIndexTests(unittest.TestCase):
    def test_builds_deterministic_metadata_with_size_and_digest(self):
        with tempfile.TemporaryDirectory() as temp:
            artifact = Path(temp) / "native-installer.bin"
            artifact.write_bytes(b"Treseko installer fixture")
            result = build_index("1.2.3", "2.0.0", {"linux-x64": artifact})
            self.assertEqual(result["product_version"], "1.2.3")
            self.assertEqual(result["installer_version"], "2.0.0")
            self.assertEqual(result["artifacts"]["linux-x64"]["size"], artifact.stat().st_size)
            self.assertEqual(len(result["artifacts"]["linux-x64"]["sha256"]), 64)

    def test_rejects_unknown_targets_invalid_versions_and_empty_files(self):
        with tempfile.TemporaryDirectory() as temp:
            artifact = Path(temp) / "empty"
            artifact.touch()
            with self.assertRaises(ValueError):
                build_index("main", "1.0.0", {"linux-x64": artifact})
            with self.assertRaises(ValueError):
                build_index("1.0.0", "1.0.0", {"macos-powerpc": artifact})
            with self.assertRaises(ValueError):
                build_index("1.0.0", "1.0.0", {"linux-x64": artifact})


if __name__ == "__main__":
    unittest.main()
