from __future__ import annotations

import base64
import hashlib
import io
import json
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app import models
from app.services import case_portability, mcp_import
from app.services import mcp_governance as governance
from app.api.routers import mcp as mcp_router


PROJECT_ID = uuid4()
COMPONENT_ID = uuid4()


@pytest.fixture(autouse=True)
def _preview_secret(monkeypatch):
    monkeypatch.setenv("TRESEKO_MCP_IMPORT_PREVIEW_SECRET", "contract-test-secret")


class _EmptyResult:
    def scalar_one_or_none(self):
        return None


class _EmptyDb:
    async def execute(self, _statement):
        return _EmptyResult()

    async def get(self, *_args, **_kwargs):
        return None


def _package() -> bytes:
    cases = [
        {"external_id": "classic", "titulo": "Classic", "tipo_prueba": "MANUAL", "formato_prueba": "CLASICA",
         "pasos": [{"accion": "Open", "resultado_esperado": "Visible"}]},
        {"external_id": "api", "titulo": "API", "tipo_prueba": "AUTOMATIZADA", "formato_prueba": "API",
         "configuracion_api": {"schema_version": "treseko.api-test/v2", "request": {"method": "GET", "url": "/health"},
                               "execution": {"iterations": 1, "parallelism": 1}}},
        {"external_id": "perf", "titulo": "Performance", "tipo_prueba": "AUTOMATIZADA_AI", "formato_prueba": "PERFORMANCE",
         "dataset": [{"users": "10"}]},
    ]
    values = {"cases.json": cases, "suites.json": [], "versions.json": []}
    manifest = {"format": case_portability.FORMAT_ID,
                "checksums": {name: hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest() for name, value in values.items()}}
    stream = io.BytesIO()
    with __import__("zipfile").ZipFile(stream, "w") as archive:
        archive.writestr("manifest.json", json.dumps(manifest))
        for name, value in values.items():
            archive.writestr(name, json.dumps(value))
    return stream.getvalue()


def _arguments(**overrides):
    value = {"project_id": str(PROJECT_ID), "profile_id": "treseko/tcases-v1",
             "content_base64": base64.b64encode(_package()).decode(), "file_name": "cases.tcases",
             "component_id": str(COMPONENT_ID)}
    value.update(overrides)
    return value


def test_supported_modes_and_format_contracts_survive_portability_parse():
    parsed = case_portability.parse_import("treseko/tcases-v1", _package())
    cases = {item["external_id"]: item for item in parsed["cases"]}
    assert {item["tipo_prueba"] for item in cases.values()} == {"MANUAL", "AUTOMATIZADA", "AUTOMATIZADA_AI"}
    assert {item["formato_prueba"] for item in cases.values()} == {"CLASICA", "API", "PERFORMANCE"}
    assert cases["classic"]["pasos"][0]["accion"] == "Open"
    assert cases["api"]["configuracion_api"]["request"]["url"] == "/health"
    assert cases["perf"]["dataset"] == [{"users": "10"}]


@pytest.mark.asyncio
async def test_mcp_preview_exposes_governed_mode_metadata_without_raw_content(monkeypatch):
    monkeypatch.setattr(mcp_router.access_control, "require_component_access",
                        lambda *_args: _async(SimpleNamespace(proyecto_id=PROJECT_ID)))
    result = await mcp_import.preview_import(_EmptyDb(), object(), SimpleNamespace(id=PROJECT_ID), _arguments())
    items = {item["external_id"]: item for item in result["items"]}
    assert items["classic"]["formato_prueba"] == "CLASICA"
    assert items["classic"]["pasos"][0]["accion"] == "Open"
    assert items["api"]["configuracion_api"]["request"]["url"] == "/health"
    assert items["perf"]["formato_prueba"] == "PERFORMANCE"
    assert "content_base64" not in json.dumps(result)


