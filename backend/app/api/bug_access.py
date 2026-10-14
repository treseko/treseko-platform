from fastapi import HTTPException

from .. import crud, models
from sqlalchemy.ext.asyncio import AsyncSession


async def ensure_bug_build_is_active(db: AsyncSession, bug: models.BugIssue) -> None:
    try:
        await crud.ensure_bug_build_is_active(db, bug)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
