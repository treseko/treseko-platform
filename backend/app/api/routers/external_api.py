from fastapi import APIRouter

from ...main_context import *
from ...services.edition.entitlement_service import require_feature


router = APIRouter(tags=["APIs externas"], dependencies=[Depends(require_feature("external_api.basic_report"))])
MAX_EXTERNAL_API_KEY_LENGTH = 128


def _normalize_external_api_key(value: Optional[str]) -> str:
    api_key = (value or "").strip()
    if (
        not api_key
        or len(api_key) > MAX_EXTERNAL_API_KEY_LENGTH
        or any(char.isspace() for char in api_key)
        or "\x00" in api_key
    ):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="API key invalida o inactiva")
    return api_key

async def get_external_api_user(
    authorization: Optional[str] = Header(default=None),
    x_qa_api_key: Optional[str] = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    api_key = x_qa_api_key
    if not api_key and authorization:
        scheme, _, token = authorization.partition(" ")
        if scheme.lower() == "bearer" and token:
            api_key = token
    if not api_key:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="API key requerida")
    api_key = _normalize_external_api_key(api_key)
    user = await crud.get_user_by_api_key(db, api_key)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="API key invalida o inactiva")
    if not auth.has_module_permission(user, "ejecutar", "edit"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="El usuario no tiene permiso para ejecutar pruebas")
    return user

@router.post("/external/executions/report", response_model=schemas.ExternalExecutionReportResponse)
async def report_external_execution(
    payload: schemas.ExternalExecutionReport,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(get_external_api_user),
):
    try:
        response = await crud.record_external_execution_report(db, payload, current_user)
        if response.run_id:
            run_result = await db.execute(
                select(models.TestRun, models.Build)
                .outerjoin(models.Build, models.Build.id == models.TestRun.build_id)
                .filter(models.TestRun.id == response.run_id)
            )
            row = run_result.first()
            if row:
                run, build = row
                await realtime_event_bus.publish(
                    run.proyecto_id,
                    "execution.run.updated",
                    actor_id=current_user.id,
                    component_id=build.componente_id if build else None,
                    build_id=run.build_id,
                    run_id=run.id,
                    payload={
                        "run": {
                            "id": str(run.id),
                            "origen": run.origen,
                            "external_run_id": run.external_run_id,
                        },
                        "processed": response.processed,
                        "rejected": response.rejected,
                    },
                )
                await realtime_event_bus.publish(
                    run.proyecto_id,
                    "report.metrics.invalidated",
                    actor_id=current_user.id,
                    component_id=build.componente_id if build else None,
                    build_id=run.build_id,
                    run_id=run.id,
                    payload={"source": "external.execution.report"},
                )
        return response
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


router.export_symbols = {"get_external_api_user": get_external_api_user}
