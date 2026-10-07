import tempfile
import unittest
from pathlib import Path

from installer.compose_bind_compat import (
    COMPATIBLE_MAPPING,
    LEGACY_MAPPING,
    PUBLIC_COMPATIBLE_MAPPING,
    persist_compose_bind_address,
    prepare_compose_bind_address,
)


class ComposeBindAddressCompatibilityTests(unittest.TestCase):
    def write_compose(self, root: Path, content: str) -> Path:
        compose = root / "docker-compose.prod.yml"
        compose.write_text(content, encoding="utf-8")
        return compose

    def test_backports_legacy_mapping_and_is_idempotent(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            compose = self.write_compose(root, f"services:\n  frontend:\n    ports:\n{LEGACY_MAPPING}\n")

            self.assertTrue(prepare_compose_bind_address(root))
            self.assertIn(COMPATIBLE_MAPPING, compose.read_text(encoding="utf-8"))
            self.assertFalse(prepare_compose_bind_address(root))

    def test_accepts_already_compatible_compose(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            compose = self.write_compose(root, f"services:\n  frontend:\n    ports:\n{COMPATIBLE_MAPPING}\n")
            before = compose.read_bytes()

            self.assertFalse(prepare_compose_bind_address(root))
            self.assertEqual(compose.read_bytes(), before)

    def test_accepts_already_compatible_public_bind_default(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            compose = self.write_compose(
                root,
                f"services:\n  frontend:\n    ports:\n{PUBLIC_COMPATIBLE_MAPPING}\n",
            )
            before = compose.read_bytes()

            self.assertFalse(prepare_compose_bind_address(root))
            self.assertEqual(compose.read_bytes(), before)

    def test_refuses_unknown_or_ambiguous_port_mapping(self) -> None:
        for content in (
            "services:\n  frontend:\n    ports:\n      - 9095:80\n",
            f"services:\n  frontend:\n    ports:\n{LEGACY_MAPPING}\n{LEGACY_MAPPING}\n",
        ):
            with self.subTest(content=content), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                self.write_compose(root, content)
                with self.assertRaises(ValueError):
                    prepare_compose_bind_address(root)

    def test_refuses_symlink_compose_file(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = root / "outside.yml"
            target.write_text(f"services:\n  frontend:\n    ports:\n{LEGACY_MAPPING}\n", encoding="utf-8")
            (root / "docker-compose.prod.yml").symlink_to(target)

            with self.assertRaises(ValueError):
                prepare_compose_bind_address(root)

    def test_persists_selected_bind_address_and_updates_existing_value(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            env_file = root / "compose.production.env"
            env_file.write_text("APP_ENV=production\nTRESEKO_HTTP_PORT=29123\n", encoding="utf-8")

            self.assertTrue(persist_compose_bind_address(root, "0.0.0.0"))
            self.assertIn("TRESEKO_BIND_ADDRESS=0.0.0.0", env_file.read_text(encoding="utf-8"))
            self.assertFalse(persist_compose_bind_address(root, "0.0.0.0"))
            self.assertTrue(persist_compose_bind_address(root, "127.0.0.1"))
            self.assertEqual(env_file.read_text(encoding="utf-8").count("TRESEKO_BIND_ADDRESS="), 1)

    def test_rejects_invalid_or_unsafe_bind_settings(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            env_file = root / "compose.production.env"
            env_file.write_text("APP_ENV=production\n", encoding="utf-8")
            with self.assertRaises(ValueError):
                persist_compose_bind_address(root, "0.0.0.0;rm -rf /")
            env_file.write_text("TRESEKO_BIND_ADDRESS=127.0.0.1\nTRESEKO_BIND_ADDRESS=0.0.0.0\n", encoding="utf-8")
            with self.assertRaises(ValueError):
                persist_compose_bind_address(root, "127.0.0.1")


if __name__ == "__main__":
    unittest.main()
