import json

import pytest

from app.services.update_transaction import TransactionFailure, UpdateTransaction


RELEASE = {"version": "1.0.3", "checksum_sha256": "a" * 64}


class Host:
    """Disk-backed participant double; transport and process probes are separate E2E."""
    def __init__(self, root):
        self.root = root
        root.mkdir()
        (root / "runtime").write_text("1.0.2")
        self.offline = False
        self.fail_operation = None
        self.crash_after_apply = False
        self.calls = []

    def can_abort_unmutated(self, transaction):
        return not (self.root / "backup").exists()

    def execute(self, operation, transaction, release):
        self.calls.append(operation)
        if self.offline:
            raise ConnectionError("unavailable")
        if self.fail_operation == operation:
            return {"ok": False}
        version = self.root / "runtime"
        backup = self.root / "backup"
        if operation == "prepare":
            if not backup.exists():
                backup.write_text(version.read_text())
            return {"ok": True, "previous_version": backup.read_text()}
        if operation == "apply":
            version.write_text(release["version"])
            if self.crash_after_apply:
                raise KeyboardInterrupt("coordinator terminated after remote write")
        if operation == "rollback":
            version.write_text(backup.read_text())
        return {"ok": True, "version": version.read_text(), "transaction": transaction}


def inventory(tmp_path):
    return {name: Host(tmp_path / name) for name in ("backend", "remote-engine", "remote-worker")}


def test_success_and_repeat_does_not_apply_twice(tmp_path):
    hosts = inventory(tmp_path)
    coordinator = UpdateTransaction(tmp_path / "journal.json", hosts)
    assert coordinator.run("tx-1", RELEASE)["status"] == "complete"
    for host in hosts.values():
        assert (host.root / "runtime").read_text() == "1.0.3"
    coordinator.run("tx-1", RELEASE)
    assert all(host.calls.count("apply") == 1 for host in hosts.values())


@pytest.mark.parametrize('rollback', [False, True])
def test_ordered_activation_stops_at_unacknowledged_predecessor_and_replays(tmp_path, rollback):
    hosts = inventory(tmp_path)
    order = ['remote-engine', 'backend', 'remote-worker']
    events = []
    for name, host in hosts.items():
        original = host.execute
        def observe(operation, transaction, release, *, name=name, original=original):
            if operation == 'activate':
                events.append(name)
            return original(operation, transaction, release)
        host.execute = observe
    if rollback:
        hosts['remote-worker'].fail_operation = 'verify'
    hosts['remote-engine'].fail_operation = 'activate'
    journal = tmp_path / 'journal.json'
    result = UpdateTransaction(journal, hosts, activation_order=order).run('tx-1', RELEASE)
    assert result['status'] == 'activation_pending'
    assert result['decision'] == ('rollback' if rollback else 'commit')
    assert events == ['remote-engine']
    assert all('finalize' not in host.calls for host in hosts.values())
    # Reconstruct after a coordinator restart; JSON key sorting must not change order.
    hosts['remote-engine'].fail_operation = None
    result = UpdateTransaction(journal, hosts, activation_order=order).run('tx-1', RELEASE)
    assert result['status'] == ('rolled_back' if rollback else 'complete')
    assert events == ['remote-engine', 'remote-engine', 'backend', 'remote-worker']
    counts = [len(host.calls) for host in hosts.values()]
    with pytest.raises(ValueError, match='does not match'):
        UpdateTransaction(journal, hosts, activation_order=list(reversed(order))).run('tx-1', RELEASE)
    assert [len(host.calls) for host in hosts.values()] == counts


@pytest.mark.parametrize('order', [[], ['backend'] * 3, ['backend', 'remote-engine', 'unknown'], 'backend'])
def test_invalid_activation_inventory_rejected_before_journal(tmp_path, order):
    with pytest.raises(ValueError, match='Activation order'):
        UpdateTransaction(tmp_path / 'journal.json', inventory(tmp_path), activation_order=order)
    assert not (tmp_path / 'journal.json').exists()


