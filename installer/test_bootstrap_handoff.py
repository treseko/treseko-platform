"""Regression tests for carrying package and installed-data roots separately."""

from pathlib import Path
import tempfile
import unittest

from installer.bootstrap import build_gui_handoff_args, publish_release_tree


class BootstrapHandoffTests(unittest.TestCase):
    def test_release_tree_is_published_as_one_immutable_directory(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            cache = root / "packages"
            cache.mkdir()
            staging = cache / ".download" / "extract" / "treseko"
            staging.mkdir(parents=True)
            (staging / "VERSION").write_text("1.0.4\n", encoding="utf-8")
            target = cache / "treseko-community-v1.0.4"

            self.assertEqual(publish_release_tree(staging, target), target)
            self.assertEqual((target / "VERSION").read_text(encoding="utf-8"), "1.0.4\n")
            self.assertFalse(staging.exists())
            with self.assertRaises(FileExistsError):
                publish_release_tree(target, target)
            self.assertEqual((target / "VERSION").read_text(encoding="utf-8"), "1.0.4\n")

    def test_release_tree_rejects_existing_or_symlink_target_without_mutation(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            cache = root / "packages"
            cache.mkdir()
            target = cache / "treseko-community-v1.0.4"
            target.mkdir()
            (target / "VERSION").write_text("previous\n", encoding="utf-8")
            staging = cache / ".staging"
            staging.mkdir()
            (staging / "VERSION").write_text("1.0.4\n", encoding="utf-8")

            with self.assertRaises(FileExistsError):
                publish_release_tree(staging, target)
            self.assertTrue(staging.is_dir())
            self.assertEqual((target / "VERSION").read_text(encoding="utf-8"), "previous\n")

    def test_relaunch_uses_new_package_and_preserves_existing_install_root(self) -> None:
        package = Path("/qa/cache/packages/1.0.4")
        install = Path("/qa/installed/1.0.3")
        command = build_gui_handoff_args(
            "/usr/bin/python3",
            package / "installer" / "treseko_installer.py",
            package,
            install,
            "41903",
            "update",
            False,
        )

        self.assertEqual(command[2:6], ["--package", str(package), "--installation-root", str(install)])
        self.assertEqual(command[-4:], ["--port", "41903", "--mode", "update"])

    def test_relaunch_preserves_demo_flag(self) -> None:
        root = Path("/qa/packages/1.0.4")
        command = build_gui_handoff_args(
            "/usr/bin/python3",
            root / "installer" / "treseko_installer.py",
            root,
            root,
            "9095",
            "new",
            True,
        )

        self.assertEqual(command[-1], "--demo")


if __name__ == "__main__":
    unittest.main()
