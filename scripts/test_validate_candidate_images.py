import subprocess
import unittest

from scripts.validate_candidate_images import CandidateImageError, validate_candidate_images


class CandidateImageValidationTests(unittest.TestCase):
    def test_checks_every_declared_image_without_mutating_commands(self):
        calls = []

        def run(argv, **kwargs):
            calls.append((argv, kwargs))
            value = {
                "backend": "1.0.4",
                "frontend": '{"product":"treseko-platform","version":"1.0.4"}',
                "engine": "1.0.4",
                "automation-worker": "1.0.4",
                "plugin-runner": "1.0.4",
            }[_service_from_image(argv)]
            return subprocess.CompletedProcess(argv, 0, value + "\n", "")

        versions = validate_candidate_images(
            "/usr/bin/docker", "treseko-test", "1.0.4",
            ["backend", "frontend", "engine", "automation-worker", "plugin-runner"], runner=run,
        )

        self.assertEqual(set(versions), {"backend", "frontend", "engine", "automation-worker", "plugin-runner"})
        self.assertEqual(len(calls), 5)
        for argv, kwargs in calls:
            self.assertIn("run", argv)
            self.assertIn("--network", argv)
            self.assertEqual(argv[argv.index("--network") + 1], "none")
            self.assertIn("--read-only", argv)
            self.assertIn("--rm", argv)
            self.assertEqual(kwargs["check"], False)

    def test_stops_before_returning_partial_version_map_on_mismatch(self):
        calls = []

        def run(argv, **kwargs):
            calls.append(argv)
            return subprocess.CompletedProcess(argv, 0, "1.0.3\n", "")

        with self.assertRaisesRegex(CandidateImageError, "version mismatch"):
            validate_candidate_images("/usr/bin/docker", "treseko-test", "1.0.4", ["backend", "engine"], runner=run)
        self.assertEqual(len(calls), 1)

    def test_rejects_ambiguous_or_incomplete_inventory_before_docker(self):
        calls = []
        invalid = ([], ["backend", "backend"], ["database"], "backend")
        for services in invalid:
            with self.subTest(services=services), self.assertRaises(ValueError):
                validate_candidate_images("/usr/bin/docker", "treseko-test", "1.0.4", services, runner=lambda *a, **k: calls.append(a))
        self.assertEqual(calls, [])

    def test_rejects_probe_failure_without_leaking_container_output(self):
        def run(argv, **kwargs):
            return subprocess.CompletedProcess(argv, 1, "", "secret-looking docker internals")

        with self.assertRaisesRegex(CandidateImageError, "probe failed") as caught:
            validate_candidate_images("/usr/bin/docker", "treseko-test", "1.0.4", ["backend"], runner=run)
        self.assertNotIn("secret-looking", str(caught.exception))


def _service_from_image(argv):
    image_index = argv.index("--entrypoint") + 2
    image = argv[image_index]
    return image.removeprefix("treseko-test-")


if __name__ == "__main__":
    unittest.main()
