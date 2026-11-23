import hashlib
import io
import json
import zipfile
from datetime import timedelta
from uuid import uuid4

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app import models
from app.services.case_portability import FORMAT_ID, PortabilityError, commit_import, export_tcases, parse_import, preview_import, profiles, rollback_eligibility, validate_file_extension
from app.services.case_portability_examples import build_tcases_example
from app.time_utils import utc_now


def _package(*, broken_checksum: bool = False) -> bytes:
    values = {
        "cases.json": [{"external_id": "TC-9", "titulo": "Iniciar sesión", "prioridad": "HIGH", "pasos": [{"accion": "Abrir", "resultado_esperado": "Formulario visible"}]}],
        "suites.json": [], "versions.json": [],
    }
    manifest = {"format": FORMAT_ID, "checksums": {key: hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest() for key, value in values.items()}}
    if broken_checksum: manifest["checksums"]["cases.json"] = "0" * 64
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w") as archive:
        archive.writestr("manifest.json", json.dumps(manifest))
        for key, value in values.items(): archive.writestr(key, json.dumps(value))
    return stream.getvalue()


def test_tcases_profile_requires_checksum_and_normalizes_case():
    result = parse_import("treseko/tcases-v1", _package())
    assert result["tool"] == "treseko"
    assert result["cases"][0]["titulo"] == "Iniciar sesión"
    assert result["cases"][0]["prioridad"] == "ALTA"


def test_legacy_treseko_project_export_is_importable():
    payload = {
        "version_formato": "1.0",
        "proyecto": {"nombre": "Proyecto histórico"},
        "suites": [
            {"id": "root", "parent_id": None, "nombre": "Web", "descripcion": "Suite web"},
            {"id": "auth", "parent_id": "root", "nombre": "Autenticación", "descripcion": "Login"},
        ],
        "casos": [{
            "master_id": "legacy-master-1",
            "suite_id": "auth",
            "codigo": "TC-OLD-001",
            "titulo": "Inicio de sesión",
            "descripcion": "Validar acceso",
            "version": 3,
            "prioridad": "ALTA",
            "tipo_prueba": "MANUAL",
            "estado_caso": "ACTIVO",
            "pasos": [{"numero_paso": 1, "accion": "Abrir login", "datos": "/login", "resultado_esperado": "Visible"}],
        }],
    }
    result = parse_import("treseko/legacy-project-v1", json.dumps(payload).encode())
    case = result["cases"][0]
    assert case["suite_path"] == "Web/Autenticación"
    assert case["codigo"] == "TC-OLD-001"
    assert case["external_version"] == "3"
    assert case["pasos"][0]["datos"] == "/login"
    assert result["diagnostics"]["legacy_format_version"] == "1.0"
    assert any("histórico" in warning for warning in result["diagnostics"]["warnings"])
    validate_file_extension("treseko/legacy-project-v1", "backup.treseko")


def test_native_package_round_trips_all_case_formats_and_execution_modes():
    values = {
        "cases.json": [
            {"external_id": "classic", "codigo": "TC-CLASSIC", "titulo": "Classic", "formato_prueba": "CLASICA", "tipo_prueba": "MANUAL", "pasos": [{"accion": "Open", "resultado_esperado": "Visible"}]},
            {"external_id": "api", "codigo": "TC-API", "titulo": "API", "formato_prueba": "API", "tipo_prueba": "AUTOMATIZADA", "configuracion_api": {"request": {"method": "GET", "url": "/health"}}, "pasos": []},
            {"external_id": "chat", "codigo": "TC-CHAT", "titulo": "Chatbot", "formato_prueba": "CONVERSACIONAL", "tipo_prueba": "AUTOMATIZADA_AI", "configuracion_chatbot": {"turnos": [{"mensaje": "hello"}]}, "pasos": []},
            {"external_id": "perf", "codigo": "TC-PERF", "titulo": "Performance", "formato_prueba": "PERFORMANCE", "tipo_prueba": "AUTOMATIZADA", "dataset": [{"users": "10"}], "pasos": []},
        ],
        "suites.json": [], "versions.json": [],
    }
    manifest = {"format": FORMAT_ID, "checksums": {key: hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest() for key, value in values.items()}}
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w") as archive:
        archive.writestr("manifest.json", json.dumps(manifest))
        for key, value in values.items():
            archive.writestr(key, json.dumps(value))
    result = parse_import("treseko/tcases-v1", stream.getvalue())
    cases = {case["external_id"]: case for case in result["cases"]}
    assert {case["formato_prueba"] for case in cases.values()} == {"CLASICA", "API", "CONVERSACIONAL", "PERFORMANCE"}
    assert cases["api"]["configuracion_api"]["request"]["method"] == "GET"
    assert cases["chat"]["configuracion_chatbot"]["turnos"][0]["mensaje"] == "hello"
    assert cases["perf"]["dataset"] == [{"users": "10"}]


def test_tcases_rejects_tampered_payload():
    with pytest.raises(PortabilityError, match="Checksum"):
        parse_import("treseko/tcases-v1", _package(broken_checksum=True))


def test_downloadable_tcases_example_is_complete_and_importable():
    package = build_tcases_example(FORMAT_ID)
    result = parse_import("treseko/tcases-v1", package)
    case = result["cases"][0]
    assert case["suite_path"] == "Web/Autenticación"
    assert case["prioridad"] == "ALTA"
    assert case["criticidad"] == "CRITICA"
    assert case["tipo_prueba"] == "MANUAL"
    assert len(case["pasos"]) == 2
    assert len(result["attachments"]) == 1
    attachment = result["attachments"][0]
    assert attachment["step_number"] == 2
    assert result["attachment_files"][attachment["archive_path"]].startswith(
        b"Treseko example evidence"
    )


