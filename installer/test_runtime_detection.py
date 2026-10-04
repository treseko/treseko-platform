from __future__ import annotations

import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from installer.runtime_detection import compare_versions, detect_runtime, has_unfinished_update, installed_version, runtime_matches_installation


class _Response:
    def __init__(self, payload: dict[str, object]):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def __getitem__(self, key: str):
        return {"status": 200}[key]

    def read(self):
        return json.dumps(self.payload).encode()


class RuntimeDetectionTests(unittest.TestCase):
    def test_detects_treseko_only_when_frontend_and_backend_versions_match(self):
        def open_url(url: str, timeout: float):
            del timeout
            if url.endswith("/version.json"):
                return _Response({"product": "treseko-platform", "version": "1.2.3"})
            return _Response({"status": "ok", "version": "1.2.3"})

        with patch("installer.runtime_detection.urllib.request.urlopen", side_effect=open_url):
            result = detect_runtime(19095)
        self.assertEqual((result.state, result.version, result.backend_version), ("running", "1.2.3", "1.2.3"))

    def test_detects_component_version_mismatch(self):
        def open_url(url: str, timeout: float):
            del timeout
            if url.endswith("/version.json"):
                return _Response({"product": "treseko-platform", "version": "1.2.4"})
            return _Response({"status": "ok", "version": "1.2.3"})

        with patch("installer.runtime_detection.urllib.request.urlopen", side_effect=open_url):
            result = detect_runtime(19095)
        self.assertEqual(result.state, "version_mismatch")

    def test_versions_order_release_after_prerelease_and_detect_downgrades(self):
        self.assertGreater(compare_versions("1.2.3", "1.2.3-rc.1"), 0)
        self.assertGreater(compare_versions("1.2.3-rc.10", "1.2.3-rc.2"), 0)
        self.assertGreater(compare_versions("1.2.3-rc.2", "1.2.3-beta.9"), 0)
        self.assertLess(compare_versions("1.2.2", "1.2.3"), 0)
        self.assertEqual(compare_versions("1.2.3", "1.2.3"), 0)

    def test_unfinished_or_unreadable_journal_blocks_second_update(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.assertFalse(has_unfinished_update(root))
            journal = root / ".treseko-local/update-transactions/transaction.json"
            journal.parent.mkdir(parents=True)
            journal.write_text('{"phase":"migration_started"}', encoding="utf-8")
            self.assertTrue(has_unfinished_update(root))
            journal.write_text('{"phase":"committed"}', encoding="utf-8")
            self.assertFalse(has_unfinished_update(root))
            journal.write_text("not-json", encoding="utf-8")
            self.assertTrue(has_unfinished_update(root))

    def test_installed_version_prefers_committed_release_marker(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "VERSION").write_text("1.2.3\n", encoding="utf-8")
            marker = root / ".treseko-local/active-release.json"
            marker.parent.mkdir(parents=True)
            marker.write_text('{"version":"1.2.2"}', encoding="utf-8")
            self.assertEqual(installed_version(root), "1.2.2")

    def test_runtime_port_must_map_to_the_selected_compose_root(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            listed = type("Result", (), {"returncode": 0, "stdout": "container-id\n"})()
            labels = {
                "com.docker.compose.service": "frontend",
                "com.docker.compose.project.working_dir": str(root),
                "com.docker.compose.project.config_files": str(root / "docker-compose.prod.yml"),
            }
            inspected = type("Result", (), {"returncode": 0, "stdout": json.dumps(labels)})()
            with patch("installer.runtime_detection.shutil.which", return_value="/usr/bin/docker"), patch(
                "installer.runtime_detection.subprocess.run", side_effect=[listed, inspected],
            ) as run:
                self.assertTrue(runtime_matches_installation(9095, root))
                self.assertIn("publish=9095", run.call_args_list[0].args[0])

            labels["com.docker.compose.project.working_dir"] = str(root / "another-instance")
            labels["com.docker.compose.project.config_files"] = str(root / "another-instance/docker-compose.prod.yml")
            inspected = type("Result", (), {"returncode": 0, "stdout": json.dumps(labels)})()
            with patch("installer.runtime_detection.shutil.which", return_value="/usr/bin/docker"), patch(
                "installer.runtime_detection.subprocess.run", side_effect=[listed, inspected],
            ):
                self.assertFalse(runtime_matches_installation(9095, root))


if __name__ == "__main__":
    unittest.main()
