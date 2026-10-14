from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace


BACKEND_DIR = Path(__file__).resolve().parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app import auth, models  # noqa: E402
from scripts.audit_rbac_routes import audit_file, audit_routes  # noqa: E402


def make_user(role, permisos=None, modulos=None):
    return SimpleNamespace(
        rol=role,
        permisos=permisos or {},
        modulos=modulos or [],
        rol_personalizado=None,
    )


def test_role_permissions_matrix():
    admin = make_user(models.Rol.ADMIN)
    qa_lead = make_user(models.Rol.QA_LEAD)
    tester = make_user(models.Rol.TESTER)
    viewer = make_user(models.Rol.VIEWER)

    assert auth.has_module_permission(admin, "configuracion", "edit")
    assert auth.has_module_permission(qa_lead, "proyectos", "edit")
    assert not auth.has_module_permission(qa_lead, "configuracion", "edit")
    assert auth.has_module_permission(tester, "ejecutar", "edit")
    assert not auth.has_module_permission(tester, "configuracion", "read")
    assert auth.has_module_permission(viewer, "reportes", "read")
    assert not auth.has_module_permission(viewer, "ejecutar", "edit")


def test_route_audit_detects_core_rbac_contracts():
    rows = audit_routes()
    by_route = {(row.method, row.path): row for row in rows}

    assert by_route[("POST", "/auth/login/")].status == "PUBLIC_INTENTIONAL"
    assert by_route[("GET", "/usuarios/")].module == "configuracion"
    assert by_route[("POST", "/proyectos/")].module == "proyectos"
    assert by_route[("POST", "/proyectos/")].level == "edit:proyectos.portfolio"
    assert by_route[("GET", "/dashboard/summary")].module == "dashboard"
    assert by_route[("GET", "/s/reports/{token}")].status == "PUBLIC_INTENTIONAL"
    assert by_route[("GET", "/debug/proyectos")].status == "OK"
    assert by_route[("GET", "/debug/proyectos")].level == "read:configuracion.monitor"
    assert by_route[("POST", "/attachments/")].status == "OK"
    assert by_route[("POST", "/attachments/")].level.startswith("manual:")
    assert by_route[("GET", "/ejecuciones/{ejecucion_id}/ai-report/")].status == "OK"
    assert "motor_ia.logs" in by_route[("GET", "/ejecuciones/{ejecucion_id}/ai-report/")].level
    assert by_route[("GET", "/system/updates/channels")].status == "OK"
    assert by_route[("POST", "/system/updates/sync-premium")].status == "OK"
    assert by_route[("POST", "/bugs")].status == "OK"
    assert "bugs.ver" in by_route[("POST", "/bugs")].level
    assert "bugs.crear" in by_route[("POST", "/bugs")].level
    assert by_route[("POST", "/auth/logout/")].module == "self_service"
    assert by_route[("GET", "/system/features")].level == "authenticated-metadata"
    assert by_route[("GET", "/case-portability/profiles")].status == "OK"
    assert by_route[("GET", "/extensions/catalog")].status == "OK"
    assert by_route[("GET", "/test-runs/{run_id}/api-progress")].module == "ejecutar"
    assert by_route[("GET", "/test-runs/{run_id}/api-progress")].level == "read:ejecutar.ver"
    assert not [row for row in rows if row.status == "MISSING_CHECK_MODULE"]

    expected_review = {
        ("POST", "/ai-engine/executions/{ejecucion_id}/result"),
        ("POST", "/external/executions/report"),
        ("GET", "/automation-runners/me"),
        ("POST", "/automation-runners/{runner_id}/heartbeat"),
        ("GET", "/automation-jobs/next"),
        ("POST", "/automation-jobs/{job_id}/claim"),
        ("POST", "/automation-jobs/{job_id}/result"),
        ("POST", "/automation-jobs/{job_id}/claim-intents/{attempt_id}/reconcile"),
        ("POST", "/automation-jobs/{job_id}/result-uploads/{event_id}"),
        ("PUT", "/automation-jobs/{job_id}/result-uploads/{event_id}/{offset}"),
        ("POST", "/automation-jobs/{job_id}/result-uploads/{event_id}/complete"),
        ("GET", "/mcp/tools"),
        ("POST", "/mcp/internal/runtime-credential"),
    }
    assert {(row.method, row.path) for row in rows if row.status == "REVIEW"} == expected_review


def test_route_audit_normalizes_mcp_root_and_marks_technical_authentication():
    rows = {(row.method, row.path): row for row in audit_routes()}

    assert rows[("POST", "/mcp")].auth == "USER"
    assert rows[("POST", "/mcp")].status == "OK"
    assert rows[("GET", "/mcp/tools")].auth == "API_KEY"
    assert rows[("GET", "/mcp/tools")].status == "REVIEW"
    assert rows[("POST", "/mcp/internal/runtime-credential")].auth == "API_KEY"
    assert rows[("POST", "/mcp/internal/runtime-credential")].level == "internal-token"
    assert rows[("POST", "/mcp/internal/runtime-credential")].status == "REVIEW"


