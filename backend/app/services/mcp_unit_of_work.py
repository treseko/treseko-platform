"""Keep domain commits, mutation receipt and audit in one outer transaction."""
from contextlib import asynccontextmanager

from sqlalchemy.ext.asyncio import AsyncSession


@asynccontextmanager
async def mutation_session(session_factory):
    # Existing domain repositories commit at their normal public API boundary.
    # Those commits release only a savepoint here. No mutation becomes visible
    # until its receipt and audit have also been successfully persisted.
    async with session_factory() as owner:
        connection = await owner.connection()
        async with AsyncSession(bind=connection, expire_on_commit=False, join_transaction_mode="create_savepoint") as session:
            try:
                yield session
                await session.commit()
                await owner.commit()
            except BaseException:
                await session.rollback()
                await owner.rollback()
                raise