def test_failure_after_restart_rolls_back_every_participant(tmp_path):
    hosts = inventory(tmp_path)
    hosts["remote-worker"].fail_operation = "verify"
    result = UpdateTransaction(tmp_path / "journal.json", hosts).run("tx-1", RELEASE)
    assert result["status"] == "rolled_back"
    assert all((host.root / "runtime").read_text() == "1.0.2" for host in hosts.values())


def test_lost_response_then_offline_host_keeps_recovery_pending(tmp_path):
    hosts = inventory(tmp_path)
    worker = hosts["remote-worker"]
    worker.crash_after_apply = True
    journal = tmp_path / "journal.json"
    with pytest.raises(KeyboardInterrupt):
        UpdateTransaction(journal, hosts).run("tx-1", RELEASE)
    assert json.loads(journal.read_text())["participants"]["remote-worker"]["pending"] == "apply"
    worker.offline = True
    result = UpdateTransaction(journal, hosts).run("tx-1", RELEASE)
    assert result["status"] == "recovery_pending"
    assert all("activate" not in host.calls for host in hosts.values())
    worker.offline = False
    result = UpdateTransaction(journal, hosts).run("tx-1", RELEASE)
    assert result["status"] == "rolled_back"
    assert all((host.root / "runtime").read_text() == "1.0.2" for host in hosts.values())


def test_same_version_different_artifact_cannot_reuse_transaction(tmp_path):
    hosts = inventory(tmp_path)
    coordinator = UpdateTransaction(tmp_path / "journal.json", hosts)
    coordinator.run("tx-1", RELEASE)
    with pytest.raises(ValueError, match="does not match"):
        coordinator.run("tx-1", {**RELEASE, "checksum_sha256": "b" * 64})


def test_failed_rollback_is_not_reported_complete(tmp_path):
    hosts = inventory(tmp_path)
    hosts["backend"].fail_operation = "rollback"
    hosts["remote-worker"].fail_operation = "verify"
    journal = tmp_path / "journal.json"
    assert UpdateTransaction(journal, hosts).run("tx-1", RELEASE)["status"] == "recovery_pending"
    hosts["backend"].fail_operation = None
    assert UpdateTransaction(journal, hosts).run("tx-1", RELEASE)["status"] == "rolled_back"


def test_snapshot_is_a_global_barrier_after_draining_writes(tmp_path):
    hosts = inventory(tmp_path)
    calls = []
    for name, host in hosts.items():
        execute = host.execute

        def record(operation, transaction, release, *, name=name, execute=execute):
            calls.append((name, operation))
            return execute(operation, transaction, release)

        host.execute = record
    result = UpdateTransaction(tmp_path / "journal.json", hosts).run("tx-1", RELEASE)
    assert result["status"] == "complete"
    phases = [operation for _, operation in calls]
    assert phases.count("snapshot") == len(hosts)
    assert max(i for i, op in enumerate(phases) if op == "quiesce") < phases.index("snapshot")
    assert max(i for i, op in enumerate(phases) if op == "snapshot") < phases.index("apply")


def test_activation_failure_never_restores_database_after_admitting_writes(tmp_path):
    hosts = inventory(tmp_path)
    hosts["remote-worker"].fail_operation = "activate"
    journal = tmp_path / "journal.json"
    result = UpdateTransaction(journal, hosts).run("tx-1", RELEASE)
    assert result["status"] == "activation_pending"
    assert result["decision"] == "commit"
    assert all("rollback" not in host.calls for host in hosts.values())
    # Requests may already have written new data on an activated participant.
    (hosts["backend"].root / "new-business-data").write_text("must survive retries")
    hosts["remote-worker"].fail_operation = None
    result = UpdateTransaction(journal, hosts).run("tx-1", RELEASE)
    assert result["status"] == "complete"
    assert all(host.calls.count("apply") == 1 for host in hosts.values())
    assert all("rollback" not in host.calls for host in hosts.values())
    assert (hosts["backend"].root / "new-business-data").read_text() == "must survive retries"


