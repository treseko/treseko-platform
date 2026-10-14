from types import SimpleNamespace
from uuid import uuid4
import pytest
from app.main import app
from app.services.automation_dispatch_scope import validate_worker_job_scope

async def test_revoked_actor_cannot_claim_or_renew_execution():
    class Db:
        async def execute(self,*args):return SimpleNamespace(scalar_one_or_none=lambda:SimpleNamespace(activo=False))
    with pytest.raises(ValueError,match='usuario'):
        await validate_worker_job_scope(Db(),SimpleNamespace(creado_por=uuid4(),job_type='EXECUTION'))

async def test_api_suite_revalidates_every_frozen_case(monkeypatch):
    from app.services import automation_dispatch_scope as scope
    from app import models
    project_id,org_id,build_id,case_id=uuid4(),uuid4(),uuid4(),uuid4()
    class Db:
        async def execute(self,*args):return SimpleNamespace(scalar_one_or_none=lambda:SimpleNamespace(activo=True))
        async def get(self,model,key):
            if model is models.Proyecto:return SimpleNamespace(organizacion_id=org_id)
            if model is models.Build:return SimpleNamespace(proyecto_id=project_id,componente_id=uuid4(),activo=True,estado='ACTIVA')
            if model is models.CasoPrueba:return SimpleNamespace(activo=False)
    monkeypatch.setattr(scope.auth,'has_capability_permission',lambda *args:True)
    monkeypatch.setattr(scope.auth,'has_module_permission',lambda *args:True)
    async def allowed(*args):pass
    monkeypatch.setattr(scope.access_control,'require_project_access',allowed)
    job=SimpleNamespace(creado_por=uuid4(),job_type='API_EXECUTION',proyecto_id=project_id,organizacion_id=org_id,build_id=build_id,caso_id=None)
    monkeypatch.setattr(scope,'worker_payload',lambda job:{'cases':[{'case_id':str(case_id)}]})
    with pytest.raises(ValueError,match='caso'):
        await scope.validate_worker_job_scope(Db(),job)
