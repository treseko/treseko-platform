"""Actual backend Dockerfile, complete migrations, startup and admission control.

Fresh isolated DB only: not original 1.0.2 upgrade or multi-host certification.
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import time
from uuid import uuid4

import pytest

from app.services.update_backend_control import DockerBackendControl
from app.services.update_component_probe import DockerHttpComponentProbe
from app.services.update_transaction import TransactionFailure

pytestmark = pytest.mark.skipif(os.getenv('TRESEKO_RUN_DOCKER_UPDATE_TESTS') != '1',
                               reason='Explicit isolated Docker integration opt-in required')
ROOT = Path(__file__).resolve().parents[1]


def _remove_fixture_image(docker, image):
    """Remove only when safe; tolerate an already absent/referenced image."""
    result = subprocess.run([docker, 'image', 'rm', image], capture_output=True,
                            text=True, check=False)
    if result.returncode == 0:
        return
    inspected = subprocess.run([docker, 'image', 'inspect', image], capture_output=True,
                               text=True, check=False)
    if inspected.returncode != 0:
        return
    referenced = subprocess.run(
        [docker, 'ps', '--all', '--no-trunc', '--filter', f'ancestor={image}',
         '--format', '{{.ID}}'],
        capture_output=True, text=True, check=False,
    )
    if referenced.returncode == 0 and referenced.stdout.strip():
        return
    raise subprocess.CalledProcessError(
        result.returncode, result.args, output=result.stdout, stderr=result.stderr
    )


@pytest.fixture
def backend_image(tmp_path):
    docker = shutil.which('docker')
    assert docker
    owner = uuid4().hex
    label = 'io.treseko.backend-boot-test'
    stage = tmp_path / 'image-context'
    # Explicit source-only context. Never send local DB, static evidence, .env,
    # runtime identities, private keys or the whole checkout to Docker.
    for path in (ROOT / 'backend/app').rglob('*.py'):
        if path.relative_to(ROOT / 'backend/app').parts[0] == 'static':
            continue
        if path.is_symlink():
            raise AssertionError('Unexpected linked source')
        destination = stage / path.relative_to(ROOT)
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(path, destination)
    # Production mounts persistent evidence into this location, but the
    # source-only test context deliberately excludes user data. Starlette
    # still requires the mount point to exist when the application is built.
    (stage / 'backend/app/static').mkdir(parents=True, exist_ok=True)
    shutil.copytree(ROOT / 'backend/app/workflow_catalog', stage / 'backend/app/workflow_catalog',
                    dirs_exist_ok=True, ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
    shutil.copytree(ROOT / 'backend/alembic', stage / 'backend/alembic',
                    ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
    for name in ('requirements.txt', 'alembic.ini', 'seed_admin.py', 'reset_user_password.py',
                 'seed_demo_showcase.py', 'entrypoint.sh', 'Dockerfile', 'app/expected_schema.json'):
        shutil.copyfile(ROOT / 'backend' / name, stage / 'backend' / name)
    shutil.copyfile(ROOT / 'VERSION', stage / 'VERSION')
    iid = tmp_path / 'image-id'
    log = tmp_path / 'build.log'
    image = None
    try:
        with log.open('wb') as output:
            log.chmod(0o600)
            result = subprocess.run([docker, 'build', '--label', label + '=' + owner,
                '--iidfile', str(iid), '-f', str(stage / 'backend/Dockerfile'), str(stage)],
                stdout=output, stderr=subprocess.STDOUT, timeout=1800)
        assert result.returncode == 0, f'Backend image build failed: {log}'
        image = iid.read_text().strip()
        yield docker, image, owner, label
    finally:
        if image:
            info = json.loads(subprocess.check_output([docker, 'image', 'inspect', image]))[0]
            assert info['Config']['Labels'].get(label) == owner
            _remove_fixture_image(docker, image)


def test_real_backend_boot_defers_seeds_and_activates_after_migration(backend_image, tmp_path):
    docker, image, owner, label = backend_image
    network = 'treseko-backend-boot-' + owner[:12]
    containers = []
    network_created = False
    def run(args, *, combined=False, **kwargs):
        result = subprocess.run([docker, *args], capture_output=True, timeout=120, **kwargs)
        if result.returncode:
            failure = tmp_path / ('command-failure-' + uuid4().hex + '.log')
            failure.write_bytes(result.stdout + result.stderr)
            failure.chmod(0o600)
            pytest.fail(f'Docker fixture operation failed ({args[0]}), private log: {failure}')
        return result.stdout + result.stderr if combined else result.stdout
    def start(args):
        container = run(['run', '--detach', '--label', label + '=' + owner, *args]).decode().strip()
        containers.append(container)
        return container
    try:
        run(['network', 'create', '--internal', '--label', label + '=' + owner, network])
        network_created = True
        db = start(['--network', network, '--network-alias', 'db', '--tmpfs', '/var/lib/postgresql/data',
                    '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:15-alpine'])
        deadline = time.monotonic() + 30
        while subprocess.run([docker, 'exec', db, 'pg_isready', '-U', 'postgres'], capture_output=True).returncode:
            assert time.monotonic() < deadline, 'Isolated PostgreSQL did not start'
            time.sleep(.1)
        env = ['-e', 'DATABASE_URL=postgresql+asyncpg://postgres@db/postgres',
               '-e', 'TRESEKO_DISABLE_INSTALLATION_PING=1', '-e', 'AUTO_BACKUP_ENABLED=false',
               '-e', 'SECRET_KEY=' + uuid4().hex + uuid4().hex,
               '-e', 'TRESEKO_ALLOW_SCHEMA_CREATE_ALL=false', '-e', 'APP_ENV=production']
        run(['run', '--rm', '--label', label + '=' + owner, '--network', network, *env, image, 'migrate-only'])
        def sql(statement):
            return run(['exec', db, 'psql', '-U', 'postgres', '-At', '-c', statement]).decode().strip()
        expected = json.loads((ROOT / 'backend/app/expected_schema.json').read_text())['revision']
        assert sql('SELECT version_num FROM alembic_version') == expected
        counts = 'SELECT (SELECT count(*) FROM ai_workflows), (SELECT count(*) FROM ai_agent_presets), (SELECT count(*) FROM notification_templates)'
        before = sql(counts)
        control = tmp_path / 'control'
        control.mkdir(mode=0o700)
        (control / '.treseko-update-fence').write_text(json.dumps({'schema': 1, 'transaction': 'real-backend'}))
        backend = start(['--network', network, '--label', 'com.docker.compose.project=' + owner,
                         '--label', 'com.docker.compose.service=backend', *env,
                         '-e', 'TRESEKO_BACKEND_UPDATE_CONTROL_DIR=/state/backend/control',
                         '--mount', f'type=bind,source={control},target=/state/backend/control',
                         image, 'coordinated-serve'])
        context = {'component': 'backend', 'container_id': backend, 'image_id': image,
                   'transaction': 'real-backend', 'project': owner, 'service': 'backend'}
        probe = DockerHttpComponentProbe(docker, 'backend', 8000)
        controller = DockerBackendControl(docker, '/state/backend/control', 8000)
        def wait_for_backend():
            deadline = time.monotonic() + 60
            while True:
                try:
                    assert probe.probe(context) == (ROOT / 'VERSION').read_text().strip()
                    return
                except (TransactionFailure, ValueError):
                    assert json.loads(run(['inspect', backend]))[0]['State']['Running'], 'Backend exited; see private fixture logs'
                    assert time.monotonic() < deadline, 'Backend probe unavailable; inspect owned fixture logs'
                    time.sleep(.2)
        wait_for_backend()
        assert controller.change('pause', context) is False
        assert sql(counts) == before, 'Fenced boot must not execute startup seeds'
        original_start = json.loads(run(['inspect', backend]))[0]['State']['StartedAt']
        run(['restart', backend])
        wait_for_backend()
        assert json.loads(run(['inspect', backend]))[0]['State']['StartedAt'] != original_start
        assert controller.change('ready', context) is False
        assert sql(counts) == before, 'Restart while fenced must not initialize the database'
        def status():
            return run(['exec', backend, 'curl', '-s', '-o', '/dev/null', '-w', '%{http_code}',
                        'http://127.0.0.1:8000/system/edition']).decode()
        assert status() == '503'
        ready = controller.change('resume', context)
        deadline = time.monotonic() + 60
        while not ready:
            assert time.monotonic() < deadline, 'Backend initialization never became ready'
            time.sleep(.2)
            ready = controller.change('ready', context)
        assert status() == '401', 'Activated API must retain authentication'
        seeded = sql(counts)
        assert all(int(count) > 0 for count in seeded.split('|')), f'Actual startup seeds must exist: {seeded}'
        assert sql('SELECT version_num FROM alembic_version') == expected
        assert controller.change('pause', context) is False
        assert status() == '503'
    finally:
        # A Docker client timeout does not stop its one-shot migrator. Include
        # any remaining container with this exact fixture ownership label.
        for remaining in run(['ps', '--all', '--quiet', '--no-trunc', '--filter',
                              'label=' + label + '=' + owner]).decode().split():
            if remaining not in containers:
                containers.append(remaining)
        for container in reversed(containers):
            info = json.loads(run(['inspect', container]))[0]
            assert info['Config']['Labels'].get(label) == owner
            log = tmp_path / (container[:12] + '.log')
            log.write_bytes(run(['logs', container], combined=True))
            log.chmod(0o600)
            run(['rm', '--force', '--volumes', container])
        if network_created:
            info = json.loads(run(['network', 'inspect', network]))[0]
            assert info['Labels'].get(label) == owner
            run(['network', 'rm', network])
