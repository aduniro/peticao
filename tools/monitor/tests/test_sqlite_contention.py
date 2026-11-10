import concurrent.futures
import json
import sqlite3
import sys
import threading
import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from vigia_monitor import store as current




@pytest.fixture
def short_busy(monkeypatch):
    # Same real SQLite driver/locking; only shorten the fixture's wait budget.
    connect = sqlite3.connect

    class FixtureConnection(sqlite3.Connection):
        def execute(self, sql, parameters=(), /):
            if sql.startswith("PRAGMA busy_timeout="):
                sql = "PRAGMA busy_timeout=25"
            return super().execute(sql, parameters)

    def open_fixture(*args, **kwargs):
        kwargs["factory"] = FixtureConnection
        return connect(*args, **kwargs)

    monkeypatch.setattr(sqlite3, "connect", open_fixture)


def hold_writer(path):
    writer = sqlite3.connect(path)
    writer.execute("BEGIN IMMEDIATE")
    return writer


def schema(path):
    with sqlite3.connect(path) as db:
        tables = [r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
        return {name: [tuple(r) for r in db.execute("PRAGMA table_info(" + name + ")")] for name in tables}




def test_ready_store_is_readable_under_writer_without_schema_write(tmp_path, short_busy):
    path = tmp_path / "ready.sqlite"
    s = current.Store(path)
    s.task("fixture", title="Fictitious", state="waiting")
    writer = hold_writer(path)
    try:
        again = current.Store(path)
        assert again.rows("SELECT title FROM tasks")[0]["title"] == "Fictitious"
        # Runtime writes retain the old behavior; no global retry/replay wrapper.
        with pytest.raises(sqlite3.OperationalError) as exc:
            again.event("fixture", "Not committed")
        assert current.sqlite_busy(exc.value)
    finally:
        writer.rollback()
        writer.close()
    assert not s.rows("SELECT * FROM events")


def test_constructor_retry_is_bounded_to_schema_and_succeeds_after_release(tmp_path, short_busy):
    path = tmp_path / "new.sqlite"
    ready = threading.Event()

    def writer():
        db = sqlite3.connect(path)
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("BEGIN IMMEDIATE")
        ready.set()
        time.sleep(.07)
        db.rollback()
        db.close()

    thread = threading.Thread(target=writer)
    thread.start()
    assert ready.wait(2)
    s = current.Store(path)
    thread.join(2)
    assert not thread.is_alive()
    assert s.rows("SELECT count(*) n FROM tasks")[0]["n"] == 0
    assert not s.rows("SELECT * FROM requests")


def test_constructor_budget_exhausts_without_replaying_work(tmp_path, short_busy):
    path = tmp_path / "blocked.sqlite"
    with sqlite3.connect(path) as db:
        db.execute("PRAGMA journal_mode=WAL")
    writer = hold_writer(path)
    start = time.monotonic()
    try:
        with pytest.raises(sqlite3.OperationalError) as exc:
            current.Store(path)
        assert current.sqlite_busy(exc.value)
        assert time.monotonic() - start < 2
    finally:
        writer.rollback()
        writer.close()
    with sqlite3.connect(path) as db:
        assert not db.execute("SELECT 1 FROM sqlite_master WHERE name='requests'").fetchone()


def test_concurrent_initialization_and_existing_writer_are_serialized(tmp_path, short_busy):
    path = tmp_path / "concurrent.sqlite"
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        stores = list(pool.map(lambda _: current.Store(path), range(4)))
    expected = schema(path)
    writer = hold_writer(path)
    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            list(pool.map(lambda _: current.Store(path), range(4)))
    finally:
        writer.rollback()
        writer.close()
    assert schema(path) == expected
    assert len(stores) == 4


def test_legacy_migrations_keep_schema_data_quota_and_durability(tmp_path, short_busy):
    path = tmp_path / "upgrade.sqlite"
    s = current.Store(path)
    s.task("fixture", title="Preserve me", state="waiting")
    s.execute("INSERT INTO quota_policy VALUES('fixture','2026-01-01')")
    before_schema = schema(path)
    s.execute("ALTER TABLE workflow_steps DROP COLUMN require_report")
    s.execute("ALTER TABLE requests DROP COLUMN activity_count")
    current.Store(path)
    semantic = lambda value: {name: {col[1]: col[2:] for col in columns} for name, columns in value.items()}
    assert semantic(schema(path)) == semantic(before_schema)
    assert s.rows("SELECT title FROM tasks")[0]["title"] == "Preserve me"
    assert s.rows("SELECT enabled_since FROM quota_policy")[0]["enabled_since"] == "2026-01-01"
    for target in [path]:
        with sqlite3.connect(target) as db:
            assert db.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
            assert db.execute("PRAGMA synchronous").fetchone()[0] == 2


def test_non_busy_initialization_errors_are_not_retried(tmp_path, monkeypatch):
    calls = []

    def fail(self, db):
        calls.append(1)
        raise sqlite3.OperationalError("fixture schema failure")

    monkeypatch.setattr(current.Store, "_initialize_schema", fail)
    with pytest.raises(sqlite3.OperationalError, match="fixture schema failure"):
        current.Store(tmp_path / "bad.sqlite")
    assert calls == [1]


def daemon_fixture(module, store, monkeypatch, *, shutdown_lock=False):
    writers = []
    pools = []
    collectors = []

    class Stop:
        def __init__(self):
            self.stopped = False
            self.waits = 0

        def is_set(self):
            return self.stopped

        def set(self):
            self.stopped = True

        def wait(self, seconds):
            assert seconds >= .2
            self.waits += 1
            if not shutdown_lock and self.waits == 1:
                for writer in writers:
                    writer.rollback()
                    writer.close()
                writers.clear()
            if self.waits >= (1 if shutdown_lock else 2):
                self.stopped = True

    class Future:
        def done(self):
            return False

    class Pool:
        def __init__(self, **kwargs):
            self.submits = []
            pools.append(self)

        def submit(self, fn, *args):
            self.submits.append((fn, args[1]["id"]))
            return Future()  # Deliberately never execute the requested effect.

        def shutdown(self, **kwargs):
            pass

    class Collector:
        def __init__(self, *args):
            self.calls = 0
            self.remote = type("RemoteDisabled", (), {"enabled": False})()
            collectors.append(self)

        def collect(self, **kwargs):
            self.calls += 1
            if self.calls == 1 and not shutdown_lock:
                writers.append(hold_writer(store.path))
            store.snapshot("fixture", {"fictitious": True})

        def stop(self):
            if shutdown_lock:
                writers.append(hold_writer(store.path))

    monkeypatch.setattr(module, "STATE", store.path.parent / "daemon-state")
    monkeypatch.setattr(module, "Collector", Collector)
    monkeypatch.setattr(module, "Supervisor", lambda _: type("NoWork", (), {"advance": lambda _: None})())
    monkeypatch.setattr(module.concurrent.futures, "ThreadPoolExecutor", Pool)
    monkeypatch.setattr(module.signal, "signal", lambda *args: None)
    daemon = module.Daemon(store, remote=False, mail=False)
    daemon.stop = Stop()
    return daemon, pools, collectors, writers


def close_writers(writers):
    for writer in writers:
        writer.rollback()
        writer.close()




def test_daemon_survives_busy_then_resumes_without_duplicate_claim(tmp_path, short_busy, monkeypatch, capsys):
    from vigia_monitor import daemon as module
    store = current.Store(tmp_path / "daemon-fixed.sqlite")
    store.task("fixture", title="Fictitious only", state="running")
    request = store.request("fixture", "shell", "DO_NOT_EXECUTE_FIXTURE")
    daemon, pools, collectors, writers = daemon_fixture(module, store, monkeypatch)
    try:
        daemon.run()
    finally:
        close_writers(writers)
    assert collectors[0].calls == 2
    assert pools[0].submits == [(module.execute_request, request)]
    assert len(store.rows("SELECT * FROM requests")) == 1
    assert store.rows("SELECT state FROM requests")[0]["state"] == "running"
    warnings = [json.loads(line) for line in capsys.readouterr().err.splitlines()]
    assert {line["phase"] for line in warnings} >= {"event", "tick"}
    assert all(line["monitor_warning"] == "sqlite_busy" for line in warnings)
    assert "DO_NOT_EXECUTE_FIXTURE" not in str(warnings)
    assert store.rows("SELECT status FROM snapshots WHERE source='daemon'")[0]["status"] == "stopped"


def test_shutdown_diagnostics_do_not_throw_when_writer_remains_busy(tmp_path, short_busy, monkeypatch, capsys):
    from vigia_monitor import daemon as module
    store = current.Store(tmp_path / "shutdown.sqlite")
    daemon, pools, collectors, writers = daemon_fixture(module, store, monkeypatch, shutdown_lock=True)
    try:
        daemon.run()
    finally:
        close_writers(writers)
    warnings = [json.loads(line) for line in capsys.readouterr().err.splitlines()]
    assert {line["phase"] for line in warnings} == {"shutdown_snapshot", "shutdown_event", "shutdown_notice"}
    assert not pools[0].submits
    # Do not manufacture a durable 'stopped' heartbeat when persistence failed.
    assert store.rows("SELECT status FROM snapshots WHERE source='daemon'")[0]["status"] == "online"
    assert len(store.rows("SELECT * FROM outbox")) == 1  # Startup only, no resend.


def test_notification_effect_then_busy_persistence_is_never_resent(tmp_path, short_busy, monkeypatch, capsys):
    from types import SimpleNamespace
    from vigia_monitor import daemon as module, notifications
    store = current.Store(tmp_path / "mail-effect.sqlite")
    store.queue_mail("fixture-mail", "Fictitious", "Never actually sent")
    calls = []
    writers = []
    provider_called = threading.Event()

    def provider(*args, **kwargs):
        calls.append(1)
        writer = sqlite3.connect(store.path, check_same_thread=False)
        writer.execute("BEGIN IMMEDIATE")
        writers.append(writer)
        provider_called.set()
        return SimpleNamespace(returncode=0, stdout='{"status":202,"id":"fixture-provider"}')

    monkeypatch.setattr(notifications.subprocess, "run", provider)
    monkeypatch.setattr(module, "Collector", lambda *args: SimpleNamespace(collect=lambda **kwargs: None, stop=lambda: None, remote=SimpleNamespace(enabled=False)))
    monkeypatch.setattr(module, "Supervisor", lambda _: SimpleNamespace(advance=lambda: None))
    daemon = module.Daemon(store, remote=False, mail=True)

    def wait_idle():
        deadline = time.monotonic() + 2
        while daemon.mail_busy and time.monotonic() < deadline:
            time.sleep(.005)
        assert not daemon.mail_busy

    try:
        daemon._tick(1)
        assert provider_called.wait(2)
        wait_idle()
        close_writers(writers)
        writers.clear()
        assert store.rows("SELECT state FROM outbox")[0]["state"] == "sending"
        daemon._tick(2)
        wait_idle()
        assert calls == [1]
        assert not store.rows("SELECT * FROM mail")  # No fabricated acceptance.
        store.recover()
        assert store.rows("SELECT state FROM outbox")[0]["state"] == "uncertain"
        daemon._tick(3)
        wait_idle()
        assert calls == [1]
        assert store.rows("SELECT state FROM mail")[0]["state"] == "uncertain"
        warnings = [json.loads(line) for line in capsys.readouterr().err.splitlines()]
        assert [line["phase"] for line in warnings] == ["notifications"]
    finally:
        close_writers(writers)
        daemon.pool.shutdown(wait=True, cancel_futures=True)
