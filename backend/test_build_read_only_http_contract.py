"""HTTP contract for historical-build read-only behavior."""

from __future__ import annotations

import sys
from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient

BACKEND_DIR = Path(__file__).resolve().parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.repositories import project_write_policy
from app.main import app  # noqa: E402
from app.api.routers import organizations as organizations_router  # noqa: E402
from app.api.routers import projects as projects_router  # noqa: E402
from test_api_project_http_flow import _create_admin, _login  # noqa: E402


async def _allow_controlled_tenant_limit(*_args, **_kwargs) -> None:
    return None


def test_historical_build_is_readable_but_not_mutable(monkeypatch):
    monkeypatch.setattr(organizations_router, "enforce_limit", _allow_controlled_tenant_limit)
    monkeypatch.setattr(project_write_policy, "enforce_limit", _allow_controlled_tenant_limit)
    suffix = uuid4().hex
    email = f"historical-build-{suffix}@example.test"
    password = "HistoricalBuildPassword-2026!"
    _create_admin(email, password)

    with TestClient(app, raise_server_exceptions=False) as client:
        headers = _login(client, email, password)
        organization = client.post(
            "/organizaciones/",
            headers=headers,
            json={"nombre": f"Historical Org {suffix}", "tipo": "Cliente"},
        )
        assert organization.status_code == 200, organization.text
        project = client.post(
            "/proyectos/",
            headers=headers,
            json={"nombre": f"Historical Project {suffix}", "organizacion_id": organization.json()["id"]},
        )
        assert project.status_code == 200, project.text
        project_id = project.json()["id"]
        component = client.post(
            "/componentes/",
            headers=headers,
            json={"proyecto_id": project_id, "nombre": "Historical component", "variables": {}},
        )
        assert component.status_code == 200, component.text
        component_id = component.json()["id"]

        historical = client.post(
            "/builds/",
            headers=headers,
            json={
                "proyecto_id": project_id,
                "componente_id": component_id,
                "nombre": "1.0 historical",
                "estado": "HISTORICA",
                "activo": False,
            },
        )
        assert historical.status_code == 200, historical.text
        historical_id = historical.json()["id"]

        listed = client.get(f"/proyectos/{project_id}/builds/", headers=headers)
        assert listed.status_code == 200, listed.text
        assert historical_id in {item["id"] for item in listed.json()}
        readable_cases = client.get(f"/builds/{historical_id}/casos/", headers=headers)
        assert readable_cases.status_code == 200, readable_cases.text

        metadata_update = client.patch(
            f"/builds/{historical_id}", headers=headers, json={"nombre": "must remain historical"}
        )
        assert metadata_update.status_code == 409, metadata_update.text
        scope_update = client.put(
            f"/builds/{historical_id}/casos/", headers=headers, json={"caso_ids": []}
        )
        assert scope_update.status_code == 409, scope_update.text
        delete = client.delete(f"/builds/{historical_id}", headers=headers)
        assert delete.status_code == 409, delete.text

        active = client.post(
            "/builds/",
            headers=headers,
            json={
                "proyecto_id": project_id,
                "componente_id": component_id,
                "nombre": "1.0 active",
                "estado": "ACTIVA",
                "activo": True,
            },
        )
        assert active.status_code == 200, active.text
        active_update = client.patch(
            f"/builds/{active.json()['id']}", headers=headers, json={"nombre": "1.0 active revised"}
        )
        assert active_update.status_code == 200, active_update.text


        parent_delete = client.delete(f"/componentes/{component_id}", headers=headers)
        assert parent_delete.status_code == 409, parent_delete.text
        assert historical_id in {b['id'] for b in client.get(f"/proyectos/{project_id}/builds/", headers=headers).json()}
        case = client.post('/casos/', headers=headers, json={
            'proyecto_id': project_id, 'componente_id': component_id,
            'titulo': 'Preserve case and execution', 'prioridad': 'MEDIA',
            'tipo_prueba': 'MANUAL', 'formato_prueba': 'CLASICA',
            'pasos': [{'numero_paso': 1, 'accion': 'Check', 'resultado_esperado': 'Preserved'}],
        })
        assert case.status_code == 200, case.text
        assigned = client.put(f"/builds/{active.json()['id']}/casos/", headers=headers, json={'caso_ids': [case.json()['id']]})
        assert assigned.status_code == 200, assigned.text
        run = client.post('/test-runs/', headers=headers, json={
            'nombre': 'Preserved run', 'entorno': 'QA', 'proyecto_id': project_id,
            'build_id': active.json()['id'], 'caso_ids': [case.json()['id']],
        })
        assert run.status_code == 200, run.text
        assert client.delete(f"/builds/{active.json()['id']}", headers=headers).status_code == 409
        detail = client.get(f"/test-runs/{run.json()['id']}/detalle/", headers=headers)
        assert detail.status_code == 200, detail.text
        # API and PostgreSQL must retain the build and case scope after rejection.
        from app.database import DATABASE_URL
        import psycopg
        with psycopg.connect(DATABASE_URL.replace('postgresql+asyncpg://', 'postgresql://', 1)) as db:
            assert str(db.execute('SELECT build_id FROM test_runs WHERE id=%s', (run.json()['id'],)).fetchone()[0]) == active.json()['id']
            assert db.execute('SELECT count(*) FROM builds WHERE id=%s', (historical_id,)).fetchone()[0] == 1
            assert db.execute('SELECT count(*) FROM casos_prueba WHERE id=%s', (case.json()['id'],)).fetchone()[0] == 1
        empty = client.post('/componentes/', headers=headers, json={'proyecto_id': project_id, 'nombre': 'Unused component'})
        assert empty.status_code == 200, empty.text
        assert client.delete(f"/componentes/{empty.json()['id']}", headers=headers).status_code == 200