@pytest.mark.asyncio
async def test_tcases_example_endpoint_requires_read_access_and_audits_download(monkeypatch):
    from types import SimpleNamespace
    from app.api.routers import case_portability as router

    checked: list[str] = []
    audits: list[dict] = []

    def fake_capability(_user, level):
        checked.append(level)

    async def fake_audit(_db, user_id, action, resource, **kwargs):
        audits.append({"user_id": user_id, "action": action, "resource": resource, **kwargs})

    monkeypatch.setattr(router, "_capability", fake_capability)
    monkeypatch.setattr(router, "create_audit_log", fake_audit)
    user = SimpleNamespace(id="user-1")
    request = SimpleNamespace(client=SimpleNamespace(host="127.0.0.1"))
    response = await router.download_tcases_example(request, object(), user)

    assert checked == ["read"]
    assert response.headers["content-disposition"].endswith(
        '"ejemplo-migracion-treseko.tcases"'
    )
    assert parse_import("treseko/tcases-v1", response.body)["cases"]
    assert audits[0]["action"] == "case_portability.template_downloaded"
    assert audits[0]["resource"] == "case_portability_template"


def test_tcases_rejects_excessive_total_uncompressed_size():
    stream = io.BytesIO()
    repeated = b"0" * (18 * 1024 * 1024)
    with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for index in range(6):
            archive.writestr(f"attachments/chunk-{index}.bin", repeated)
    assert len(stream.getvalue()) < 20 * 1024 * 1024
    with pytest.raises(PortabilityError, match="archivos no permitidos"):
        parse_import("treseko/tcases-v1", stream.getvalue())


def test_csv_profile_creates_steps_without_executing_content():
    payload = b"id,title,suite,steps\n42,Buscar,Smoke,Escribir => Resultado\n"
    result = parse_import("csv/structured-v1", payload)
    assert result["cases"][0]["external_id"] == "42"
    assert result["cases"][0]["pasos"][0]["accion"] == "Escribir"


def test_structured_csv_detailed_rows_group_steps_data_and_expected_results():
    payload = b'''id,title,suite,description,external_version,step_number,step_action,step_data,step_expected
TC-1,Login,Web/Auth,Validate login,3,1,Open login,/login,Form visible
TC-1,,,,,2,Submit credentials,user=qa,Dashboard visible
TC-2,Logout,Web/Auth,Validate logout,1,1,Click logout,,Login visible
'''
    result = parse_import("csv/structured-v1", payload)
    assert len(result["cases"]) == 2
    login = result["cases"][0]
    assert login["external_version"] == "3"
    assert login["suite_path"] == "Web/Auth"
    assert len(login["pasos"]) == 2
    assert login["pasos"][0]["datos"] == "/login"
    assert login["pasos"][1]["resultado_esperado"] == "Dashboard visible"


def test_structured_csv_orders_steps_by_step_number_when_rows_are_reordered():
    payload = b'''id,title,suite,step_number,step_action,step_expected
TC-1,Login,Web/Auth,2,Submit credentials,Dashboard visible
TC-1,Login,Web/Auth,1,Open login,Form visible
'''
    result = parse_import("csv/structured-v1", payload)
    assert [step["accion"] for step in result["cases"][0]["pasos"]] == [
        "Open login", "Submit credentials"
    ]


def test_structured_csv_rejects_duplicate_step_numbers_for_one_case():
    payload = b'''id,title,suite,step_number,step_action
TC-1,Login,Web/Auth,1,Open login
TC-1,Login,Web/Auth,1,Submit credentials
'''
    with pytest.raises(PortabilityError, match="step_number repetidos"):
        parse_import("csv/structured-v1", payload)


def test_unknown_profile_fails_closed():
    with pytest.raises(PortabilityError, match="no reconocido"):
        parse_import("vendor/future-v99", b"[]")


def test_tcases_preserves_attachment_manifest_and_binary_payload():
    attachment = b"fake-png-content"
    attachments = [{
        "case_external_id": "TC-9", "step_number": 1,
        "filename": "evidencia_final.png", "content_type": "image/png",
        "size": len(attachment), "sha256": hashlib.sha256(attachment).hexdigest(),
        "tipo": "evidence", "archive_path": "attachments/TC-9/1-file-evidencia_final.png",
    }]
    values = {"cases.json": [{"external_id": "TC-9", "titulo": "Caso", "pasos": [{"accion": "Abrir", "resultado_esperado": "Visible"}]}], "suites.json": [], "versions.json": [], "attachments.json": attachments}
    manifest = {"format": FORMAT_ID, "checksums": {key: hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest() for key, value in values.items()}}
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w") as archive:
        archive.writestr("manifest.json", json.dumps(manifest))
        for key, value in values.items(): archive.writestr(key, json.dumps(value))
        archive.writestr(attachments[0]["archive_path"], attachment)
    result = parse_import("treseko/tcases-v1", stream.getvalue())
    assert len(result["attachments"]) == 1
    assert result["attachment_files"][attachments[0]["archive_path"]] == attachment


