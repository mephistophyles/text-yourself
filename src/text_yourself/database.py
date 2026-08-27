from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from uuid import UUID

from psycopg import AsyncConnection
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

from .config import Settings
from .identity import Identity


class Database:
    def __init__(self, settings: Settings) -> None:
        self._household_id = settings.household_id
        self._pool = AsyncConnectionPool(
            conninfo=settings.database_url,
            min_size=settings.pool_min_size,
            max_size=settings.pool_max_size,
            open=False,
            kwargs={"row_factory": dict_row},
        )

    async def open(self) -> None:
        await self._pool.open(wait=True, timeout=10)

    async def close(self) -> None:
        await self._pool.close()

    async def healthcheck(self) -> bool:
        async with self._pool.connection(timeout=5) as connection:
            row = await connection.execute("SELECT 1 AS healthy")
            result = await row.fetchone()
            return bool(result and result["healthy"] == 1)

    @asynccontextmanager
    async def transaction(self, identity: Identity) -> AsyncIterator[AsyncConnection]:
        async with self._pool.connection() as connection:
            async with connection.transaction():
                await connection.execute(
                    "SELECT set_config('app.household_id', %s, true), "
                    "set_config('app.user_id', %s, true)",
                    (str(self._household_id), identity.user_id),
                )
                yield connection

    @property
    def household_id(self) -> UUID:
        return self._household_id