@pytest.mark.asyncio
async def test_mcp_commit_delegates_all_governed_modes_unchanged(monkeypatch):
    captured = {}

    async def commit(_db, _project_id, _profile, data, *_args, **_kwargs):
        captured["cases"] = case_portability.parse_import(_profile, data)["cases"]
        return SimpleNamespace(id=uuid4(), status="COMPLETED", summary_json={"total": 4}, item_results=[])

    monkeypatch.setattr(case_portability, "commit_import", commit)
    monkeypatch.setattr(mcp_import.access_control, "require_component_access",
                        lambda *_args: _async(SimpleNamespace(proyecto_id=PROJECT_ID)))
    monkeypatch.setattr(mcp_import.access_control, "require_build_access",
                        lambda *_args: _async(SimpleNamespace(proyecto_id=PROJECT_ID, componente_id=COMPONENT_ID, activo=True, estado="ACTIVA")))
    monkeypatch.setattr(mcp_import.access_control, "is_build_active", lambda _build: True)
    args = _arguments(confirmation="APPLY_CASE_IMPORT", idempotency_key="contract-1",
                      package_sha256=mcp_import.package_sha256(_arguments()["content_base64"]))
    args["preview_token"] = mcp_import.make_preview_token(PROJECT_ID, args)
    result = await mcp_import.commit_import(object(), SimpleNamespace(id=uuid4()), SimpleNamespace(id=PROJECT_ID), args)
    assert result["status"] == "COMPLETED"
    assert {item["formato_prueba"] for item in captured["cases"]} == {"CLASICA", "API", "PERFORMANCE"}
    assert captured["cases"][1]["configuracion_api"]["request"]["url"] == "/health"


@pytest.mark.asyncio
@pytest.mark.parametrize("payload", [
    {"script_automatizado": "rm -rf /"},
    {"configuracion_api": {"request": {"url": "https://attacker.invalid"}}},
    {"configuracion_api": {"auth": {"password": "secret"}}},
    {"configuracion_api": {"execution": {"parallelism": 8}}},
])
async def test_ai_mcp_import_rejects_urls_credentials_scripts_and_parallelism(monkeypatch, payload):
    cases = [{"external_id": "unsafe", "titulo": "Unsafe", "tipo_prueba": "AUTOMATIZADA", "formato_prueba": "API", **payload}]
    monkeypatch.setattr(mcp_router.access_control, "require_component_access",
                        lambda *_args: _async(SimpleNamespace(proyecto_id=PROJECT_ID)))
    content = _package_with_cases(cases)
    with pytest.raises(ValueError, match="MCP|segur|URL|credencial|script|paral"):
        await mcp_import.preview_import(object(), object(), SimpleNamespace(id=PROJECT_ID), _arguments(content_base64=base64.b64encode(content).decode()))


@pytest.mark.asyncio
async def test_mcp_conversational_format_is_explicitly_out_of_scope(monkeypatch):
    monkeypatch.setattr(mcp_router.access_control, "require_component_access",
                        lambda *_args: _async(SimpleNamespace(proyecto_id=PROJECT_ID)))
    content = _package_with_cases([{"external_id": "chat", "titulo": "Chat", "tipo_prueba": "AUTOMATIZADA_AI",
                                    "formato_prueba": "CONVERSACIONAL", "configuracion_chatbot": {"turnos": []}}])
    with pytest.raises(ValueError, match="CONVERSACIONAL.*fuera de alcance"):
        await mcp_import.preview_import(_EmptyDb(), object(), SimpleNamespace(id=PROJECT_ID),
                                        _arguments(content_base64=base64.b64encode(content).decode()))


def _package_with_cases(cases):
    values = {"cases.json": cases, "suites.json": [], "versions.json": []}
    manifest = {"format": case_portability.FORMAT_ID,
                "checksums": {name: hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest() for name, value in values.items()}}
    stream = io.BytesIO()
    with __import__("zipfile").ZipFile(stream, "w") as archive:
        archive.writestr("manifest.json", json.dumps(manifest))
        for name, value in values.items(): archive.writestr(name, json.dumps(value))
    return stream.getvalue()


async def _async(value):
    return value
