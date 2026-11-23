"""Public route integration with frozen fixtures; never touches the user's DB."""
from copy import deepcopy
from datetime import datetime, timezone
from html.parser import HTMLParser
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routers import reports_public


class VisibleText(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []

    def handle_data(self, data):
        self.parts.append(data)


@pytest.fixture
def report_client(monkeypatch):
    current_build, previous_build = str(uuid4()), str(uuid4())
    bug_id, old_bug_id, owner_id = str(uuid4()), str(uuid4()), str(uuid4())
    new_bug = {
        "id": bug_id, "codigo": "BUG-201", "titulo": "No se guarda el pedido",
        "build_id": current_build, "build_code": "v2.1", "estado": "ABIERTO",
        "severidad": "ALTA", "prioridad": "P1", "case_code": "TC-201",
        "case_title": "Guardar pedido", "responsable": owner_id,
        "resultado_esperado": "Pedido guardado", "resultado_obtenido": "Error al guardar",
        "ambiente_nombre": "QA Pedidos", "dataset_name": "Pedidos válidos",
    }
    old_bug = {
        **new_bug, "id": old_bug_id, "codigo": "BUG-102", "titulo": "El filtro no responde",
        "build_id": previous_build, "build_code": "v2.0", "case_code": "TC-102",
        "origin_build_name": "v2.0", "current_build_verification": "Pendiente de verificar",
    }
    payload = {
        "metadata": {"report_type": "development", "proyecto": "Pedidos",
                     "build": "v2.1", "snapshot_created_for_build": current_build},
        "manual_definition": {"build_definition": "EN_ANALISIS", "responsible_id": owner_id},
        "metrics": {"build_id": current_build, "total_casos_asignados": 3,
                    "total_ejecutados": 2, "cobertura_porcentaje": 66.7,
                    "stats": {"pasados": 1, "fallados": 1, "bloqueados": 0, "sin_correr": 1},
                    "por_suite_tree": [{"casos": [{"codigo": "TC-OK", "titulo": "CASO_EXITOSO_NO_LISTAR", "estado": "PASO"}]}]},
        "bugs": [new_bug, old_bug],
        "development": {"bugs": [new_bug, old_bug], "new_bugs": [new_bug],
                        "historical_bugs": [old_bug], "corrected_bugs": [],
                        "unclassified_bugs": [], "failures_without_bug": []},
    }
    snapshot = SimpleNamespace(
        id=uuid4(), token="reporte-controlado", title="Informe de pedidos", description="",
        created_at=datetime.now(timezone.utc), activo=True, payload=payload,
    )

    async def get_snapshot(_db, token):
        return snapshot if token == snapshot.token else None

    async def no_changes(*_args):
        return False

    async def branding(*_args):
        return {"brand_name": "Treseko"}

    async def db_override():
        yield None

    monkeypatch.setattr(reports_public.crud, "get_shared_report_by_token", get_snapshot)
    monkeypatch.setattr(reports_public.crud, "shared_report_is_expired", lambda _snapshot: False)
    monkeypatch.setattr(reports_public.crud, "shared_report_has_new_values", no_changes)
    monkeypatch.setattr(reports_public, "_live_branding_state", branding)
    app = FastAPI()
    app.include_router(reports_public.router)
    app.dependency_overrides[reports_public.get_db] = db_override
    with TestClient(app) as client:
        yield client, snapshot, (current_build, previous_build, bug_id, old_bug_id, owner_id)


@pytest.mark.parametrize("suffix", ["", ".md", ".csv"])
def test_development_downloads_share_legible_findings_scope(report_client, suffix):
    client, snapshot, internal_ids = report_client
    before = deepcopy(snapshot.payload)
    response = client.get(f"/s/reports/{snapshot.token}{suffix}")
    assert response.status_code == 200, response.text
    if not suffix:
        parser = VisibleText()
        parser.feed(response.text)
        text = " ".join(parser.parts)
        assert "tab=incidencias" in response.text
    else:
        text = response.text
    # UUID in an actual hyperlink is necessary; visible names must be readable.
    assert "BUG-201" in text
    assert "BUG-102" in text
    assert "CASO_EXITOSO_NO_LISTAR" not in text
    assert internal_ids[-1] not in text
    assert internal_ids[0] not in text
    assert internal_ids[1] not in text
    assert response.headers["x-content-type-options"] == "nosniff"
    assert snapshot.payload == before


@pytest.mark.parametrize("suffix", ["", ".md", ".csv"])
def test_internal_snapshot_is_never_served_by_public_export(report_client, suffix):
    client, snapshot, _ = report_client
    snapshot.payload["metadata"]["report_type"] = "internal"
    response = client.get(f"/s/reports/{snapshot.token}{suffix}")
    assert response.status_code == 404


@pytest.mark.parametrize("suffix", ["", ".md", ".csv"])
def test_revoked_snapshot_does_not_leak_findings(report_client, suffix):
    client, snapshot, _ = report_client
    snapshot.activo = False
    response = client.get(f"/s/reports/{snapshot.token}{suffix}")
    assert response.status_code == 410
    assert "BUG-201" not in response.text
    assert "BUG-102" not in response.text
