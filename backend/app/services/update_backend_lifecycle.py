"""Opt-in backend boot while the coordinator retains its post-drain API fence.

Probes can run before initialization. Business requests cannot: removing the
fence authorizes initialization, but admission waits for its successful finish.
The operator/controller, never an HTTP request, owns fence removal.
"""
import asyncio
from contextlib import suppress
import logging
import os

from .update_api_admission import UpdateAPIAdmission

logger = logging.getLogger(__name__)


class CoordinatedBackendLifecycle:
    def __init__(self, initialize, directory):
        if not directory:
            raise ValueError('Coordinated backend boot requires a dedicated API control directory')
        self.control = UpdateAPIAdmission(None, directory=directory)
        self.initialize = initialize
        self.ready = False
        self.state = 'waiting'
        self.task = None

    async def _initialize(self):
        self.state = 'initializing'
        try:
            await self.initialize()
        except asyncio.CancelledError:
            raise
        except Exception:
            self.state = 'failed'
            # Initialization exceptions can contain database/provider secrets.
            logger.error('Coordinated backend initialization failed; admission remains closed')
            raise
        else:
            self.ready = True
            self.state = 'ready'

    async def _wait_and_initialize(self):
        while self.control.blocked():
            await asyncio.sleep(.1)
        try:
            await self._initialize()
        except Exception:
            # Do not retry partially completed seeds automatically. Keep serving
            # probes for diagnosis, but never mark the API ready after failure.
            return

    async def startup(self):
        self.ready = False
        self.state = 'waiting'
        if self.control.blocked():
            self.task = asyncio.create_task(self._wait_and_initialize())
        else:
            await self._initialize()

    async def shutdown(self):
        self.ready = False
        if self.task is not None:
            self.task.cancel()
            with suppress(asyncio.CancelledError):
                await self.task
            self.task = None
        self.state = 'stopped'


def install_backend_startup(app, initialize):
    """Install exactly one initialization path; keep legacy boot as default."""
    mode = os.getenv('TRESEKO_COORDINATED_BACKEND_BOOT', 'false')
    if mode not in {'true', 'false'}:
        raise ValueError('TRESEKO_COORDINATED_BACKEND_BOOT must be true or false')
    if mode == 'false':
        app.add_middleware(UpdateAPIAdmission)
        app.on_event('startup')(initialize)
        return None
    lifecycle = CoordinatedBackendLifecycle(initialize, os.getenv('TRESEKO_BACKEND_UPDATE_CONTROL_DIR'))
    app.state.update_backend_lifecycle = lifecycle
    app.add_middleware(UpdateAPIAdmission, directory=lifecycle.control.directory,
                       ready=lambda: lifecycle.ready)
    app.on_event('startup')(lifecycle.startup)
    app.on_event('shutdown')(lifecycle.shutdown)
    return lifecycle