def test_testrail_xml_adapter_preserves_sections_and_steps():
    payload = b"<sections><section><name>Smoke</name><cases><case><id>TR-1</id><title>Login</title><custom_steps><steps><step><content>Open</content><expected>Visible</expected></step></steps></custom_steps></case></cases></section></sections>"
    result = parse_import("testrail/xml-v1", payload)
    assert result["cases"][0]["external_id"] == "TR-1"
    assert result["cases"][0]["suite_path"] == "Smoke"
    assert result["cases"][0]["pasos"][0]["resultado_esperado"] == "Visible"


def test_testlink_xml_maps_summary_and_converts_rich_text_to_plain_text():
    payload = b"""<testcases><testcase internalid="TL-1" name="Login">
      <version>3</version><importance>3</importance><execution_type>2</execution_type>
      <summary>&lt;p&gt;Validar inicio de sesi&amp;oacute;n.&lt;/p&gt;</summary>
      <preconditions>&lt;ul&gt;&lt;li&gt;Usuario activo&lt;/li&gt;&lt;li&gt;Clave v&amp;aacute;lida&lt;/li&gt;&lt;/ul&gt;</preconditions>
      <steps><step><step_number>1</step_number>
        <actions>&lt;p&gt;Abrir la p&amp;aacute;gina&lt;/p&gt;</actions>
        <expectedresults>&lt;p&gt;Formulario visible&lt;/p&gt;</expectedresults>
      </step></steps>
    </testcase></testcases>"""
    result = parse_import("testlink/xml-v1", payload)
    case = result["cases"][0]
    assert case["descripcion"] == "Validar inicio de sesión."
    assert case["precondiciones"] == "- Usuario activo\n- Clave válida"
    assert case["external_version"] == "3"
    assert case["prioridad"] == "ALTA"
    assert case["tipo_prueba"] == "AUTOMATIZADA"
    assert case["pasos"][0]["accion"] == "Abrir la página"
    assert case["pasos"][0]["resultado_esperado"] == "Formulario visible"
    assert "<" not in case["descripcion"]


def test_xml_profiles_reject_entities_instead_of_expanding_them():
    payload = b'''<?xml version="1.0"?><!DOCTYPE testsuite [<!ENTITY secret "expanded">]><testsuite name="Root"><testcase internalid="1" name="&secret;" /></testsuite>'''
    with pytest.raises(PortabilityError, match="construcciones no permitidas"):
        parse_import("testlink/xml-v1", payload)


def test_csv_parser_returns_a_domain_error_for_oversized_cells():
    payload = b"id,title\n1," + (b"x" * 140_000) + b"\n"
    with pytest.raises(PortabilityError, match="CSV no es válido"):
        parse_import("csv/structured-v1", payload)


def test_gherkin_adapter_maps_scenarios_tags_and_steps():
    payload = b"Feature: Login\n@smoke\nScenario: valid\n Given open\n When submit\n Then visible\n"
    result = parse_import("gherkin/feature-v1", payload)
    assert result["cases"][0]["suite_path"] == "Login"
    assert "@smoke" in result["cases"][0]["etiquetas"]
    assert len(result["cases"][0]["pasos"]) == 3


def test_profiles_only_advertise_verified_vendor_contracts_as_supported():
    by_id = {item["id"]: item for item in profiles()}
    assert by_id["xray/json-v1"]["status"] == "beta"
    assert by_id["xray/json-v1"]["version"] == "execution-testinfo-v1"
    assert by_id["xray/csv-v1"]["status"] == "beta"
    assert by_id["qase/json-v1"]["status"] == "beta"
    assert by_id["qase/json-v1"]["import_enabled"] is True
    assert by_id["testlink/xml-v1"]["verification_label"] == "Verificado"
    assert "TestLink" in by_id["testlink/xml-v1"]["verification_detail"]
    assert by_id["zephyr/xml-v1"]["status"] == "beta"
    assert by_id["zephyr/xml-v1"]["tool"] == "zephyr"
    assert by_id["zephyr/xml-v1"]["display_name"] == "Zephyr Scale"
    assert by_id["zephyr/xml-v1"]["version"] == "project-xml-v1"
    assert by_id["zephyr/csv-v1"]["status"] == "blocked"
    with pytest.raises(PortabilityError, match="Zephyr CSV cambia"):
        parse_import("zephyr/csv-v1", b"id,name\n1,case")


def test_profile_rejects_a_file_extension_from_another_tool_contract():
    with pytest.raises(PortabilityError, match="no corresponde"):
        validate_file_extension("testlink/xml-v1", "cases.csv")
    validate_file_extension("qtest/excel-v1", "qtest-export.xlsx")


def test_testrail_csv_accepts_official_headers_and_preserves_section_depth():
    payload = b'''ID,Title,Priority,Section,Section Depth,Steps (Step),Steps (Expected Result)\nC1,Login,High,Authentication,0,Open login,Form visible\nC2,Reset password,Medium,Recovery,1,Request reset,Email sent\n'''
    result = parse_import("testrail/csv-v1", payload)
    assert [case["suite_path"] for case in result["cases"]] == ["Authentication", "Authentication/Recovery"]
    assert result["cases"][0]["prioridad"] == "ALTA"
    assert result["cases"][0]["pasos"][0]["resultado_esperado"] == "Form visible"


def test_testrail_xml_preserves_exploratory_custom_content():
    payload = b'''<suite><sections><section><name>Exploratory</name><cases><case><id>C1</id><title>Explore login</title><priority>High</priority><custom><mission>Find authentication risks</mission><goals>Cover recovery</goals><automation_type><value>Cypress</value></automation_type></custom></case></cases></section></sections></suite>'''
    result = parse_import("testrail/xml-v1", payload)
    case = result["cases"][0]
    assert "Find authentication risks" in case["descripcion"]
    assert "Cover recovery" in case["descripcion"]
    assert "automation_type" in result["diagnostics"]["ignored_fields"]


