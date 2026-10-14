from __future__ import annotations

from unittest.mock import AsyncMock, Mock

import pytest

from app.services import installation_telemetry


def test_installation_ping_requires_explicit_opt_in(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("TRESEKO_ENABLE_INSTALLATION_PING", raising=False)
    monkeypatch.delenv("TRESEKO_DISABLE_INSTALLATION_PING", raising=False)

    assert installation_telemetry.installation_ping_enabled() is False


def test_installation_ping_disable_flag_overrides_opt_in(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TRESEKO_ENABLE_INSTALLATION_PING", "true")
    monkeypatch.setenv("TRESEKO_DISABLE_INSTALLATION_PING", "1")

    assert installation_telemetry.installation_ping_enabled() is False


@pytest.mark.asyncio
async def test_first_start_does_not_send_ping_without_opt_in(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("TRESEKO_ENABLE_INSTALLATION_PING", raising=False)
    monkeypatch.delenv("TRESEKO_DISABLE_INSTALLATION_PING", raising=False)
    setting_lookup = AsyncMock()
    http_client = Mock()
    monkeypatch.setattr(installation_telemetry, "_setting_value", setting_lookup)
    monkeypatch.setattr(installation_telemetry.httpx, "AsyncClient", http_client)

    await installation_telemetry.send_installation_ping_once(None)  # type: ignore[arg-type]

    setting_lookup.assert_not_awaited()
    http_client.assert_not_called()


@pytest.mark.asyncio
async def test_explicit_opt_in_checks_existing_delivery_before_sending(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("TRESEKO_ENABLE_INSTALLATION_PING", "true")
    monkeypatch.delenv("TRESEKO_DISABLE_INSTALLATION_PING", raising=False)
    setting_lookup = AsyncMock(return_value={"status": "sent"})
    http_client = Mock()
    monkeypatch.setattr(installation_telemetry, "_setting_value", setting_lookup)
    monkeypatch.setattr(installation_telemetry.httpx, "AsyncClient", http_client)

    await installation_telemetry.send_installation_ping_once(None)  # type: ignore[arg-type]

    setting_lookup.assert_awaited_once_with(None)
    http_client.assert_not_called()
