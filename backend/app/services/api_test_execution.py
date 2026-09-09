"""Executor boundary for API tests.

The backend owns orchestration and persistence.  The concrete executor can be
replaced by a queue/worker implementation without changing API test contracts.
"""
from __future__ import annotations

from typing import Any, Protocol

from .api_test_runner import run_api_test


class ApiTestExecutor(Protocol):
    async def execute(self, config: dict[str, Any], environment: Any, dataset_variables: dict[str, Any] | None = None, shared_variables: dict[str, Any] | None = None, dynamic_seed: int | str | None = None) -> dict[str, Any]:
        """Execute one immutable API definition and return a serializable report."""


class InProcessApiTestExecutor:
    """Default development executor; no queue or worker is required."""

    async def execute(self, config: dict[str, Any], environment: Any, dataset_variables: dict[str, Any] | None = None, shared_variables: dict[str, Any] | None = None, dynamic_seed: int | str | None = None) -> dict[str, Any]:
        return await run_api_test(config, environment, dataset_variables, shared_variables=shared_variables, dynamic_seed=dynamic_seed)


def get_api_test_executor() -> ApiTestExecutor:
    # Keep this factory as the only selection point.  A future implementation
    # can enqueue a job here and let the worker report the same result contract.
    return InProcessApiTestExecutor()
