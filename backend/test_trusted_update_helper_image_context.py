from __future__ import annotations

import os
from pathlib import Path
import subprocess


ROOT = Path(__file__).resolve().parents[1]
ALLOWLIST = ROOT / "scripts/update-runtime/bootstrap/helper-modules.txt"
RECIPE = ROOT / "scripts/update-runtime/bootstrap/Dockerfile"
BUILDER = ROOT / "scripts/build_trusted_update_helper_image.sh"


def test_bootstrap_image_copy_sources_match_the_python_allowlist():
    allowed = {line.strip() for line in ALLOWLIST.read_text().splitlines()
               if line.strip() and not line.lstrip().startswith("#")}
    copied = set()
    for line in RECIPE.read_text().splitlines():
        if line.startswith("COPY ") and "--from=" not in line:
            copied.update(line.split()[1:-1])
    assert copied == allowed
    assert "COPY ." not in RECIPE.read_text()


def test_builder_sends_only_allowlisted_files_to_docker(tmp_path):
    fake_docker = tmp_path / "docker"
    fake_docker.write_text("""#!/usr/bin/env python3
import os, sys
from pathlib import Path
args = sys.argv[1:]
if args[0] == 'build':
    context = Path(args[-1])
    allowed = {line.strip() for line in Path(os.environ['ALLOWLIST']).read_text().splitlines()
               if line.strip() and not line.lstrip().startswith('#')}
    copied = {path.relative_to(context).as_posix() for path in context.rglob('*') if path.is_file()}
    assert copied == allowed | {'Dockerfile'}
elif args[:2] == ['image', 'inspect']:
    print('sha256:' + 'a' * 64)
else:
    raise SystemExit(9)
""", encoding="utf-8")
    fake_docker.chmod(0o755)
    env = {**os.environ, "DOCKER_BIN": str(fake_docker), "ALLOWLIST": str(ALLOWLIST)}
    result = subprocess.run([str(BUILDER), "treseko-helper:test"], cwd=ROOT,
                            env=env, capture_output=True, text=True, check=False)
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip().endswith("sha256:" + "a" * 64)
