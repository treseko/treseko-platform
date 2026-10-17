from __future__ import annotations

import json
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

from scripts.atomic_local_update import AtomicComposeUpdate, UpdateError, _safe_failure_summary


class AtomicLocalUpdateTests(unittest.TestCase):
    def test_release_snapshot_excludes_worker_identity_and_pairing_credentials(self):
        runner = self._runner()
        worker_identity = runner.candidate_root / "automation-worker" / ".worker-instance-id"
        pairing_token = runner.candidate_root / "automation-worker" / ".runner-token.pairing"
        worker_identity.parent.mkdir(parents=True, exist_ok=True)
        worker_identity.write_text("local worker identity", encoding="utf-8")
        pairing_token.write_text("local pairing credential", encoding="utf-8")

        release_files = {path.relative_to(runner.candidate_root).as_posix()
                         for path in runner._release_files(runner.candidate_root)}
        ignored = runner._release_ignored(
            str(worker_identity.parent), [worker_identity.name, pairing_token.name])

        self.assertNotIn("automation-worker/.worker-instance-id", release_files)
        self.assertNotIn("automation-worker/.runner-token.pairing", release_files)
        self.assertEqual(ignored, {".worker-instance-id", ".runner-token.pairing"})

    def test_failure_summary_keeps_actionable_error_and_redacts_credentials(self):
        summary = _safe_failure_summary(
            "Container treseko-engine Error: healthcheck failed for token=verysecret "
            "postgresql://treseko:dbsecret@db/treseko\nordinary progress output")
        self.assertIn("healthcheck failed", summary)
        self.assertNotIn("verysecret", summary)
        self.assertNotIn("dbsecret", summary)

    def test_candidate_health_wait_ignores_successful_one_shot_migrator(self):
        runner = self._runner()
        records = []
        for service, running, health, exit_code in (
                ("backend", True, "healthy", 0), ("engine", True, "healthy", 0),
                ("migrator", False, "unhealthy", 0)):
            records.append({"Config": {"Labels": {"com.docker.compose.service": service}},
                            "State": {"Running": running, "Status": "running" if running else "exited",
                                      "ExitCode": exit_code, "Health": {"Status": health}}})
        runner._docker = lambda *args, **kwargs: "container-id" if args[0] == "ps" else json.dumps(records)
        runner._wait_candidate_services_healthy(["backend", "engine"], timeout=1)

    def test_plugin_runner_without_docker_healthcheck_uses_live_http_probe(self):
        runner = self._runner()
        calls = []
        runner._docker = lambda *args, **kwargs: calls.append((args, kwargs)) or ""
        record = {"Id": "plugin-container"}

        runner._verify_plugin_runner_baseline(record, None)

        self.assertEqual(calls[0][0][:3], ("exec", "plugin-container", "node"))
        self.assertEqual(calls[0][1]["timeout"], 10)
        self.assertIn("http://127.0.0.1:3020/health", calls[0][0][4])

    def test_plugin_runner_starting_healthcheck_is_not_replaced_by_http_probe(self):
        runner = self._runner()
        calls = []
        runner._docker = lambda *args, **kwargs: calls.append(args)

        with self.assertRaisesRegex(UpdateError, "no confirmed healthy baseline"):
            runner._verify_plugin_runner_baseline({"Id": "plugin-container"}, "starting")
        self.assertEqual(calls, [])

    def test_plugin_runner_http_probe_failure_rejects_baseline(self):
        runner = self._runner()
        runner._docker = lambda *args, **kwargs: (_ for _ in ()).throw(UpdateError("probe failed"))

        with self.assertRaisesRegex(UpdateError, "HTTP health probe failed"):
            runner._verify_plugin_runner_baseline({"Id": "plugin-container"}, "")

    def test_database_must_match_every_candidate_migration_head(self):
        runner = self._runner()
        outputs = iter(("20260924_0067 (head)\n", "20260924_0067 (head)\n"))
        runner._compose_candidate = lambda *args, **kwargs: next(outputs)
        runner._assert_database_at_candidate_heads()

        runner._compose_candidate = lambda *args, **kwargs: (
            "20260924_0067 (head)\n" if args[-1] == "heads" else "20260909_0062\n")
        with self.assertRaisesRegex(UpdateError, "migration revision"):
            runner._assert_database_at_candidate_heads()

    def test_running_container_must_use_its_built_candidate_image(self):
        runner = self._runner()
        candidate_id = "sha256:" + "a" * 64
        runner._compose_candidate = lambda *args, **kwargs: "0123456789ab\n"
        calls = iter((candidate_id, candidate_id))
        runner._docker = lambda *args, **kwargs: next(calls)
        runner._assert_running_image_matches_candidate("backend")

        calls = iter((candidate_id, "sha256:" + "b" * 64))
        with self.assertRaisesRegex(UpdateError, "does not match"):
            runner._assert_running_image_matches_candidate("backend")

    def test_only_one_update_can_mutate_an_installation_at_a_time(self):
        first = self._runner()
        second = self._runner()
        with first._installation_lock():
            with self.assertRaisesRegex(UpdateError, "already owns this installation"):
                with second._installation_lock():
                    pass

    def test_reconcile_only_does_not_start_a_new_transaction(self):
        runner = self._runner()
        result = runner.run(reconcile_only=True)

        self.assertEqual(result["transaction"], runner.transaction)
        self.assertEqual(result["phase"], "not_started")
        self.assertEqual(self.commands, [])

    def test_validate_only_prepares_immutable_candidate_without_service_mutation(self):
        runner = self._runner()
        staging = runner.candidate_root / "public-release"
        staging.mkdir()
        (staging / "stale-copy.py").write_text("not release source", encoding="utf-8")
        static = runner.candidate_root / "backend" / "app" / "static"
        static.mkdir(parents=True)
        (static / "user-evidence.bin").write_bytes(b"persisted outside source")
        secret = runner.candidate_root / "backend" / ".env.production"
        secret.write_text("PRIVATE=must-not-package\n", encoding="utf-8")

        result = runner.run_mode(validate_only=True)

        self.assertEqual(result["phase"], "prepared")
        self.assertEqual(result["version"], "1.0.4")
        self.assertIn("backend", result["active_services"])
        self.assertIn("frontend", result["candidate_services"])
        self.assertEqual(self.commands, [])
        self.assertTrue(runner.active_release_path.parent.joinpath("releases").is_dir())
        self.assertFalse((runner.candidate_root / "public-release").exists())
        self.assertFalse((runner.candidate_root / "backend" / "app" / "static").exists())
        self.assertFalse((runner.candidate_root / "backend" / ".env.production").exists())

    def test_validate_only_rejects_compose_root_outside_private_host_binding(self):
        runner = self._runner()
        runner.expected_project_root = self.root / "unexpected-root"

        with self.assertRaisesRegex(UpdateError, "differs from its private host binding"):
            runner.run_mode(validate_only=True)

        self.assertEqual(self.commands, [])

    def test_older_candidate_is_rejected_against_verified_active_release_before_docker(self):
        runner = self._runner()
        active = runner.release_root / "1.0.7-verified"
        active.mkdir(parents=True)
        for source in runner.candidate_root.iterdir():
            if source.is_dir():
                shutil.copytree(source, active / source.name)
            else:
                shutil.copy2(source, active / source.name)
        (active / "VERSION").write_text("1.0.7\n", encoding="utf-8")
        manifest = runner._release_manifest(active, "1.0.7")
        runner._write_atomic_json(active / ".treseko-release.json", manifest)
        runner._write_atomic_json(runner.active_release_path, {
            "schema": 1, "version": "1.0.7", "release": active.name,
            "tree_sha256": manifest["tree_sha256"],
        })

        with self.assertRaisesRegex(UpdateError, "older than active release 1.0.7"):
            runner.run_mode(validate_only=True)

        self.assertEqual(self.commands, [])

    def test_release_version_comparison_handles_prereleases_and_patch_versions(self):
        compare = AtomicComposeUpdate._release_version_key
        self.assertLess(compare("1.0.6"), compare("1.0.7"))
        self.assertLess(compare("1.0.7-rc.2"), compare("1.0.7-rc.10"))
        self.assertLess(compare("1.0.7-rc.10"), compare("1.0.7"))

    def test_reconcile_only_closes_pre_mutation_journal_without_docker(self):
        runner = self._runner()
        runner.state = {"schema": 1, "transaction": runner.transaction,
                        "phase": "preparing", "candidate_root": str(runner.candidate_root),
                        "version": runner.expected_version}
        runner._save()

        result = runner.run(reconcile_only=True)

        self.assertEqual(result["phase"], "abandoned_before_mutation")
        self.assertEqual(json.loads(runner.journal_path.read_text())["phase"],
                         "abandoned_before_mutation")
        self.assertEqual(self.commands, [])

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="treseko-atomic-local-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.candidate = self.root / "candidate"
        self.install = self.root / "install"
        self.candidate.mkdir()
        self.install.mkdir()
        (self.candidate / "VERSION").write_text("1.0.4\n", encoding="utf-8")
        (self.candidate / "docker-compose.prod.yml").write_text(
            "services:\n  backend:\n    environment:\n      RELEASE_CONFIG: candidate\n", encoding="utf-8")
        (self.candidate / "frontend").mkdir()
        (self.candidate / "frontend" / "nginx.conf").write_text(
            "if (-f /usr/share/nginx/html/.maintenance) { return 503; }\n"
            "location = /__treseko_update_gate_probe__ { return 204; }\n", encoding="utf-8")
        (self.candidate / "backend" / "app").mkdir(parents=True)
        (self.candidate / "backend" / "app" / "minor-release-change.py").write_text(
            "RELEASE_FEATURE = True\n", encoding="utf-8")
        (self.candidate / "compose.production.env").write_text("CANDIDATE_SECRET=must-not-copy\n", encoding="utf-8")
        (self.candidate / ".env.production.example").write_text("PUBLIC_SAMPLE=value\n", encoding="utf-8")
        (self.candidate / ".env.production").write_text("PRIVATE_VALUE=do-not-copy\n", encoding="utf-8")
        self.env = self.install / "compose.production.env"
        self.env.write_text("TRESEKO_COMPOSE_PROJECT_NAME=treseko-test\n", encoding="utf-8")
        self.old = self.root / "old-release"
        self.old.mkdir()
        self.records = []
        for index, service in enumerate(("db", "redis", "backend", "engine", "frontend")):
            self.records.append({
                "Id": f"{index + 1:064x}", "Image": f"sha256:{index + 1:064x}",
                "State": {"Running": True, "Health": {"Status": "healthy"}},
                "Config": {"Labels": {"com.docker.compose.project": "treseko-test",
                                       "com.docker.compose.service": service,
                                       "com.docker.compose.oneoff": "False"},
                           "StopSignal": "SIGQUIT" if service == "frontend" else ""},
                "Mounts": ([{"Type": "volume", "Name": "treseko-test_dbdata"}] if service == "db" else
                           ([{"Type": "volume", "Name": "treseko-test_frontend", "Destination": "/usr/share/nginx/html"}]
                            if service == "frontend" else [])),
            })
        self.commands = []

    def _runner(self, failure=None):
        runner = AtomicComposeUpdate(docker="docker", project="treseko-test",
                                     candidate_root=self.candidate, install_root=self.install,
                                     env_file=self.env, expected_version="1.0.4")
        runner._running_inventory = lambda: (self.records, [], self.old, [str(self.old / "compose.yml")],
                                             {"services": {name: {} for name in
                                              ("db", "redis", "migrator", "backend", "engine", "frontend")}})
        runner._compose_model = lambda root, files, profiles, project_directory: {
            "services": {
                **{name: {} for name in ("db", "redis", "migrator", "backend", "engine", "frontend")},
                "automation-worker": {"profiles": ["automation"]},
                "plugin-runner": {"profiles": ["plugins"]},
            }}
        runner._tag_old_images = lambda records, model: {
            **{record["Config"]["Labels"]["com.docker.compose.service"]:
               f"rollback:{record['Config']['Labels']['com.docker.compose.service']}"
               for record in records},
            "migrator": "rollback:migrator",
        }
        runner._docker = lambda *args, **kwargs: self.commands.append(("docker", args)) or ""

        def compose(root, files, profiles, *args, **kwargs):
            self.commands.append(("compose", str(root), args))
            if failure == "migrator" and Path(root).resolve() == runner.candidate_root and args[:3] == ("run", "--rm", "migrator"):
                raise UpdateError("injected migration failure")
            if failure == "app-start" and Path(root).resolve() == runner.candidate_root and "--remove-orphans" in args:
                raise UpdateError("injected candidate startup failure")
            return ""

        runner._compose = compose
        runner._snapshot_volumes = lambda volumes, image: {volume: f"{volume}_snapshot" for volume in volumes}
        runner._restore_volumes = lambda backups, image: self.commands.append(("restore", backups, image))
        runner._verify_candidate = lambda: None
        runner._candidate_start_snapshot = lambda: [{"service": "backend", "status": "exited", "exit_code": "1",
                                                      "health": "unhealthy", "health_output": "injected"}]
        runner._wait_candidate_services_healthy = lambda services, timeout: None
        return runner

    def test_preflight_rejection_does_not_stop_or_migrate_existing_project(self):
        runner = self._runner()
        with patch("scripts.validate_candidate_images.validate_candidate_images",
                   side_effect=UpdateError("version mismatch")):
            with self.assertRaises(UpdateError):
                runner.run()
        compose_commands = [item for item in self.commands if item[0] == "compose"]
        self.assertFalse(any("stop" in item[2] or "migrator" in item[2] for item in compose_commands))
        journal = json.loads(runner.journal_path.read_text(encoding="utf-8"))
        self.assertEqual(journal["phase"], "candidate_rejected")

    def test_existing_compose_service_omitted_by_candidate_blocks_before_stop(self):
        runner = self._runner()
        self.records.append({
            "Id": "container-custom-runner", "Image": "sha256:" + "f" * 64,
            "State": {"Running": True, "Health": {"Status": "healthy"}},
            "Config": {"Labels": {"com.docker.compose.project": "treseko-test",
                                   "com.docker.compose.service": "custom-runner",
                                   "com.docker.compose.oneoff": "False"}},
            "Mounts": [],
        })
        runner._running_inventory = lambda: (
            self.records, [], self.old, [str(self.old / "compose.yml")],
            {"services": {name: {} for name in (
                "db", "redis", "migrator", "backend", "engine", "frontend", "custom-runner")}},
        )

        with self.assertRaisesRegex(UpdateError, "omits existing installation services: custom-runner"):
            runner.run()

        compose_commands = [item[2] for item in self.commands if item[0] == "compose"]
        self.assertFalse(any("stop" in command or "migrator" in command for command in compose_commands))
        self.assertFalse(any(item[0] == "restore" for item in self.commands))

    def test_success_snapshots_then_migrates_then_starts_complete_project(self):
        runner = self._runner()
        with patch("scripts.validate_candidate_images.validate_candidate_images", return_value={
                "backend": "1.0.4", "frontend": "1.0.4", "engine": "1.0.4"}):
            runner.run()
        compose_commands = [item[2] for item in self.commands if item[0] == "compose"]
        stop = next(index for index, command in enumerate(compose_commands) if "stop" in command)
        frontend_stop = next(index for index, item in enumerate(self.commands)
                             if item[0] == "docker" and item[1][:3] == ("stop", "--signal", "SIGTERM"))
        migration = next(index for index, command in enumerate(compose_commands) if command[:3] == ("run", "--rm", "migrator"))
        app_start = next(index for index, command in enumerate(compose_commands)
                         if "--remove-orphans" in command)
        self.assertLess(stop, migration)
        compose_stop_command_index = next(index for index, item in enumerate(self.commands)
                                          if item[0] == "compose" and "stop" in item[2])
        self.assertLess(frontend_stop, compose_stop_command_index)
        self.assertLess(migration, app_start)
        self.assertIn("--force-recreate", compose_commands[app_start])
        self.assertNotIn("automation-worker", compose_commands[app_start])
        self.assertNotIn("plugin-runner", compose_commands[app_start])
        candidate_override = runner.candidate_override.read_text(encoding="utf-8")
        self.assertIn('command: ["atomic-serve"]', candidate_override)
        self.assertIn('TRESEKO_ATOMIC_RUNTIME_SYNC: "1"', candidate_override)
        journal = json.loads(runner.journal_path.read_text(encoding="utf-8"))
        self.assertEqual(journal["phase"], "committed")
        self.assertTrue(journal["volume_backups"])
        active = json.loads(runner.active_release_path.read_text(encoding="utf-8"))
        active_root = self.install / ".treseko-local" / "releases" / active["release"]
        self.assertEqual(active["version"], "1.0.4")
        self.assertTrue((active_root / "backend/app/minor-release-change.py").is_file())
        self.assertIn("RELEASE_CONFIG: candidate",
                      (active_root / "docker-compose.prod.yml").read_text(encoding="utf-8"))
        self.assertFalse((active_root / "compose.production.env").exists())
        self.assertEqual((active_root / ".env.production.example").read_text(), "PUBLIC_SAMPLE=value\n")
        self.assertFalse((active_root / ".env.production").exists())
        self.assertEqual(json.loads((active_root / ".treseko-release.json").read_text())[
            "tree_sha256"], active["tree_sha256"])

    def test_active_plugin_runner_is_carried_into_candidate_transaction(self):
        runner = self._runner()
        plugin = {
            "Id": "plugin-container", "Image": "sha256:" + "9" * 64,
            "State": {"Running": True, "Health": {"Status": "healthy"}},
            "Config": {"Labels": {"com.docker.compose.project": "treseko-test",
                                   "com.docker.compose.service": "plugin-runner",
                                   "com.docker.compose.oneoff": "False"}},
            "Mounts": [],
        }
        self.records.append(plugin)
        runner._running_inventory = lambda: (
            self.records, ["plugins"], self.old, [str(self.old / "compose.yml")],
            {"services": {name: {} for name in
             ("db", "redis", "migrator", "backend", "engine", "frontend", "plugin-runner")}},
        )
        version_validation = {}

        def validate_images(docker, project, expected, services):
            version_validation["services"] = services
            return {service: "1.0.4" for service in services}

        with patch("scripts.validate_candidate_images.validate_candidate_images",
                   side_effect=validate_images):
            runner.run()

        compose_commands = [item[2] for item in self.commands if item[0] == "compose"]
        candidate_start = next(command for command in compose_commands if "--remove-orphans" in command)
        self.assertIn("plugin-runner", candidate_start)
        self.assertIn("plugin-runner", version_validation["services"])
        self.assertIn("plugin-runner", runner.state["active_services"])

    def test_candidate_service_selection_respects_optional_profiles(self):
        model = {"services": {
            "db": {}, "redis": {}, "migrator": {}, "backend": {}, "engine": {}, "frontend": {},
            "automation-worker": {"profiles": ["automation"]},
            "plugin-runner": {"profiles": ["plugins"]},
        }}
        self.assertEqual(
            AtomicComposeUpdate._candidate_services_to_start(model, []),
            ["backend", "db", "engine", "frontend", "redis"],
        )
        self.assertEqual(
            AtomicComposeUpdate._candidate_services_to_start(model, ["plugins"]),
            ["backend", "db", "engine", "frontend", "plugin-runner", "redis"],
        )

    def test_core_candidate_service_without_healthcheck_is_rejected(self):
        runner = self._runner()
        # _runner() disables health waits for transaction tests; this regression
        # must exercise the real health verifier instead of inheriting that mock.
        del runner._wait_candidate_services_healthy
        record = {
            "Config": {"Labels": {"com.docker.compose.service": "redis"}},
            "State": {"Running": True},
        }
        runner._docker = lambda *args, **kwargs: "container-id" if args[0] == "ps" else json.dumps([record])

        with self.assertRaisesRegex(UpdateError, "redis has no configured healthcheck"):
            runner._wait_candidate_services_healthy(["redis"], timeout=1)

    def test_candidate_plugin_runner_without_healthcheck_is_rejected(self):
        runner = self._runner()
        del runner._wait_candidate_services_healthy
        record = {
            "Config": {"Labels": {"com.docker.compose.service": "plugin-runner"}},
            "State": {"Running": True, "Status": "running"},
        }
        runner._docker = lambda *args, **kwargs: "container-id" if args[0] == "ps" else json.dumps([record])

        with self.assertRaisesRegex(UpdateError, "plugin-runner has no configured healthcheck"):
            runner._wait_candidate_services_healthy(["plugin-runner"], timeout=1)

    def test_candidate_service_without_version_probe_is_rejected_before_mutation(self):
        model = {"services": {
            "db": {}, "redis": {}, "migrator": {}, "backend": {}, "engine": {}, "frontend": {},
            "new-app-service": {},
        }}
        with self.assertRaisesRegex(UpdateError, "no release-version probe"):
            AtomicComposeUpdate._candidate_services_to_start(model, [])

    def test_migration_failure_restores_volumes_and_previous_compose_images(self):
        runner = self._runner(failure="migrator")
        with patch("scripts.validate_candidate_images.validate_candidate_images", return_value={
                "backend": "1.0.4", "frontend": "1.0.4", "engine": "1.0.4"}):
            with self.assertRaisesRegex(UpdateError, "previous release restored"):
                runner.run()
        self.assertTrue(any(item[0] == "restore" for item in self.commands))
        old_restore = next(item for item in self.commands if item[0] == "compose" and
                           item[1] == str(self.old) and "up" in item[2])
        self.assertIn("--wait", old_restore[2])
        journal = json.loads(runner.journal_path.read_text(encoding="utf-8"))
        self.assertEqual(journal["phase"], "rolled_back")
        self.assertFalse(runner.active_release_path.exists())
        rollback_override = runner.journal_root / f"{runner.transaction}-rollback.compose.yml"
        rollback_text = rollback_override.read_text(encoding="utf-8")
        self.assertIn('entrypoint: ["/bin/true"]', rollback_text)
        self.assertIn("command: []", rollback_text)

    def test_candidate_start_failure_captures_safe_state_then_rolls_back(self):
        runner = self._runner(failure="app-start")
        with patch("scripts.validate_candidate_images.validate_candidate_images", return_value={
                "backend": "1.0.4", "frontend": "1.0.4", "engine": "1.0.4"}):
            with self.assertRaisesRegex(UpdateError, "previous release restored"):
                runner.run()
        journal = json.loads(runner.journal_path.read_text(encoding="utf-8"))
        self.assertEqual(journal["phase"], "rolled_back")
        self.assertEqual(journal["failed_phase"], "candidate_services_starting")
        self.assertIn("injected candidate startup failure", journal["failure_reason"])
        self.assertEqual(journal["candidate_start_snapshot"][0]["service"], "backend")
        self.assertTrue(any(item[0] == "restore" for item in self.commands))


if __name__ == "__main__":
    unittest.main()
