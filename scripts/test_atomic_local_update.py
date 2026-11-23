from __future__ import annotations

import hashlib
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

from scripts.atomic_local_update import (AtomicComposeUpdate, UpdateError,
                                         _existing_compose_sources, _normalize_compose_host_path,
                                         _safe_failure_summary)


class AtomicLocalUpdateTests(unittest.TestCase):
    def test_tags_running_container_when_docker_pruned_its_source_image(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            candidate = root / "candidate"
            candidate.mkdir()
            (candidate / "VERSION").write_text("1.0.8\n", encoding="utf-8")
            (candidate / "docker-compose.prod.yml").write_text("services: {}\n", encoding="utf-8")
            env = root / "compose.production.env"
            env.write_text("TRESEKO_COMPOSE_PROJECT_NAME=treseko-test\n", encoding="utf-8")
            updater = AtomicComposeUpdate(docker="/usr/bin/docker", project="treseko-test",
                                          candidate_root=candidate, install_root=root,
                                          env_file=env, expected_version="1.0.8",
                                          transaction_id="qa-pruned-image")
            calls = []

            def docker(*args, **kwargs):
                calls.append(args)
                if args[:2] == ("image", "tag"):
                    raise UpdateError("No such image")
                return "sha256:preserved-container-image"

            updater._docker = docker
            record = {"Id": "container-id", "Image": "sha256:missing-image",
                      "Config": {"Labels": {"com.docker.compose.service": "backend"}}}
            images = updater._tag_old_images([record], {"services": {"backend": {}}})
            tag = "treseko-rollback:qa-pruned-image-backend"
            self.assertEqual(images, {"backend": tag})
            self.assertEqual(calls, [("image", "tag", "sha256:missing-image", tag),
                                     ("commit", "container-id", tag)])

    def test_existing_compose_sources_unions_service_specific_host_overrides(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            project = root / "release"
            state = root / ".treseko-local" / "update-transactions"
            base = project / "docker-compose.prod.yml"
            candidate = state / "20261118123456-abcdef12-atomic-candidate.compose.yml"
            rolled_back = state / "qa-current-single-file-ota-20261120-rollback.compose.yml"
            coordinated = root / ".config" / "treseko" / "coordinated.override.yaml"
            labels = lambda *paths: {
                "com.docker.compose.project.working_dir": str(project),
                "com.docker.compose.project.config_files": ",".join(map(str, paths)),
            }
            records = [
                {"Config": {"Labels": labels(base, candidate, rolled_back, coordinated)}},
                {"Config": {"Labels": labels(base, candidate, rolled_back)}},
            ]
            workdir, files = _existing_compose_sources(records, state)
            self.assertEqual(workdir, project)
            self.assertEqual(files, [str(base), str(coordinated)])

    def test_existing_compose_sources_rejects_different_base_files(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            records = [
                {"Config": {"Labels": {"com.docker.compose.project.working_dir": str(root),
                                         "com.docker.compose.project.config_files": str(root / "a.yml")}}},
                {"Config": {"Labels": {"com.docker.compose.project.working_dir": str(root),
                                         "com.docker.compose.project.config_files": str(root / "b.yml")}}},
            ]
            with self.assertRaisesRegex(UpdateError, "base file identity is ambiguous"):
                _existing_compose_sources(records, root / ".treseko-local" / "update-transactions")

    def test_wsl_normalizes_windows_compose_source_paths(self):
        with patch("scripts.atomic_local_update._is_wsl_host", return_value=True):
            self.assertEqual(_normalize_compose_host_path(r"C:\Treseko\docker-compose.prod.yml"),
                             "/mnt/c/Treseko/docker-compose.prod.yml")
            self.assertEqual(_normalize_compose_host_path(r"D:\Data\custom.yaml"),
                             "/mnt/d/Data/custom.yaml")

    def test_non_wsl_keeps_compose_source_paths_unchanged(self):
        with patch("scripts.atomic_local_update._is_wsl_host", return_value=False):
            source = r"C:\Treseko\docker-compose.prod.yml"
            self.assertEqual(_normalize_compose_host_path(source), source)

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

    def test_release_snapshot_keeps_vendored_worker_dist_and_ignores_generated_dist(self):
        runner = self._runner()
        candidate = runner.candidate_root
        vendored = candidate / "automation-worker" / "vendor" / "node-forge" / "dist"
        generated = candidate / "frontend" / "dist"
        vendored.mkdir(parents=True, exist_ok=True)
        generated.mkdir(parents=True, exist_ok=True)
        (vendored / "forge.min.js").write_text("vendored dependency", encoding="utf-8")
        (generated / "index.html").write_text("generated frontend", encoding="utf-8")

        release_files = {path.relative_to(candidate).as_posix()
                         for path in runner._release_files(candidate)}
        self.assertIn("automation-worker/vendor/node-forge/dist/forge.min.js", release_files)
        self.assertNotIn("frontend/dist/index.html", release_files)
        self.assertNotIn("dist", runner._release_ignored(str(vendored.parent), ["dist"]))
        self.assertIn("dist", runner._release_ignored(str(generated.parent), ["dist"]))

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

    def test_candidate_compose_retains_host_owned_overrides(self):
        runner = self._runner()
        host_override = self.old / "qa-coordinated-worker.override.json"
        host_override.write_text(
            '{"services":{"backend":{"environment":{"TRESEKO_UPDATE_MODE":"coordinated"}}}}',
            encoding="utf-8",
        )
        old_model = {"services": {name: {} for name in
                     ("db", "redis", "migrator", "backend", "engine", "frontend")}}
        runner._running_inventory = lambda: (
            self.records, [], self.old, [str(self.old / "compose.yml"), str(host_override)], old_model,
        )

        runner._validate_candidate()

        self.assertEqual(runner.preserved_compose_overrides, [str(host_override.resolve())])
        self.assertEqual(runner._candidate_compose_files(), [
            str(runner.candidate_root / "docker-compose.prod.yml"),
            str(host_override.resolve()),
            str(runner.candidate_override),
        ])

    def test_candidate_compose_ignores_generated_transaction_overrides(self):
        runner = self._runner()
        host_override = self.old / "qa-coordinated-worker.override.json"
        host_override.write_text("{}", encoding="utf-8")
        # The host coordinator may store journals outside the installation root.
        transaction_dir = self.root / "coordinator-state" / ".treseko-local" / "update-transactions"
        transaction_dir.mkdir(parents=True)
        generated = [
            transaction_dir / "txn-1-rollback.compose.yml",
            transaction_dir / "txn-2-atomic-candidate.compose.yml",
        ]
        for path in generated:
            path.write_text("{}", encoding="utf-8")
        old_files = [str(self.old / "docker-compose.prod.yml"), str(host_override),
                     *(str(path) for path in generated)]

        self.assertEqual(
            runner._host_compose_overrides(self.old, old_files),
            [str(host_override.resolve())],
        )

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

    def test_legacy_coordinator_state_keeps_journal_separate_from_active_install(self):
        state_root = self.root / "controller-state"
        state_root.mkdir(mode=0o700)
        project_root = self.root / "installed-project"
        local_state = project_root / ".treseko-local"
        local_state.mkdir(parents=True, mode=0o700)
        (local_state / "active-release.json").write_text('{"schema":1}\n', encoding="utf-8")

        runner = AtomicComposeUpdate(docker="docker", project="treseko-test",
                                     candidate_root=self.candidate, install_root=state_root,
                                     env_file=self.env, expected_version="1.0.4",
                                     expected_project_root=project_root)

        self.assertEqual(runner.install_root, project_root.resolve())
        self.assertEqual(runner.state_root, state_root.resolve())
        self.assertEqual(runner.active_release_path,
                         project_root.resolve() / ".treseko-local" / "active-release.json")
        self.assertEqual(runner.journal_root,
                         state_root.resolve() / ".treseko-local" / "update-transactions")

    def test_preflight_accepts_compose_root_from_verified_active_release(self):
        runner = self._runner()
        legacy = self.root / "project"
        runner.expected_project_root = legacy
        active = runner.release_root / "1.0.3-verified"
        active.parent.mkdir(parents=True)
        shutil.copytree(runner.candidate_root, active)
        (active / "VERSION").write_text("1.0.3\n", encoding="utf-8")
        manifest = runner._release_manifest(active, "1.0.3")
        runner._write_atomic_json(active / ".treseko-release.json", manifest)
        runner._write_atomic_json(runner.active_release_path, {
            "schema": 1, "version": "1.0.3", "release": active.name,
            "tree_sha256": manifest["tree_sha256"],
        })
        runner._running_inventory = lambda: (
            self.records, [], active, [str(active / "docker-compose.prod.yml")],
            {"services": {name: {} for name in
             ("db", "redis", "migrator", "backend", "engine", "frontend")}},
        )

        result = runner._validate_candidate()

        self.assertEqual(result["old_workdir"], active)
        self.assertEqual(self.commands, [])

    def test_preflight_rejects_workdir_that_is_neither_initial_nor_active_release(self):
        runner = self._runner()
        runner.expected_project_root = self.root / "initial-project"
        active = runner.release_root / "1.0.3-verified"
        active.parent.mkdir(parents=True)
        shutil.copytree(runner.candidate_root, active)
        (active / "VERSION").write_text("1.0.3\n", encoding="utf-8")
        manifest = runner._release_manifest(active, "1.0.3")
        runner._write_atomic_json(active / ".treseko-release.json", manifest)
        runner._write_atomic_json(runner.active_release_path, {
            "schema": 1, "version": "1.0.3", "release": active.name,
            "tree_sha256": manifest["tree_sha256"],
        })

        with self.assertRaisesRegex(UpdateError, "differs from its private host binding"):
            runner._validate_candidate()

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

    def test_active_release_accepts_legacy_manifest_filter_and_still_detects_tampering(self):
        runner = self._runner()
        active = runner.release_root / "1.0.7-legacy-filter"
        active.mkdir(parents=True)
        for source in runner.candidate_root.iterdir():
            if source.is_dir():
                shutil.copytree(source, active / source.name)
            else:
                shutil.copy2(source, active / source.name)
        (active / "VERSION").write_text("1.0.7\n", encoding="utf-8")
        (active / ".gitignore").write_text("legacy root metadata\n", encoding="utf-8")
        nested = active / "public-release" / "treseko-platform" / "README.md"
        nested.parent.mkdir(parents=True)
        nested.write_text("legacy nested source snapshot\n", encoding="utf-8")
        worker_identity = active / "automation-worker" / ".worker-instance-id"
        worker_identity.parent.mkdir(parents=True, exist_ok=True)
        worker_identity.write_text("legacy local worker identity\n", encoding="utf-8")

        digest = hashlib.sha256()
        rows = []
        files = [*runner._release_files(active), active / ".gitignore", nested, worker_identity]
        for path in sorted(files, key=lambda item: item.relative_to(active).as_posix()):
            relative = path.relative_to(active).as_posix()
            file_hash = hashlib.sha256(path.read_bytes()).hexdigest()
            mode = path.stat().st_mode & 0o7777
            rows.append({"path": relative, "sha256": file_hash, "mode": mode})
            digest.update(relative.encode("utf-8"))
            digest.update(b"\0")
            digest.update(bytes.fromhex(file_hash))
            digest.update(f"{mode:o}".encode("ascii"))
            digest.update(b"\0")
        manifest = {"schema": 1, "version": "1.0.7",
                    "tree_sha256": digest.hexdigest(), "files": rows}
        runner._write_atomic_json(active / ".treseko-release.json", manifest)
        runner._write_atomic_json(runner.active_release_path, {
            "schema": 1, "version": "1.0.7", "release": active.name,
            "tree_sha256": manifest["tree_sha256"],
        })

        self.assertEqual(runner._active_release_version(), "1.0.7")
        worker_identity.write_text("changed local worker identity\n", encoding="utf-8")
        with self.assertRaisesRegex(UpdateError, "file-integrity check"):
            runner._active_release_version()
        worker_identity.write_text("legacy local worker identity\n", encoding="utf-8")
        (active / ".gitignore").write_text("tampered legacy metadata\n", encoding="utf-8")
        with self.assertRaisesRegex(UpdateError, "file-integrity check"):
            runner._active_release_version()

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
                **{name: ({"healthcheck": {"test": ["CMD", "true"]}}
                          if name in {"db", "redis", "backend", "engine", "frontend"} else {})
                   for name in ("db", "redis", "migrator", "backend", "engine", "frontend")},
                "automation-worker": {"profiles": ["automation"]},
                "plugin-runner": {"profiles": ["plugins"],
                                  "healthcheck": {"test": ["CMD", "true"]}},
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
            if failure == "build" and Path(root).resolve() == runner.candidate_root and args == ("build",):
                raise UpdateError("injected dependency installation/build failure")
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

    def test_dependency_install_build_failure_does_not_stop_active_release(self):
        runner = self._runner(failure="build")
        with self.assertRaisesRegex(UpdateError, "dependency installation/build failure"):
            runner.run()
        compose_commands = [item[2] for item in self.commands if item[0] == "compose"]
        self.assertEqual(compose_commands[0], ("build",))
        self.assertFalse(any("stop" in command or "migrator" in command
                             for command in compose_commands))
        journal = json.loads(runner.journal_path.read_text(encoding="utf-8"))
        self.assertEqual(journal["phase"], "preparing")

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

    def test_plugin_runner_without_candidate_healthcheck_gets_managed_override(self):
        runner = self._runner()
        self.records.append({
            "Id": "container-plugin-runner", "Image": "sha256:" + "e" * 64,
            "State": {"Running": True, "Health": {"Status": "healthy"}},
            "Config": {"Labels": {"com.docker.compose.project": "treseko-test",
                                   "com.docker.compose.service": "plugin-runner",
                                   "com.docker.compose.oneoff": "False"}},
            "Mounts": [],
        })
        candidate = runner._compose_model(self.candidate, [], [], self.candidate)
        candidate["services"]["plugin-runner"] = {"profiles": ["plugins"]}
        effective = json.loads(json.dumps(candidate))
        effective["services"]["plugin-runner"]["healthcheck"] = {
            "test": ["CMD", "node", "-e", "fetch('http://127.0.0.1:3020/health')"],
        }
        compose_calls = []

        def compose_model(root, files, profiles, project_directory):
            compose_calls.append((files, profiles))
            return effective if len(compose_calls) > 1 else candidate

        runner._compose_model = compose_model
        runner._running_inventory = lambda: (
            self.records, ["plugins"], self.old, [str(self.old / "compose.yml")],
            {"services": {name: {} for name in (
                "db", "redis", "migrator", "backend", "engine", "frontend", "plugin-runner")}},
        )

        runner._validate_candidate()

        self.assertEqual(self.commands, [])
        self.assertEqual(len(compose_calls), 2)
        override = runner.candidate_override.read_text(encoding="utf-8")
        self.assertIn("Treseko managed Plugin Runner healthcheck", override)
        self.assertIn("http://127.0.0.1:3020/health", override)
        self.assertEqual(runner.candidate_override.stat().st_mode & 0o777, 0o600)

    def test_success_snapshots_then_migrates_then_starts_complete_project(self):
        runner = self._runner()
        with patch("scripts.validate_candidate_images.validate_candidate_images", return_value={
                "backend": "1.0.4", "frontend": "1.0.4", "engine": "1.0.4"}):
            runner.run()
        compose_commands = [item[2] for item in self.commands if item[0] == "compose"]
        stop = next(index for index, command in enumerate(compose_commands) if "stop" in command)
        frontend_stop = next(index for index, item in enumerate(self.commands)
                             if item[0] == "docker" and item[1][:3] == ("kill", "--signal", "SIGTERM"))
        frontend_wait = next(index for index, item in enumerate(self.commands)
                             if item[0] == "docker" and item[1][:1] == ("wait",))
        migration = next(index for index, command in enumerate(compose_commands) if command[:3] == ("run", "--rm", "migrator"))
        app_start = next(index for index, command in enumerate(compose_commands)
                         if "--remove-orphans" in command)
        self.assertLess(stop, migration)
        compose_stop_command_index = next(index for index, item in enumerate(self.commands)
                                          if item[0] == "compose" and "stop" in item[2])
        self.assertLess(frontend_stop, compose_stop_command_index)
        self.assertLess(frontend_stop, frontend_wait)
        self.assertLess(frontend_wait, compose_stop_command_index)
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

    def test_automation_worker_candidate_without_healthcheck_is_rejected(self):
        runner = self._runner()
        del runner._wait_candidate_services_healthy
        record = {
            "Config": {"Labels": {"com.docker.compose.service": "automation-worker"}},
            "State": {"Running": True, "Status": "running"},
        }
        runner._docker = lambda *args, **kwargs: "container-id" if args[0] == "ps" else json.dumps([record])

        with self.assertRaisesRegex(UpdateError, "automation-worker has no configured healthcheck"):
            runner._wait_candidate_services_healthy(["automation-worker"], timeout=1)

    def test_candidate_plugin_runner_without_docker_healthcheck_uses_http_probe(self):
        runner = self._runner()
        del runner._wait_candidate_services_healthy
        record = {
            "Id": "plugin-container",
            "Config": {"Labels": {"com.docker.compose.service": "plugin-runner"}},
            "State": {"Running": True, "Status": "running"},
        }
        calls = []

        def docker(*args, **kwargs):
            calls.append((args, kwargs))
            if args[0] == "ps":
                return "container-id"
            if args[0] == "inspect":
                return json.dumps([record])
            return ""

        runner._docker = docker

        runner._wait_candidate_services_healthy(["plugin-runner"], timeout=1)
        probe = next(call for call in calls if call[0][0] == "exec")
        self.assertIn("http://127.0.0.1:3020/health", probe[0][4])

    def test_candidate_plugin_runner_failed_http_probe_rejects_candidate(self):
        runner = self._runner()
        del runner._wait_candidate_services_healthy
        record = {
            "Id": "plugin-container",
            "Config": {"Labels": {"com.docker.compose.service": "plugin-runner"}},
            "State": {"Running": True, "Status": "running"},
        }

        def docker(*args, **kwargs):
            if args[0] == "ps":
                return "container-id"
            if args[0] == "inspect":
                return json.dumps([record])
            raise UpdateError("HTTP 503")

        runner._docker = docker
        with self.assertRaisesRegex(UpdateError, "Candidate plugin-runner HTTP health probe failed"):
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
