from __future__ import annotations

from typing import Any

from .database import Database


Record = dict[str, Any]


class RepositoryBase:
    def __init__(self, database: Database) -> None:
        self._database = database

    async def healthcheck(self) -> bool:
        return await self._database.healthcheck()
