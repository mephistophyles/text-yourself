import hashlib
from pathlib import Path
import re


def test_every_forward_migration_has_a_down_migration():
    migration_path = Path("migrations")
    forwards = {
        path.name for path in migration_path.glob("*.sql") if not path.name.endswith(".down.sql")
    }
    downs = {path.name.removesuffix(".down.sql") + ".sql" for path in migration_path.glob("*.down.sql")}
    assert forwards == downs


def _forward_migrations() -> list[Path]:
    return sorted(
        path for path in Path("migrations").glob("*.sql") if not path.name.endswith(".down.sql")
    )


def test_all_application_tables_enable_and_force_rls_with_policies():
    """Every table any migration creates must be covered, not just the first one."""
    created = []
    for path in _forward_migrations():
        sql = path.read_text()
        for table in re.findall(r"CREATE TABLE (\w+)", sql):
            created.append(table)
            assert f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY" in sql
            assert f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY" in sql
            assert re.search(rf"CREATE POLICY \w+ ON {table}", sql)
    assert created == ["topics", "messages", "voice_notes"]


def test_applied_migrations_are_never_edited_in_place():
    """A migration is recorded by filename, so an edit never reaches a live database.

    This pins the checksum of every migration that has shipped. Changing one is
    a deliberate act that has to update this list and reason about deployed
    databases; the default outcome is a failing test, not a silent no-op.
    """
    shipped = {
        "001_initial.sql": "c661293c9212eb56da268fd2d5d50f7f",
    }
    for name, digest in shipped.items():
        actual = hashlib.md5(Path("migrations", name).read_bytes()).hexdigest()
        assert actual == digest, f"{name} was edited after being applied; add a new migration"


def test_runtime_paths_are_explicit_environment_defaults():
    app_source = Path("src/text_yourself/config.py").read_text()
    migration_source = Path("src/text_yourself/migrate.py").read_text()
    assert 'WEB_DIST_PATH", "/app/web-dist"' in app_source
    assert 'MIGRATIONS_PATH", "/app/migrations"' in migration_source
    assert "__file__" not in app_source
    assert "__file__" not in migration_source