def test_xray_csv_detects_semicolon_and_groups_step_rows():
    payload = b'''TCID;Test Summary;Test Priority;Test Repository Path;Action;Data;Result;Attach Steps\n1;Login;High;Smoke/Auth;Open;/login;Form visible;\n1;;;;Enter credentials;qa/pass;Dashboard;https://example.invalid/image.png\n2;Logout;Medium;Smoke/Auth;Click logout;;Login visible;\n'''
    result = parse_import("xray/csv-v1", payload)
    assert len(result["cases"]) == 2
    assert len(result["cases"][0]["pasos"]) == 2
    assert result["cases"][0]["suite_path"] == "Smoke/Auth"
    assert any("adjuntos" in warning for warning in result["diagnostics"]["warnings"])


def test_xray_json_imports_only_official_testinfo_specifications():
    payload = json.dumps({
        "testExecutionKey": "DEMO-1206",
        "info": {"version": "v1.3"},
        "tests": [{
            "testKey": "STORE-22",
            "status": "PASS",
            "evidence": [{"filename": "proof.png", "data": "aGVsbG8="}],
            "testInfo": {
                "summary": "Strong password validation",
                "description": "Validate password policy",
                "testType": "Manual",
                "projectKey": "STORE",
                "labels": ["security"],
                "requirementKeys": ["STORE-1"],
                "steps": [
                    {"action": "Open change password", "data": "user=qa", "result": "Form visible"},
                    {"action": "Submit a strong password", "result": "Password changed"},
                ],
            },
            "iterations": [{"status": "PASS", "steps": [{"status": "PASS"}]}],
        }],
    }).encode()
    result = parse_import("xray/json-v1", payload)
    case = result["cases"][0]
    assert case["external_id"] == "STORE-22"
    assert case["external_version"] == "v1.3"
    assert case["suite_path"] == "Importados/Xray/STORE"
    assert case["etiquetas"] == ["security", "requirement:STORE-1"]
    assert len(case["pasos"]) == 2
    assert "iterations" in result["diagnostics"]["ignored_fields"]
    assert "evidence" in result["diagnostics"]["ignored_fields"]
    assert any("sólo las especificaciones testInfo" in warning for warning in result["diagnostics"]["warnings"])


def test_xray_json_rejects_execution_results_without_case_definitions():
    payload = b'{"tests":[{"testKey":"STORE-22","status":"PASS"}]}'
    with pytest.raises(PortabilityError, match="ninguna especificación testInfo"):
        parse_import("xray/json-v1", payload)


def test_xray_json_accepts_official_historical_testinfo_type_field():
    payload = json.dumps({
        "info": {"project": "CALC", "version": "v1.0"},
        "tests": [{
            "status": "PASSED",
            "testInfo": {
                "summary": "Strong password validation", "type": "Manual", "projectKey": "CALC",
                "steps": [{"action": "Open password screen", "data": "Password=${Password}", "result": "Validation appears"}],
            },
            "iterations": [{"name": "Iteration 1", "status": "PASSED"}],
        }],
    }).encode()
    result = parse_import("xray/json-v1", payload)
    assert result["cases"][0]["tipo_prueba"] == "MANUAL"
    assert result["cases"][0]["pasos"][0]["datos"] == "Password=${Password}"
    assert any("campo histórico" in warning for warning in result["diagnostics"]["warnings"])


def test_xray_csv_uses_preconditions_and_test_sets_without_importing_them_as_cases():
    payload = b'''Issue Id;Issue type;Test type;Test Summary;Action;Result;Test Set;Precondition\n1;precondition;;User is logged out;;;;\n2;testset;;Authentication regression;;;;\n3;test;Manual;Login;Open login;Form visible;2;1\n3;;; ;Submit credentials;Dashboard visible;;\n'''
    result = parse_import("xray/csv-v1", payload)
    assert len(result["cases"]) == 1
    assert result["cases"][0]["precondiciones"] == "User is logged out"
    assert result["cases"][0]["suite_path"] == "Authentication regression"
    assert len(result["cases"][0]["pasos"]) == 2


def test_azure_csv_groups_rows_using_required_official_columns():
    payload = b'''ID,Work Item Type,Title,Test Step,Step Action,Step Expected,Area Path,Assigned To,State\n42,Test Case,Verify login,1,Open login,Form visible,Web\\Auth,qa@example.invalid,Design\n42,Test Case,Verify login,2,Submit credentials,Dashboard visible,Web\\Auth,qa@example.invalid,Design\n'''
    result = parse_import("azure-test-plans/csv-v1", payload)
    assert len(result["cases"]) == 1
    assert result["cases"][0]["suite_path"] == "Web/Auth"
    assert [step["accion"] for step in result["cases"][0]["pasos"]] == ["Open login", "Submit credentials"]


def test_qase_csv_rebuilds_nested_suites_and_numbered_steps():
    payload = b'''id,title,preconditions,steps_actions,steps_result,steps_data,suite_id,suite_parent_id,suite,suite_without_cases\n,,,,,,1,,Authentication,1\n,,,,,,2,1,Recovery,1\n7,Reset password,User exists,"1. Open recovery\n2. Submit email","1. Form visible\n2. Email sent","1. /recover\n2. qa@example.invalid",2,1,Recovery,\n'''
    result = parse_import("qase/csv-v1", payload)
    case = result["cases"][0]
    assert case["suite_path"] == "Authentication/Recovery"
    assert len(case["pasos"]) == 2
    assert case["pasos"][1]["resultado_esperado"] == "Email sent"


