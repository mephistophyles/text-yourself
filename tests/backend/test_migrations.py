from pathlib import Path
import re


def test_every_forward_migration_has_a_down_migration():
    migration_path = Path("migrations")
    forwards = {
        path.name for path in migration_path.glob("*.sql") if not path.name.endswith(".down.sql")
    }
    downs = {path.name.removesuffix(".down.sql") + ".sql" for path in migration_path.glob("*.down.sql")}
    assert forwards == downs


def test_all_application_tables_enable_and_force_rls_with_policies():
    sql = Path("migrations/001_initial.sql").read_text()
    tables = re.findall(r"CREATE TABLE (\w+)", sql)
    assert tables == ["topics", "messages"]
    for table in tables:
        assert f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY" in sql
        assert f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY" in sql
        assert re.search(rf"CREATE POLICY \w+ ON {table}", sql)


def test_runtime_paths_are_explicit_environment_defaults():
    app_source = Path("src/text_yourself/config.py").read_text()
    migration_source = Path("src/text_yourself/migrate.py").read_text()
    assert 'WEB_DIST_PATH", "/app/web-dist"' in app_source
    assert 'MIGRATIONS_PATH", "/app/migrations"' in migration_source
    assert "__file__" not in app_source
    assert "__file__" not in migration_source
