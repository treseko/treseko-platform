from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from ... import auth, crud, models, schemas
from ...database import get_db


router = APIRouter(tags=["System Monitor"])


@router.get("/system-monitor/summary", response_model=schemas.SystemMonitorSummary)
async def get_system_monitor_summary(
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("configuracion.monitor", "read")),
):
    return await crud.get_system_monitor_summary(db)