def test_practitest_csv_groups_continuation_step_rows():
    payload = b'''Test ID,Test Name,Folder,Step Description,Expected Result\nPT-1,Login,Smoke,Open page,Form visible\n,,,Enter credentials,Dashboard visible\nPT-2,Logout,Smoke,Click logout,Login visible\n'''
    result = parse_import("practitest/csv-v1", payload)
    assert len(result["cases"]) == 2
    assert len(result["cases"][0]["pasos"]) == 2


def test_qtest_excel_groups_modules_versions_and_step_rows():
    from openpyxl import Workbook

    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Test Cases"
    sheet.append(["Test Case ID", "Test Case Name", "Module Path", "Version", "Description", "Precondition", "Test Step Description", "Expected Result"])
    sheet.append(["TC-1", "Login", "Web\\Authentication", "2.0", "Validate login", "User active", "Open login", "Form visible"])
    sheet.append(["TC-1", "", "", "", "", "", "Submit credentials", "Dashboard visible"])
    stream = io.BytesIO()
    workbook.save(stream)
    result = parse_import("qtest/excel-v1", stream.getvalue())
    case = result["cases"][0]
    assert case["suite_path"] == "Web/Authentication"
    assert case["external_version"] == "2.0"
    assert len(case["pasos"]) == 2


def test_qase_json_preserves_nested_suites_fields_steps_and_diagnostics():
    payload = json.dumps({
        "project": {"code": "SHOP"},
        "suites": [
            {"id": 10, "title": "Checkout", "children": [{"id": 11, "title": "Guest"}]},
        ],
        "cases": [{
            "id": 42,
            "title": "Guest checkout",
            "description": "<p>Complete an order</p>",
            "preconditions": "Cart has products",
            "postconditions": "Order is stored",
            "suite_id": 11,
            "priority": "high",
            "severity": "critical",
            "automation": "automated",
            "status": "actual",
            "tags": [{"title": "smoke"}, "payments"],
            "steps_type": "classic",
            "steps": [{
                "action": "Submit order", "data": "card=valid",
                "expected_result": "Confirmation appears",
                "children": [{"action": "Open order", "expected_result": "Order is visible"}],
            }],
            "parameters": [{"name": "browser", "value": "Chromium"}],
            "attachments": ["hash-only"],
        }],
    }).encode()
    result = parse_import("qase/json-v1", payload)
    case = result["cases"][0]
    assert case["external_id"] == "SHOP-42"
    assert case["suite_path"] == "Checkout/Guest"
    assert case["descripcion"] == "Complete an order"
    assert case["postcondiciones"] == "Order is stored"
    assert case["prioridad"] == "ALTA"
    assert case["criticidad"] == "CRITICA"
    assert case["tipo_prueba"] == "AUTOMATIZADA"
    assert case["etiquetas"] == ["smoke", "payments"]
    assert len(case["pasos"]) == 2
    assert "parameters" in result["diagnostics"]["ignored_fields"]
    assert any("adjuntos" in warning for warning in result["diagnostics"]["warnings"])


def test_qase_json_accepts_documented_api_entities_and_gherkin_steps():
    payload = json.dumps({
        "status": True,
        "result": {"entities": [{
            "id": 7, "title": "Login", "suite_id": 99,
            "steps_type": "gherkin",
            "steps": [{"value": "Given an active user\nWhen the user logs in\nThen the dashboard is visible"}],
        }]},
    }).encode()
    result = parse_import("qase/json-v1", payload)
    case = result["cases"][0]
    assert case["suite_path"] == "Suite 99"
    assert [step["accion"] for step in case["pasos"]] == [
        "Given an active user", "When the user logs in", "Then the dashboard is visible",
    ]
    assert any("sin prefijo" in warning for warning in result["diagnostics"]["warnings"])
    assert any("API Qase v1" in warning for warning in result["diagnostics"]["warnings"])


def test_qase_json_rejects_unrelated_or_failed_payloads():
    with pytest.raises(PortabilityError, match="no contiene casos Qase"):
        parse_import("qase/json-v1", b'{"tests": []}')
    with pytest.raises(PortabilityError, match="respuesta API fallida"):
        parse_import("qase/json-v1", b'{"status": false, "result": {}}')


