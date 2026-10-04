"""CLI wiring regression for the cross-platform atomic update path."""
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]


class LocalUpdateDispatchTests(unittest.TestCase):
    def test_bash_and_powershell_dispatch_to_the_same_atomic_coordinator(self):
        bash = (ROOT / "scripts/install_local_treseko.sh").read_text(encoding="utf-8")
        powershell = (ROOT / "scripts/install_local_treseko.ps1").read_text(encoding="utf-8")
        for content in (bash, powershell):
            self.assertIn("atomic_local_update.py", content)
            self.assertIn("--candidate-root", content)
            self.assertIn("--install-root", content)
            self.assertIn("--env-file", content)
            self.assertIn("--version", content)
        self.assertIn('"${REPO_ROOT}/scripts/atomic_local_update.py"', bash)
        self.assertIn("$atomicUpdateScript", powershell)
        self.assertIn("TRESEKO_COMPOSE_PROJECT_NAME=%s", bash)
        self.assertIn("TRESEKO_COMPOSE_PROJECT_NAME=$ProjectName", powershell)

    def test_powershell_captures_native_compose_stderr_without_masking_exit_code(self):
        powershell = (ROOT / "scripts/install_local_treseko.ps1").read_text(encoding="utf-8")
        self.assertIn("@Arguments 2>&1", powershell)
        self.assertIn('$ErrorActionPreference = "Continue"', powershell)
        self.assertIn("$composePreference = $ErrorActionPreference", powershell)
        self.assertIn("$composeExitCode = $LASTEXITCODE", powershell)
        self.assertIn("if ($composeExitCode -ne 0)", powershell)


if __name__ == "__main__":
    unittest.main()
