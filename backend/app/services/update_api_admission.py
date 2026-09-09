"""Post-drain API/WS fence selected explicitly by the update controller.

This does not drain existing requests, sockets, schedulers or execution jobs.
It cannot replace the coordinator's ingress and workload-drain participants.
"""
import os
from pathlib import Path
import stat


class UpdateAPIAdmission:
    def __init__(self, app, *, directory=None, required=None, ready=None):
        self.app = app
        self.ready = ready
        explicit = os.getenv('TRESEKO_BACKEND_UPDATE_CONTROL_DIR')
        selected = directory if directory is not None else explicit
        self.required = True if required is None else required
        self.directory = None
        if selected is None:
            return  # Legacy startup unchanged until the controller installs this bridge.
        self.directory = Path(selected)
        if not self.directory.is_absolute() or len(self.directory.parts) < 3 or '..' in self.directory.parts:
            raise ValueError('Explicit dedicated update control directory required')

    def blocked(self):
        if self.directory is None:
            return False
        try:
            info = self.directory.lstat()
            if not stat.S_ISDIR(info.st_mode):
                return True
            if self.required and (info.st_uid not in {0, os.geteuid()} or info.st_mode & 0o022):
                return True
            for name in ('.maintenance', '.treseko-update-fence'):
                try:
                    (self.directory / name).lstat()
                    return True  # Contents are irrelevant; malformed markers also close admission.
                except FileNotFoundError:
                    pass
            return False
        except FileNotFoundError:
            # Explicit control directories must exist; loss of that mount
            # cannot reopen admission. Optional paths are only for test adapters.
            return self.required
        except OSError:
            return True

    async def __call__(self, scope, receive, send):
        kind = scope['type']
        if kind not in {'http', 'websocket'}:
            return await self.app(scope, receive, send)
        # These existing routes are read-only probes; no update mutation route
        # is exempt. Authentication rules for all other routes remain unchanged.
        probe = kind == 'http' and scope.get('method') in {'GET', 'HEAD'} and scope.get('path') in {
            '/health', '/system/version'}
        if probe and self.ready is not None:
            async def send_probe(message):
                if message['type'] == 'http.response.start':
                    # Availability of a version probe is not business readiness.
                    # Read-only receipt for coordinator activation checks.
                    headers = [(key, value) for key, value in message.get('headers', [])
                               if key.lower() != b'x-treseko-backend-ready']
                    headers.append((b'x-treseko-backend-ready',
                                    b'true' if self.ready() is True and not self.blocked() else b'false'))
                    message = {**message, 'headers': headers}
                await send(message)
            return await self.app(scope, receive, send_probe)
        if probe or (not self.blocked() and (self.ready is None or self.ready() is True)):
            return await self.app(scope, receive, send)
        if kind == 'websocket':
            await send({'type': 'websocket.close', 'code': 1013})
            return
        body = b'{"detail":"Actualizacion en curso. Intenta nuevamente mas tarde.","code":"update_maintenance"}'
        await send({'type': 'http.response.start', 'status': 503, 'headers': [
            (b'content-type', b'application/json'), (b'content-length', str(len(body)).encode()),
            (b'cache-control', b'no-store'), (b'retry-after', b'5'),
        ]})
        await send({'type': 'http.response.body', 'body': b'' if scope.get('method') == 'HEAD' else body})