def test_zephyr_scale_xml_rebuilds_tree_rich_text_steps_and_requirements():
    payload = b'''<?xml version="1.0" encoding="UTF-8"?>
    <project><projectKey>SHOP</projectKey><modelVersion>1.0</modelVersion><testCases>
      <testCase id="1" key="SHOP-T1"><attachments/><folder>Checkout/Payments</folder>
        <issues><issue><key>SHOP-9</key></issue></issues><labels><label>regression</label></labels>
        <name>Pay by card</name><objective>Complete checkout</objective>
        <precondition>&lt;p&gt;Cart has &lt;strong&gt;items&lt;/strong&gt;&lt;/p&gt;</precondition>
        <priority>High</priority><status>Draft</status><parameters/>
        <testScript type="steps"><steps><step index="0">
          <description>&lt;p&gt;Submit card&lt;/p&gt;</description><testData>valid card</testData>
          <expectedResult>Confirmation visible</expectedResult>
        </step></steps></testScript>
      </testCase>
      <testCase id="2" key="SHOP-T2"><folder>Checkout/BDD</folder><name>Declined card</name>
        <objective>Reject invalid payment</objective><priority>Normal</priority><status>Draft</status>
        <testScript type="bdd"><details>Given an invalid card
When payment is submitted
Then the order is rejected

Examples:
| card | result |
| bad | declined |</details></testScript>
      </testCase>
      <testCase id="3" key="SHOP-T3"><folder>Checkout/Plain</folder><name>Payment notes</name>
        <objective>Document payment</objective><testScript type="plain"><details>&lt;p&gt;Plain &lt;b&gt;details&lt;/b&gt;&lt;/p&gt;</details></testScript>
      </testCase>
    </testCases></project>'''
    result = parse_import("zephyr/xml-v1", payload)
    assert len(result["cases"]) == 3
    manual = result["cases"][0]
    assert manual["external_id"] == "SHOP-T1"
    assert manual["external_version"] == "1.0"
    assert manual["suite_path"] == "Checkout/Payments"
    assert manual["precondiciones"] == "Cart has items"
    assert manual["prioridad"] == "ALTA"
    assert manual["etiquetas"] == ["regression", "requirement:SHOP-9"]
    assert manual["pasos"][0]["datos"] == "valid card"
    assert result["cases"][1]["tipo_prueba"] == "AUTOMATIZADA"
    assert len(result["cases"][1]["pasos"]) == 3
    assert result["cases"][2]["descripcion"] == "Document payment\n\nPlain details"
    assert any("no se expanden" in warning for warning in result["diagnostics"]["warnings"])


def test_zephyr_scale_xml_rejects_other_xml_and_external_entities():
    with pytest.raises(PortabilityError, match="no corresponde"):
        parse_import("zephyr/xml-v1", b"<testsuite><testcase /></testsuite>")
    malicious = b'''<?xml version="1.0"?><!DOCTYPE project [<!ENTITY secret SYSTEM "file:///etc/passwd">]>
    <project><testCases><testCase key="Z-T1"><name>&secret;</name></testCase></testCases></project>'''
    with pytest.raises(PortabilityError, match="no es válido|no permitidas"):
        parse_import("zephyr/xml-v1", malicious)


def test_zephyr_scale_json_accepts_official_values_envelope():
    payload = json.dumps({"values": [{
        "id": 1, "key": "SA-T10", "name": "Check axial pump",
        "objective": "Ensure the pump can be enabled", "precondition": "Latest pump installed",
        "labels": ["Regression"], "priority": {"name": "High"}, "status": {"name": "Approved"},
        "folder": {"id": 10, "name": "Pumps"},
        "testScript": {"steps": [{"description": "Enable pump", "testData": "mode=on", "expectedResult": "Pump starts"}]},
    }]}).encode()
    result = parse_import("zephyr/json-v1", payload)
    case = result["cases"][0]
    assert case["precondiciones"] == "Latest pump installed"
    assert case["suite_path"] == "Importados/Zephyr/Pumps"
    assert case["pasos"][0]["datos"] == "mode=on"


def test_vendor_rich_text_is_converted_without_breaking_gherkin_placeholders():
    zephyr = json.dumps({"values": [{
        "key": "Z-1", "name": "Rich text", "objective": "<p>First</p><ul><li>Second</li></ul>",
        "precondition": "Use &lt;admin&gt; account",
    }]}).encode()
    case = parse_import("zephyr/json-v1", zephyr)["cases"][0]
    assert case["descripcion"] == "First\n- Second"
    assert case["precondiciones"] == "Use <admin> account"


def test_official_gherkin_parser_expands_examples_background_and_spanish():
    payload = '''# language: es\nCaracter\u00edstica: Inicio de sesi\u00f3n\n  Antecedentes:\n    Dado un usuario activo\n  Esquema del escenario: ingresar como <rol>\n    Cuando inicia sesi\u00f3n como <rol>\n    Entonces ve el panel\n    Ejemplos:\n      | rol   |\n      | admin |\n      | qa    |\n'''.encode()
    result = parse_import("gherkin/feature-v1", payload)
    assert [case["titulo"] for case in result["cases"]] == ["ingresar como admin", "ingresar como qa"]
    assert all(len(case["pasos"]) == 3 for case in result["cases"])
    assert result["diagnostics"]["quality"] == "complete"


