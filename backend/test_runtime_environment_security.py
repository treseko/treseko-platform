from __future__ import annotations

import pytest

from app import runtime_environment


def test_runtime_defaults_to_production_without_environment_variables(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in ("APP_ENV", "ENVIRONMENT", "ENV"):
        monkeypatch.delenv(name, raising=False)

    assert runtime_environment.enforce_production_runtime() == "production"
    assert runtime_environment.IS_PRODUCTION is True


@pytest.mark.parametrize("name", ["APP_ENV", "ENVIRONMENT", "ENV"])
def test_runtime_rejects_non_production_environment_values(
    monkeypatch: pytest.MonkeyPatch,
    name: str,
) -> None:
    for environment_name in ("APP_ENV", "ENVIRONMENT", "ENV"):
        monkeypatch.delenv(environment_name, raising=False)
    monkeypatch.setenv(name, "development")

    with pytest.raises(RuntimeError, match="sólo se ejecuta en producción"):
        runtime_environment.enforce_production_runtime()
