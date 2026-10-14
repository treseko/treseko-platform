"""Inventory persistence, atomic editing and scope through the real HTTP API."""
from uuid import uuid4
from concurrent.futures import ThreadPoolExecutor

import psycopg
from fastapi.testclient import TestClient
from app.repositories import project_write_policy
from app.main import app
from app.database import DATABASE_URL
from app.api.routers import organizations, projects
from test_api_project_http_flow import _create_admin, _login, _allow_controlled_tenant_limit


def test_inventory_categories_and_atomic_asset_edit(monkeypatch):
    monkeypatch.setattr(organizations, "enforce_limit", _allow_controlled_tenant_limit)
    monkeypatch.setattr(project_write_policy, "enforce_limit", _allow_controlled_tenant_limit)
    email = f"inventory-{uuid4().hex}@example.test"
    password = "ControlledInventoryPassword2026!"
    _create_admin(email, password)
    with TestClient(app, raise_server_exceptions=False) as client:
        headers = _login(client, email, password)

        def post(url, data):
            response = client.post(url, headers=headers, json=data)
            assert response.status_code == 200, response.text
            return response.json()

        organization = post("/organizaciones/", {"nombre": "Inventory QA", "tipo": "Interna"})
        project = post("/proyectos/", {"nombre": "Inventory scope", "organizacion_id": organization["id"]})
        other = post("/proyectos/", {"nombre": "Other scope", "organizacion_id": organization["id"]})
        category_url = f"/infraestructura/categorias/?proyecto_id={project['id']}"
        category = post(category_url, {"nombre": "  QA equipment  "})
        assert category["nombre"] == "QA equipment"
        assert client.get(category_url, headers=headers).json() == [category]
        assert client.get(f"/infraestructura/categorias/?proyecto_id={other['id']}", headers=headers).json() == []
        assert client.post(category_url, headers=headers, json={"nombre": "qa EQUIPMENT"}).status_code == 409
        assert client.get(category_url).status_code == 401

        asset_url = f"/infraestructura/activos/?proyecto_id={project['id']}"
        base = {"tipo": "Servidor", "naturaleza": "fisico"}
        root = post(asset_url, {**base, "nombre": "Root", "categoria_id": category["id"], "endpoints": [
            {"tipo": "hostname", "valor": "old-host", "principal": True},
            {"tipo": "ip", "valor": "10.0.0.1"},
        ]})
        child = post(asset_url, {**base, "nombre": "Child", "parent_id": root["id"]})
        foreign = post(f"/infraestructura/activos/?proyecto_id={other['id']}", {**base, "nombre": "Foreign", "endpoints": [{"valor": "10.1.1.1"}]})
        detail = f"/infraestructura/activos/{root['id']}"
        invalid = client.patch(detail, headers=headers, json={"nombre": "Partial must not persist", "endpoints": [
            {"id": foreign["endpoints"][0]["id"], "valor": "invalid"},
        ]})
        assert invalid.status_code == 422, invalid.text
        assert client.get(detail, headers=headers).json()["nombre"] == "Root"
        # Force a PostgreSQL failure while flushing endpoint changes, after
        # the asset update was submitted. The whole transaction must roll back.
        sync_url = DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://", 1)
        with psycopg.connect(sync_url) as db:
            db.execute("CREATE FUNCTION inventory_qa_reject() RETURNS trigger LANGUAGE plpgsql AS $$ "
                       "BEGIN IF NEW.valor = 'reject-this-endpoint' THEN RAISE EXCEPTION 'controlled failure'; END IF; RETURN NEW; END $$")
            db.execute("CREATE TRIGGER inventory_qa_reject BEFORE INSERT OR UPDATE ON inventory_endpoints "
                       "FOR EACH ROW EXECUTE FUNCTION inventory_qa_reject()")
        try:
            rejected = client.patch(detail, headers=headers, json={"nombre": "Rollback this name", "endpoints": [
                {"id": root["endpoints"][0]["id"], "tipo": "hostname", "valor": "reject-this-endpoint"},
            ]})
            assert rejected.status_code == 500, rejected.text
            unchanged = client.get(detail, headers=headers).json()
            assert unchanged["nombre"] == "Root"
            assert {endpoint["valor"] for endpoint in unchanged["endpoints"]} == {"old-host", "10.0.0.1"}
        finally:
            with psycopg.connect(sync_url) as db:
                db.execute("DROP TRIGGER inventory_qa_reject ON inventory_endpoints")
                db.execute("DROP FUNCTION inventory_qa_reject()")
        assert client.patch(detail, headers=headers, json={"parent_id": child["id"]}).status_code == 422
        assert client.patch(detail, headers=headers, json={"parent_id": foreign["id"]}).status_code == 422
        assert client.get(detail, headers=headers).json()["parent_id"] is None
        grandchild = post(asset_url, {**base, "nombre": "Grandchild", "parent_id": child["id"]})
        assert client.patch(detail, headers=headers, json={"parent_id": grandchild["id"]}).status_code == 422
        first = post(asset_url, {**base, "nombre": "First concurrent parent"})
        second = post(asset_url, {**base, "nombre": "Second concurrent parent"})
        with ThreadPoolExecutor(max_workers=2) as pool:
            updates = [pool.submit(client.patch, f"/infraestructura/activos/{node['id']}", headers=headers,
                                   json={"parent_id": parent["id"]}) for node, parent in [(first, second), (second, first)]]
            assert sorted(update.result().status_code for update in updates) == [200, 422]

        edited = client.patch(detail, headers=headers, json={"nombre": "Updated", "endpoints": [
            {"id": root["endpoints"][0]["id"], "tipo": "hostname", "valor": "new-host", "principal": True},
            {"tipo": "url", "valor": "https://qa.example.test"},
        ]})
        assert edited.status_code == 200, edited.text
        assert {item["valor"] for item in edited.json()["endpoints"]} == {"new-host", "https://qa.example.test"}
        assert client.get(detail, headers=headers).json()["nombre"] == "Updated"
        with psycopg.connect(DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://", 1)) as db:
            assert db.execute("SELECT activo FROM inventory_endpoints WHERE id = %s", (root["endpoints"][1]["id"],)).fetchone()[0] is False
            assert db.execute("SELECT nombre FROM inventory_categories WHERE id = %s", (category["id"],)).fetchone()[0] == "QA equipment"
        # A new browser session sees persisted categories after authenticating.
        fresh_headers = _login(client, email, password)
        assert client.get(category_url, headers=fresh_headers).json() == [category]
        reader_email = f"inventory-reader-{uuid4().hex}@example.test"
        _create_admin(reader_email, password)
        with psycopg.connect(DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://", 1)) as db:
            reader_id = db.execute(
                "UPDATE usuarios SET rol = 'TESTER', permisos = '{\"inventario\":\"read\"}', "
                "permisos_detallados = '{\"inventario.categorias\":\"read\"}' WHERE email = %s RETURNING id", (reader_email,),
            ).fetchone()[0]
            db.execute("INSERT INTO proyecto_miembros (id, proyecto_id, usuario_id, rol_proyecto) VALUES (%s, %s, %s, 'VIEWER')",
                       (uuid4(), project['id'], reader_id))
        reader = _login(client, reader_email, password)
        assert client.get(category_url, headers=reader).status_code == 200
        assert client.get(detail, headers=reader).status_code == 200
        assert client.post(category_url, headers=reader, json={"nombre": "Forbidden"}).status_code == 403
        assert client.patch(detail, headers=reader, json={"nombre": "Forbidden"}).status_code == 403
        assert client.get(f"/infraestructura/categorias/?proyecto_id={other['id']}", headers=reader).status_code == 403