def test_route_audit_does_not_accept_capability_names_in_strings_or_comments(tmp_path):
    module = tmp_path / "unsafe_router.py"
    module.write_text(
        """
from fastapi import APIRouter, Depends
router = APIRouter()

@router.get('/unsafe')
async def unsafe(current_user=Depends(get_current_active_user)):
    # auth.check_capability('bugs.ver', 'read')
    return {'note': \"_assert_capability(user, 'bugs.ver', 'read')\"}
""",
        encoding="utf-8",
    )

    rows = audit_file(module)
    assert len(rows) == 1
    assert rows[0].status == "MISSING_CHECK_MODULE"


def test_route_audit_does_not_treat_resource_scope_as_functional_permission(tmp_path):
    module = tmp_path / "scope_only_router.py"
    module.write_text(
        """
from fastapi import APIRouter, Depends
router = APIRouter()

@router.get('/scope-only')
async def scope_only(current_user=Depends(get_current_active_user)):
    await access_control.require_project_access(db, current_user, project_id, 'read')
    return {}
""",
        encoding="utf-8",
    )

    rows = audit_file(module)
    assert len(rows) == 1
    assert rows[0].status == "MISSING_CHECK_MODULE"
    assert rows[0].level.startswith("scope-only:")


def test_route_audit_rejects_lookalike_auth_receiver(tmp_path):
    module = tmp_path / "lookalike_auth_router.py"
    module.write_text(
        """
from fastapi import APIRouter, Depends
router = APIRouter()

@router.get('/unsafe')
async def unsafe(current_user=Depends(get_current_active_user)):
    fake.check_capability('bugs.ver', 'read')
    return {}
""",
        encoding="utf-8",
    )

    rows = audit_file(module)
    assert len(rows) == 1
    assert rows[0].status == "MISSING_CHECK_MODULE"


def test_route_audit_rejects_statically_unreachable_auth_check(tmp_path):
    module = tmp_path / "dead_auth_router.py"
    module.write_text(
        """
from fastapi import APIRouter, Depends
router = APIRouter()

@router.get('/unsafe')
async def unsafe(current_user=Depends(get_current_active_user)):
    if False:
        auth.check_capability('bugs.ver', 'read')
    return {}
""",
        encoding="utf-8",
    )

    rows = audit_file(module)
    assert len(rows) == 1
    assert rows[0].status == "MISSING_CHECK_MODULE"


def test_route_audit_rejects_conditional_auth_check(tmp_path):
    module = tmp_path / "conditional_auth_router.py"
    module.write_text(
        """
from fastapi import APIRouter, Depends
router = APIRouter()

@router.get('/unsafe')
async def unsafe(payload, current_user=Depends(get_current_active_user)):
    if payload.admin:
        auth.check_capability('bugs.ver', 'read')
    return sensitive_operation()
""",
        encoding="utf-8",
    )

    rows = audit_file(module)
    assert rows[0].status == "MISSING_CHECK_MODULE"


def test_route_audit_rejects_auth_check_after_return(tmp_path):
    module = tmp_path / "post_return_auth_router.py"
    module.write_text(
        """
from fastapi import APIRouter, Depends
router = APIRouter()

@router.get('/unsafe')
async def unsafe(current_user=Depends(get_current_active_user)):
    return sensitive_operation()
    auth.check_capability('bugs.ver', 'read')
""",
        encoding="utf-8",
    )

    rows = audit_file(module)
    assert rows[0].status == "MISSING_CHECK_MODULE"


def test_route_audit_accepts_fail_closed_permission_guard(tmp_path):
    module = tmp_path / "guarded_router.py"
    module.write_text(
        """
from fastapi import APIRouter, Depends, HTTPException
router = APIRouter()

@router.get('/guarded')
async def guarded(current_user=Depends(get_current_active_user)):
    if not auth.has_capability_permission(current_user, 'bugs.ver', 'read'):
        raise HTTPException(status_code=403)
    return sensitive_operation()
""",
        encoding="utf-8",
    )

    rows = audit_file(module)
    assert rows[0].status == "OK"
    assert rows[0].level == "manual:bugs.ver"


def test_route_audit_rejects_wrong_delegated_capability(tmp_path):
    module = tmp_path / "extensions.py"
    module.write_text(
        """
from fastapi import APIRouter, Depends
router = APIRouter()

@router.delete('/plugins/store/{instance_id}')
async def uninstall_official_store_plugin(current_user=Depends(get_current_active_user)):
    _assert_capability(current_user, 'plugins.instalar', 'edit')
    await _load_instance(db, current_user, instance_id, 'edit')
""",
        encoding="utf-8",
    )

    rows = audit_file(module)
    assert len(rows) == 1
    assert rows[0].status == "MISSING_CHECK_MODULE"


if __name__ == "__main__":
    test_role_permissions_matrix()
    test_route_audit_detects_core_rbac_contracts()
    print("RBAC checks OK")
