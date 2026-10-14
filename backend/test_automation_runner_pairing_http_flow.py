"""HTTP flow for the Community local-worker pairing handshake."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from uuid import uuid4

import psycopg
from fastapi.testclient import TestClient


BACKEND_DIR = Path(__file__).resolve().parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app import auth  # noqa: E402
from app.api.routers import automation as automation_router  # noqa: E402
from app.api.routers import projects as projects_router  # noqa: E402
from app.database import DATABASE_URL, engine  # noqa: E402
from app.repositories import project_write_policy
from app.main import app  # noqa: E402
from app.repositories import test_runs_automation_runners as runner_repository  # noqa: E402


def _seed_admin(email: str, password: str) -> None:
    database_url = DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://", 1)
    with psycopg.connect(database_url) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO usuarios (
                    id, email, hashed_password, nombre_completo, rol, activo,
                    auth_provider, modulos, permisos, permisos_detallados,
                    avatar_provider, profile_settings, personal_theme,
                    project_theme_overrides, session_version
                ) VALUES (
                    %s, %s, %s, %s, 'ADMIN', TRUE, 'local', %s::json, %s::json, %s::json,
                    'gravatar', %s::json, 'system', %s::json, 0
                )
                """,
                (uuid4(), email, auth.get_password_hash(password), "Worker pairing admin", json.dumps([]), json.dumps({}), json.dumps({}), json.dumps({}), json.dumps({})),
            )


async def _allow_controlled_worker_limit(*_args, **_kwargs) -> None:
    """Exercise token registration beside pairing without altering production limits."""


