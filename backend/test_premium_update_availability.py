"""Premium update discovery distinguishes an up-to-date client from errors."""

from __future__ import annotations

import asyncio
import json

import httpx
import pytest

from app.services.premium_runtime import verification_client


def test_premium_latest_no_update_is_a_typed_outcome(monkeypatch):
    reason = "No hay una version posterior aplicable para este canal."

    def respond(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content)
        assert payload["current_version"] == "1.0.7"
        assert request.url.path == "/api/updates/premium/latest"
        return httpx.Response(200, json={"available": False, "reason": reason})

    monkeypatch.setattr(
        verification_client, "_remote_license_payload", lambda _license: {"license_id": "fixture"}
    )
    monkeypatch.setattr(verification_client, "_license_signature", lambda _license: None)
    monkeypatch.setattr(verification_client, "get_or_create_instance_id", lambda: "fixture-instance")

    async def request_latest():
        await verification_client.fetch_latest_premium_update_manifest(
            {"activation_token": "fixture-token"},
            current_version="1.0.7",
            update_server_url="https://updates.example.test",
            transport=httpx.MockTransport(respond),
        )

    with pytest.raises(verification_client.PremiumUpdateUnavailable, match="version posterior"):
        asyncio.run(request_latest())
