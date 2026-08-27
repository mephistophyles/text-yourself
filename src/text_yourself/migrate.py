from __future__ import annotations

import os
import re
from pathlib import Path

import psycopg


MIGRATION_PATTERN = re.compile(r"^\d+_[a-z0-9_]+\.sql$")


def main() -> None:
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL is required")
    migrations_path = Path(os.environ.get("MIGRATIONS_PATH", "/app/migrations"))
    if not migrations_path.is_dir():
        raise RuntimeError(f"MIGRATIONS_PATH not found at {migrations_path}")

    migrations = sorted(
        path for path in migrations_path.iterdir() if MIGRATION_PATTERN.fullmatch(path.name)
    )
    with psycopg.connect(database_url) as connection:
        with connection.transaction():
            connection.execute("SELECT pg_advisory_xact_lock(hashtext('text-yourself:migrations'))")
            _ensure_ledger(connection)
            applied = {
                row[0]
                for row in connection.execute(
                    "SELECT name FROM schema_migrations ORDER BY name"
                ).fetchall()
            }
            for migration in migrations:
                if migration.name in applied:
                    continue
                connection.execute(migration.read_text(encoding="utf-8"))
                connection.execute(
                    "INSERT INTO schema_migrations (name) VALUES (%s)", (migration.name,)
                )


def _ensure_ledger(connection: psycopg.Connection) -> None:
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS schema_migrations (
            name TEXT PRIMARY KEY,
            applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY;
        ALTER TABLE schema_migrations FORCE ROW LEVEL SECURITY;
        DO $$ BEGIN
            CREATE POLICY schema_migrations_runner ON schema_migrations
                USING (true) WITH CHECK (true);
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$;
        """
    )


if __name__ == "__main__":
    main()
