"""Hermetic HTTP contract for governed automation-script validation."""

from __future__ import annotations

from uuid import uuid4

from fastapi.testclient import TestClient

from app.database import engine
from app.main import app
from test_api_project_http_flow import _create_admin, _login


def test_script_validation_accepts_a_valid_playwright_contract_over_http():
    suffix = uuid4().hex
    email = f"script-validation-{suffix}@example.test"
    password = "ScriptValidationPassword-2026!"
    _create_admin(email, password)

    with TestClient(app, raise_server_exceptions=False) as client:
        headers = _login(client, email, password)
        response = client.post(
            "/scripts/validate/",
            headers=headers,
            json={
                "framework": "playwright:javascript",
                "tipo_prueba": "AUTOMATIZADA",
                "titulo": "Inicio de sesión válido",
                "script": "const { test, expect } = require('@playwright/test'); test('login', async ({ page }) => { await page.goto('https://example.test/login'); await expect(page).toHaveTitle(/login/i); });",
                "pasos": [{"accion": "Abrir login", "datos": "usuario=qa", "resultado_esperado": "Se muestra la pantalla"}],
            },
        )
        assert response.status_code == 200, response.text
        assert response.json()["valid"] is True
        assert any("Framework reconocido" in check for check in response.json()["checks"])
        client.portal.call(engine.dispose)