@pytest.mark.asyncio
async def test_import_commit_persists_tree_steps_component_build_and_audit_diagnostics():
    from uuid import uuid4

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    tables = [
        models.Organizacion.__table__, models.Proyecto.__table__,
        models.Componente.__table__, models.Build.__table__, models.Suite.__table__,
        models.CasoPrueba.__table__, models.PasoPrueba.__table__,
        models.CaseImportBatch.__table__, models.CaseExternalRef.__table__,
        models.BuildCaso.__table__,
    ]
    async with engine.begin() as connection:
        for table in tables:
            await connection.run_sync(table.create)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with session_factory() as db:
            organization = models.Organizacion(nombre="Import audit", tipo="Cliente")
            project = models.Proyecto(nombre="Import destination", organizacion=organization)
            component = models.Componente(nombre="Web", proyecto=project)
            build = models.Build(nombre="v1", proyecto=project, componente=component, activo=True)
            db.add_all([organization, project, component, build])
            await db.commit()
            payload = b'''ID,Work Item Type,Title,Test Step,Step Action,Step Expected,Area Path,State\n55,Test Case,Login,1,Open login,Form visible,Web\\Smoke,Design\n55,Test Case,Login,2,Submit credentials,Dashboard visible,Web\\Smoke,Design\n'''
            preview = await preview_import(db, project.id, "azure-test-plans/csv-v1", payload)
            assert preview["diagnostics"]["step_count"] == 2
            actor_id = uuid4()
            batch = await commit_import(
                db, project.id, "azure-test-plans/csv-v1", payload,
                "azure.csv", actor_id, ["55"], component.id, build.id,
            )
            assert batch.summary_json["diagnostics"]["step_count"] == 2
            assert await db.scalar(select(func.count()).select_from(models.CasoPrueba)) == 1
            assert await db.scalar(select(func.count()).select_from(models.PasoPrueba)) == 2
            assert await db.scalar(select(func.count()).select_from(models.Suite)) == 2
            assert await db.scalar(select(func.count()).select_from(models.BuildCaso)) == 1
            imported = (await db.execute(select(models.CasoPrueba))).scalar_one()
            assert imported.componente_id == component.id

            # A soft-deleted case keeps its external reference. Reimporting
            # the same source must restore that case instead of proposing a
            # spurious new version.
            imported.activo = False
            await db.commit()
            restore_preview = await preview_import(db, project.id, "azure-test-plans/csv-v1", payload)
            assert restore_preview["summary"]["restored"] == 1
            assert restore_preview["summary"]["new_versions"] == 0
            restored_batch = await commit_import(
                db, project.id, "azure-test-plans/csv-v1", payload,
                "azure.csv", actor_id, ["55"], component.id, build.id,
            )
            assert restored_batch.summary_json["restored"] == 1
            await db.refresh(imported)
            assert imported.activo is True
            assert imported.id == (await db.scalar(select(models.CasoPrueba.id).where(models.CasoPrueba.titulo == "Login")))

            native_values = {
                "cases.json": [
                    {"external_id": "native-classic", "codigo": "TC-NATIVE-1", "titulo": "Native classic", "formato_prueba": "CLASICA", "tipo_prueba": "MANUAL", "script_automatizado": "playwright test", "framework": "playwright", "pasos": [{"accion": "Open", "resultado_esperado": "Visible"}]},
                    {"external_id": "native-api", "codigo": "TC-NATIVE-2", "titulo": "Native API", "formato_prueba": "API", "tipo_prueba": "AUTOMATIZADA", "configuracion_api": {"request": {"method": "GET", "url": "/health"}}, "pasos": []},
                    {"external_id": "native-chat", "codigo": "TC-NATIVE-3", "titulo": "Native chatbot", "formato_prueba": "CONVERSACIONAL", "tipo_prueba": "AUTOMATIZADA_AI", "configuracion_chatbot": {"turnos": [{"mensaje": "hello"}]}, "pasos": []},
                    {"external_id": "native-perf", "codigo": "TC-NATIVE-4", "titulo": "Native performance", "formato_prueba": "PERFORMANCE", "tipo_prueba": "AUTOMATIZADA", "dataset": [{"users": "10"}], "pasos": []},
                ],
                "suites.json": [], "versions.json": [],
            }
            native_manifest = {"format": FORMAT_ID, "checksums": {key: hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest() for key, value in native_values.items()}}
            native_stream = io.BytesIO()
            with zipfile.ZipFile(native_stream, "w") as archive:
                archive.writestr("manifest.json", json.dumps(native_manifest))
                for key, value in native_values.items():
                    archive.writestr(key, json.dumps(value))
            native_batch = await commit_import(
                db, project.id, "treseko/tcases-v1", native_stream.getvalue(),
                "native.tcases", actor_id, None, component.id, build.id,
            )
            assert native_batch.summary_json["new"] == 4
            native_cases = (await db.execute(select(models.CasoPrueba).where(models.CasoPrueba.codigo.in_(["TC-NATIVE-1", "TC-NATIVE-2", "TC-NATIVE-3", "TC-NATIVE-4"])))).scalars().all()
            assert {case.formato_prueba.value for case in native_cases} == {"CLASICA", "API", "CONVERSACIONAL", "PERFORMANCE"}
            native_by_code = {case.codigo: case for case in native_cases}
            assert native_by_code["TC-NATIVE-1"].framework == "playwright"
            assert native_by_code["TC-NATIVE-2"].configuracion_api["request"]["method"] == "GET"
            assert native_by_code["TC-NATIVE-3"].configuracion_chatbot["turnos"][0]["mensaje"] == "hello"
            assert native_by_code["TC-NATIVE-4"].dataset == [{"users": "10"}]

            zephyr_xml = b'''<project><projectKey>SHOP</projectKey><testCases><testCase key="SHOP-T7">
              <folder>Checkout/Smoke</folder><name>Imported checkout</name><objective>Validate checkout</objective>
              <testScript type="steps"><steps><step><description>Submit order</description>
              <expectedResult>Order created</expectedResult></step></steps></testScript>
            </testCase></testCases></project>'''
            zephyr_preview = await preview_import(db, project.id, "zephyr/xml-v1", zephyr_xml)
            assert zephyr_preview["source_tool"] == "zephyr"
            assert zephyr_preview["summary"]["new"] == 1
            assert zephyr_preview["diagnostics"]["suite_count"] == 1
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_export_tcases_isolated_to_selected_component():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    tables = [
        models.Organizacion.__table__, models.Proyecto.__table__,
        models.Componente.__table__, models.Suite.__table__,
        models.CasoPrueba.__table__, models.PasoPrueba.__table__,
    ]
    async with engine.begin() as connection:
        for table in tables:
            await connection.run_sync(table.create)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with session_factory() as db:
            organization = models.Organizacion(nombre="Export isolation", tipo="Cliente")
            project = models.Proyecto(nombre="Scoped export", organizacion=organization)
            component_a = models.Componente(nombre="Frontend", proyecto=project)
            component_b = models.Componente(nombre="Backend", proyecto=project)
            db.add_all([organization, project, component_a, component_b])
            await db.flush()

            suite_a = models.Suite(proyecto_id=project.id, componente_id=component_a.id, nombre="Frontend suite")
            suite_b = models.Suite(proyecto_id=project.id, componente_id=component_b.id, nombre="Backend suite")
            suite_unassigned = models.Suite(proyecto_id=project.id, nombre="Legacy suite")
            db.add_all([suite_a, suite_b, suite_unassigned])
            await db.flush()
            db.add_all([
                models.CasoPrueba(master_id=uuid4(), proyecto_id=project.id, componente_id=component_a.id, suite_id=suite_a.id, codigo="TC-EXPORT-001", titulo="Frontend case", prioridad=models.Prioridad.MEDIA, tipo_prueba=models.TipoPrueba.MANUAL, dataset=[{"user": "qa"}], script_automatizado="test('login')", framework="playwright", configuracion_api={"request": {"method": "GET"}}, creado_por=uuid4()),
                models.CasoPrueba(master_id=uuid4(), proyecto_id=project.id, componente_id=component_b.id, suite_id=suite_b.id, titulo="Backend case", prioridad=models.Prioridad.MEDIA, tipo_prueba=models.TipoPrueba.MANUAL, creado_por=uuid4()),
                models.CasoPrueba(master_id=uuid4(), proyecto_id=project.id, suite_id=suite_unassigned.id, titulo="Legacy case", prioridad=models.Prioridad.MEDIA, tipo_prueba=models.TipoPrueba.MANUAL, creado_por=uuid4()),
            ])
            await db.commit()

            package = await export_tcases(db, project.id, component_a.id)
            with zipfile.ZipFile(io.BytesIO(package)) as archive:
                suites = json.loads(archive.read("suites.json"))
                cases = json.loads(archive.read("cases.json"))
            assert [suite["nombre"] for suite in suites] == ["Frontend suite"]
            assert [case["titulo"] for case in cases] == ["Frontend case"]
            imported = parse_import("treseko/tcases-v1", package)["cases"][0]
            assert imported["codigo"] == "TC-EXPORT-001"
            assert imported["dataset"] == [{"user": "qa"}]
            assert imported["script_automatizado"] == "test('login')"
            assert imported["framework"] == "playwright"
            assert imported["configuracion_api"] == {"request": {"method": "GET"}}
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_rollback_eligibility_requires_fresh_unexecuted_unchanged_cases():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    tables = [
        models.Organizacion.__table__, models.Proyecto.__table__,
        models.CaseImportBatch.__table__, models.CasoPrueba.__table__,
        models.TestRun.__table__, models.EjecucionCaso.__table__,
    ]
    async with engine.begin() as connection:
        for table in tables:
            await connection.run_sync(table.create)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with session_factory() as db:
            organization = models.Organizacion(nombre="Rollback", tipo="Cliente")
            project = models.Proyecto(nombre="Rollback destination", organizacion=organization)
            db.add_all([organization, project])
            await db.commit()

            case_id = uuid4()
            batch = models.CaseImportBatch(
                proyecto_id=project.id,
                source_tool="csv",
                source_version="v1",
                file_sha256="0" * 64,
                status="COMPLETED",
                created_case_ids=[str(case_id)],
                created_at=utc_now(),
            )
            case = models.CasoPrueba(
                id=case_id,
                master_id=uuid4(),
                proyecto_id=project.id,
                titulo="Imported case",
                prioridad=models.Prioridad.MEDIA,
                tipo_prueba=models.TipoPrueba.MANUAL,
                creado_por=uuid4(),
            )
            db.add_all([batch, case])
            await db.commit()

            eligible, reason, expires_at = await rollback_eligibility(db, batch)
            assert eligible is True
            assert reason is None
            assert expires_at is not None

            case.ultima_modificacion = utc_now() + timedelta(seconds=1)
            await db.commit()
            eligible, reason, _ = await rollback_eligibility(db, batch)
            assert eligible is False
            assert "cambios posteriores" in (reason or "")

            case.ultima_modificacion = batch.created_at
            batch.created_at = utc_now() - timedelta(hours=1, seconds=1)
            await db.commit()
            eligible, reason, _ = await rollback_eligibility(db, batch)
            assert eligible is False
            assert "ventana" in (reason or "")

            batch.created_at = utc_now()
            case.ultima_modificacion = batch.created_at
            run = models.TestRun(
                proyecto_id=project.id,
                nombre="Imported execution",
                entorno="QA",
                creado_por=uuid4(),
            )
            db.add(run)
            await db.flush()
            db.add(models.EjecucionCaso(
                test_run_id=run.id,
                caso_id=case.id,
                version_ejecutada=case.version,
                ejecutado_por=uuid4(),
            ))
            await db.commit()
            eligible, reason, _ = await rollback_eligibility(db, batch)
            assert eligible is False
            assert "ejecuciones" in (reason or "")
    finally:
        await engine.dispose()