def test_local_worker_pairing_approval_poll_and_heartbeat_flow(monkeypatch):
    monkeypatch.setattr(automation_router, "enforce_limit", _allow_controlled_worker_limit)
    monkeypatch.setattr(project_write_policy, "enforce_limit", _allow_controlled_worker_limit)
    monkeypatch.setattr(
        automation_router.crud,
        "_enforce_worker_limit_for_solution",
        _allow_controlled_worker_limit,
    )
    monkeypatch.setattr(runner_repository, "enforce_limit", _allow_controlled_worker_limit)
    suffix = uuid4().hex
    email = f"runner-flow-{suffix}@example.test"
    password = "RunnerFlowPassword-2026!"
    _seed_admin(email, password)

    with TestClient(app, raise_server_exceptions=False) as client:
        login = client.post("/auth/login/", data={"username": email, "password": password})
        assert login.status_code == 200, login.text
        admin_headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

        # Community intentionally allows one organization.  The complete
        # integration suite may already have created it, so this flow must not
        # depend on test ordering merely to obtain a valid pairing scope.
        organizations = client.get("/organizaciones/", headers=admin_headers)
        assert organizations.status_code == 200, organizations.text
        if organizations.json():
            organization_id = organizations.json()[0]["id"]
        else:
            organization = client.post(
                "/organizaciones/",
                headers=admin_headers,
                json={"nombre": f"Runner organization {suffix}", "tipo": "Interna"},
            )
            assert organization.status_code == 200, organization.text
            organization_id = organization.json()["id"]

        pairing = client.post(
            "/automation-runners/pairing-requests",
            json={
                "nombre": "CI local worker",
                "tipo": "LOCAL",
                "organizacion_id": organization_id,
                "capabilities": {"frameworks": ["playwright"], "platform": "linux"},
            },
        )
        assert pairing.status_code == 200, pairing.text
        pairing_payload = pairing.json()
        code = pairing_payload["code"]
        pairing_token = pairing_payload["pairing_token"]

        denied_pairing = client.post(
            "/automation-runners/pairing-requests",
            json={
                "nombre": "Rejected local worker",
                "tipo": "LOCAL",
                "organizacion_id": organization_id,
                "capabilities": {"frameworks": ["playwright"]},
            },
        )
        assert denied_pairing.status_code == 200, denied_pairing.text
        denied = client.post(
            f"/automation-runners/pairing-requests/{denied_pairing.json()['code']}/deny",
            headers=admin_headers,
        )
        assert denied.status_code == 200, denied.text
        assert denied.json()["estado"] == "DENIED"

        missing_pairing_token = client.get(f"/automation-runners/pairing-requests/{code}")
        assert missing_pairing_token.status_code == 400

        pending = client.get("/automation-runners/pairing-requests/", headers=admin_headers)
        assert pending.status_code == 200, pending.text
        assert code in {item["code"] for item in pending.json()}

        approved = client.post(f"/automation-runners/pairing-requests/{code}/approve", headers=admin_headers)
        assert approved.status_code == 200, approved.text
        assert approved.json()["estado"] == "APPROVED"

        polled = client.get(
            f"/automation-runners/pairing-requests/{code}",
            headers={"X-Pairing-Token": pairing_token},
        )
        assert polled.status_code == 200, polled.text
        runner_token = polled.json()["runner_token"]
        runner_id = polled.json()["runner"]["id"]
        assert runner_token

        runners = client.get("/automation-runners/", headers=admin_headers)
        assert runners.status_code == 200, runners.text
        assert runner_id in {item["id"] for item in runners.json()}
        updated_runner = client.patch(
            f"/automation-runners/{runner_id}",
            headers=admin_headers,
            json={"nombre": "CI local worker updated"},
        )
        assert updated_runner.status_code == 200, updated_runner.text
        assert updated_runner.json()["nombre"] == "CI local worker updated"

        runner_headers = {"X-Runner-Token": runner_token}
        profile = client.get("/automation-runners/me", headers=runner_headers)
        assert profile.status_code == 200, profile.text
        assert profile.json()["id"] == runner_id

        wrong_heartbeat = client.post(
            f"/automation-runners/{uuid4()}/heartbeat",
            headers=runner_headers,
            json={"estado": "ONLINE"},
        )
        assert wrong_heartbeat.status_code == 403

        heartbeat = client.post(
            f"/automation-runners/{runner_id}/heartbeat",
            headers=runner_headers,
            json={"estado": "ONLINE", "active_jobs": 0},
        )
        assert heartbeat.status_code == 200, heartbeat.text
        assert heartbeat.json()["estado"] == "ONLINE"

        # Always create the project in the exact pairing scope. Reusing the
        # first admin-visible project can accidentally select another solution
        # in multi-tenant regression databases and mask/produce scope bugs.
        project = client.post(
            "/proyectos/",
            headers=admin_headers,
            json={"nombre": f"Runner project {suffix}", "organizacion_id": organization_id},
        )
        assert project.status_code == 200, project.text
        project_id = project.json()["id"]

        dry_run = client.post(
            "/automation-jobs/dry-run",
            headers=admin_headers,
            json={
                "proyecto_id": project_id,
                "titulo": "Controlled worker dry run",
                "codigo": "DRY-RUN-HTTP",
                "framework": "playwright",
                "lenguaje": "javascript",
                "script_automatizado": "import { test } from '@playwright/test'; test('smoke', async () => {});",
                "pasos": [{"numero": 1, "accion": "Execute controlled smoke"}],
            },
        )
        assert dry_run.status_code == 200, dry_run.text
        job_id = dry_run.json()["id"]
        assert dry_run.json()["job_type"] == "DRY_RUN"

        jobs = client.get(
            "/automation-jobs/",
            headers=admin_headers,
            params={"include_dry_runs": "true", "proyecto_id": project_id},
        )
        assert jobs.status_code == 200, jobs.text
        assert job_id in {item["id"] for item in jobs.json()}
        job_detail = client.get(f"/automation-jobs/{job_id}", headers=admin_headers)
        assert job_detail.status_code == 200, job_detail.text

        next_job = client.get("/automation-jobs/next", headers=runner_headers)
        assert next_job.status_code == 200, next_job.text
        assert next_job.json()["id"] == job_id
        claimed = client.post(f"/automation-jobs/{job_id}/claim", headers=runner_headers)
        assert claimed.status_code == 200, claimed.text
        assert claimed.json()["estado"] == "CLAIMED"
        lease_token = claimed.json()["lease_token"]
        completed = client.post(
            f"/automation-jobs/{job_id}/result",
            headers=runner_headers,
            json={
                "lease_token": lease_token,
                "result_event_id": str(uuid4()),
                "status": "PASSED",
                "duration_seconds": 1,
                "observations": "Controlled local worker result",
                "steps": [{"number": 1, "status": "PASO", "observations": "Smoke passed"}],
            },
        )
        assert completed.status_code == 200, completed.text
        assert completed.json()["estado"] == "PASSED"
        revoked = client.post(f"/automation-runners/{runner_id}/revoke", headers=admin_headers)
        assert revoked.status_code == 200, revoked.text
        assert revoked.json()["activo"] is False

        visible_after_revoke = client.get("/automation-runners/", headers=admin_headers)
        assert visible_after_revoke.status_code == 200, visible_after_revoke.text
        assert runner_id not in {item["id"] for item in visible_after_revoke.json()}

        registration_token = client.post(
            "/automation-runners/registration-tokens",
            headers=admin_headers,
            json={
                "organizacion_id": organization_id,
                "nombre": "Controlled token worker",
                "tipo": "LOCAL",
                "ttl_minutes": 10,
            },
        )
        assert registration_token.status_code == 200, registration_token.text
        direct_registration = client.post(
            "/automation-runners/register",
            json={
                "registration_token": registration_token.json()["registration_token"],
                "nombre": "Controlled token worker",
                "capabilities": {"frameworks": ["playwright"], "platform": "linux"},
            },
        )
        assert direct_registration.status_code == 200, direct_registration.text
        assert direct_registration.json()["nombre"] == "Controlled token worker"
        assert direct_registration.json()["runner_token"].startswith("qar_")
        client.portal.call(engine.dispose)
