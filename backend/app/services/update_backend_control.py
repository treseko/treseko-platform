"""Pinned Docker backend API fence and post-initialization readiness check.

Requires the coordinated boot bridge already installed. Does not drain requests
or jobs. Runs only under the participant's inherited host lock.
"""
from pathlib import PurePosixPath
import re

from .update_component_probe import DockerContainerProbe
from .update_transaction import TransactionFailure


CONTROL = r'''
import fcntl, json, os, pathlib, stat, sys, tempfile, urllib.request
directory, transaction, action, port = sys.argv[1:]
root = pathlib.Path(directory)
if os.environ.get('TRESEKO_BACKEND_UPDATE_CONTROL_DIR') != directory:
    raise ValueError('Control directory differs from backend configuration')
def safe(info):
    return info.st_uid in {0, os.geteuid()} and not info.st_mode & 0o022
if action == 'pause':
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
info = root.lstat()
if not stat.S_ISDIR(info.st_mode) or not safe(info):
    raise ValueError('Unsafe control directory')
# A timed-out Docker client does not prove its exec process stopped. Serialize
# controls inside the container as well; a retry cannot overtake that process.
lock_fd = os.open(root / '.backend-control.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
lock_info = os.fstat(lock_fd)
if not stat.S_ISREG(lock_info.st_mode) or not safe(lock_info):
    raise ValueError('Unsafe backend control lock')
fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
# Never take over manual/legacy maintenance, even on activation retries.
if os.path.lexists(root / '.maintenance'):
    raise ValueError('Manual maintenance remains active')
marker = root / '.treseko-update-fence'
expected = {'schema': 1, 'transaction': transaction}
def read():
    try:
        fd = os.open(marker, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except FileNotFoundError:
        return False
    with os.fdopen(fd) as source:
        info = os.fstat(source.fileno())
        if not stat.S_ISREG(info.st_mode) or not safe(info) or info.st_size > 4096:
            raise ValueError('Unsafe API fence')
        value = json.loads(source.read(4097))
    if value != expected or type(value.get('schema')) is not int:
        raise ValueError('API fence owner differs')
    return True
def ready():
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            raise ValueError('Health redirects are not permitted')
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    with opener.open('http://127.0.0.1:' + port + '/health', timeout=3) as response:
        if response.geturl() != 'http://127.0.0.1:' + port + '/health':
            raise ValueError('Health redirects are not permitted')
        raw = response.read(65537)
        if len(raw) > 65536:
            raise ValueError('Oversized health response')
        value = json.loads(raw)
        admission = response.headers.get_all('X-Treseko-Backend-Ready', [])
        if (response.status != 200 or value.get('service') != 'backend'
                or value.get('status') != 'ok' or admission not in [['true'], ['false']]):
            raise ValueError('Coordinated backend readiness unavailable')
        return admission == ['true']
owned = read()
ready()  # No mutation without a live coordinated backend protocol.
if action == 'pause' and not owned:
    fd, temporary = tempfile.mkstemp(prefix='.backend-fence-', dir=root)
    try:
        with os.fdopen(fd, 'w') as out:
            json.dump(expected, out)
            out.flush()
            os.fsync(out.fileno())
        try:
            os.link(temporary, marker)
        except FileExistsError:
            pass
        if not read():
            raise ValueError('API fence not acquired')
    finally:
        os.unlink(temporary)
elif action == 'resume' and owned:
    marker.unlink()
fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY)
try:
    os.fsync(fd)
finally:
    os.close(fd)
is_ready = ready()
if action == 'pause' and (not read() or is_ready):
    raise ValueError('API pause not observed')
print(json.dumps({'ok': True, 'transaction': transaction, 'action': action, 'ready': is_ready}))
'''


class DockerBackendControl(DockerContainerProbe):
    def __init__(self, docker, directory, port):
        super().__init__(docker)
        path = PurePosixPath(directory)
        if (not path.is_absolute() or len(path.parts) < 3 or '..' in path.parts
                or type(port) is not int or not 1 <= port <= 65535):
            raise ValueError('Explicit private backend control directory and port required')
        self.directory, self.port = directory, port

    def change(self, action, context):
        if (action not in {'pause', 'resume', 'ready'} or context.get('component') != 'backend'
                or not re.fullmatch(r'[a-f0-9]{64}', context.get('container_id', ''))
                or not re.fullmatch(r'sha256:[a-f0-9]{64}', context.get('image_id', ''))
                or not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}', context.get('transaction', ''))):
            raise ValueError('Pinned backend transaction required')
        before = self._identity(context)
        response = self._run(['exec', context['container_id'], 'python', '-c', CONTROL,
                              self.directory, context['transaction'], action, str(self.port)])
        expected = {'ok': True, 'transaction': context['transaction'], 'action': action}
        if (not isinstance(response.get('ready'), bool)
                or response != {**expected, 'ready': response['ready']}
                or self._identity(context) != before):
            raise TransactionFailure('Backend control outcome is uncertain')
        return response['ready']