def test_lost_activation_response_resumes_commit_not_rollback(tmp_path):
    hosts = inventory(tmp_path)
    worker = hosts["remote-worker"]
    execute = worker.execute

    def interrupt(operation, transaction, release):
        result = execute(operation, transaction, release)
        if operation == "activate":
            raise KeyboardInterrupt("response lost after accepting new jobs")
        return result

    worker.execute = interrupt
    journal = tmp_path / "journal.json"
    with pytest.raises(KeyboardInterrupt):
        UpdateTransaction(journal, hosts).run("tx-1", RELEASE)
    assert json.loads(journal.read_text())["decision"] == "commit"
    worker.execute = execute
    assert UpdateTransaction(journal, hosts).run("tx-1", RELEASE)["status"] == "complete"
    assert all("rollback" not in host.calls for host in hosts.values())


def test_activation_retry_after_rollback_does_not_restore_snapshot_again(tmp_path):
    hosts = inventory(tmp_path)
    hosts["remote-worker"].fail_operation = "verify"
    hosts["backend"].fail_operation = "activate"
    journal = tmp_path / "journal.json"
    result = UpdateTransaction(journal, hosts).run("tx-1", RELEASE)
    assert result["status"] == "activation_pending"
    assert result["decision"] == "rollback"
    hosts["backend"].fail_operation = None
    assert UpdateTransaction(journal, hosts).run("tx-1", RELEASE)["status"] == "rolled_back"
    assert all(host.calls.count("rollback") == 1 for host in hosts.values())


def test_failed_snapshot_prevents_any_component_apply(tmp_path):
    hosts = inventory(tmp_path)
    hosts["remote-worker"].fail_operation = "snapshot"
    result = UpdateTransaction(tmp_path / "journal.json", hosts).run("tx-1", RELEASE)
    assert result["status"] == "rolled_back"
    assert all("apply" not in host.calls for host in hosts.values())


def test_pending_installation_cannot_start_a_different_transaction(tmp_path):
    hosts = inventory(tmp_path)
    hosts["remote-worker"].fail_operation = "activate"
    first = UpdateTransaction(tmp_path / "first.json", hosts)
    assert first.run("tx-1", RELEASE)["status"] == "activation_pending"
    before = {name: list(host.calls) for name, host in hosts.items()}
    second = UpdateTransaction(tmp_path / "second.json", hosts)
    with pytest.raises(TransactionFailure, match="needs recovery"):
        second.run("tx-2", RELEASE)
    assert all(host.calls == before[name] for name, host in hosts.items())
    hosts["remote-worker"].fail_operation = None
    assert first.run("tx-1", RELEASE)["status"] == "complete"
    assert second.run("tx-2", RELEASE)["status"] == "complete"


def test_concurrent_transactions_share_installation_lock(tmp_path):
    import fcntl

    hosts = inventory(tmp_path)
    with (tmp_path / ".installation-update.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        with pytest.raises(BlockingIOError):
            UpdateTransaction(tmp_path / "different.json", hosts).run("tx-2", RELEASE)
    assert all(not host.calls for host in hosts.values())


def test_failed_finalization_retries_without_reopening_or_reapplying(tmp_path):
    hosts = inventory(tmp_path)
    hosts["remote-worker"].fail_operation = "finalize"
    journal = tmp_path / "tx.json"
    assert UpdateTransaction(journal, hosts).run("tx-1", RELEASE)["status"] == "finalization_pending"
    hosts["remote-worker"].fail_operation = None
    assert UpdateTransaction(journal, hosts).run("tx-1", RELEASE)["status"] == "complete"
    for host in hosts.values():
        assert host.calls.count("apply") == host.calls.count("activate") == 1
        assert "rollback" not in host.calls
