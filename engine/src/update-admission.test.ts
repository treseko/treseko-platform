import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { UpdateAdmission, UpdateAdmissionError } from "./update-admission.ts";

function controlDir(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "treseko-engine-admission-"));
  fs.chmodSync(directory, 0o700);
  return directory;
}

test("legacy mode is open but never reports a false drainable status", () => {
  const admission = new UpdateAdmission();
  const status = admission.status();
  assert.equal(status.enabled, false);
  assert.equal(status.protocol_version, 1);
  assert.equal(status.marker_state, "disabled");
  assert.equal(status.owner_transaction, null);
  assert.equal(status.admission_open, true);
  assert.equal(status.drainable, false);
});

test("durable fence blocks new leases while an existing lease drains", () => {
  const directory = controlDir();
  const pending = fs.mkdtempSync(path.join(os.tmpdir(), "treseko-engine-empty-spool-"));
  const admission = new UpdateAdmission(directory, pending);
  const release = admission.beginLease("run-task", "execution-1");
  assert.equal(admission.status().active_by_kind["run-task"], 1);
  assert.equal(admission.status().drainable, false);

  admission.acquireFence("update-1");
  assert.equal(admission.status().fenced, true);
  assert.throws(() => admission.beginLease("run-task-sync"), UpdateAdmissionError);
  release();
  assert.equal(admission.status().active_leases, 0);
  assert.equal(admission.status().drainable, true);

  admission.releaseFence("update-1");
  assert.equal(admission.status().marker_state, "absent");
  assert.equal(admission.status().admission_open, true);
  assert.equal(admission.status().owner_transaction, null);
  assert.equal(admission.status().drainable, false);
  fs.rmSync(directory, { recursive: true, force: true });
  fs.rmSync(pending, { recursive: true, force: true });
});

test("a restarted admission object observes and can release the durable fence", () => {
  const directory = controlDir();
  const first = new UpdateAdmission(directory);
  first.acquireFence("restart-1");

  const restarted = new UpdateAdmission(directory);
  const status = restarted.status();
  assert.equal(status.marker_state, "present");
  assert.equal(status.fenced, true);
  assert.equal(status.owner_transaction, "restart-1");
  assert.equal(status.admission_open, false);
  assert.throws(() => restarted.beginLease("external"), UpdateAdmissionError);
  restarted.releaseFence("restart-1");
  assert.equal(restarted.status().marker_state, "absent");
  fs.rmSync(directory, { recursive: true, force: true });
});

test("configured corrupt control state fails closed", () => {
  const directory = controlDir();
  fs.writeFileSync(path.join(directory, ".treseko-engine-update-fence"), "not-json\n", { mode: 0o600 });
  const admission = new UpdateAdmission(directory);
  const status = admission.status();
  assert.equal(status.enabled, true);
  assert.equal(status.marker_state, "invalid");
  assert.equal(status.owner_transaction, null);
  assert.equal(status.admission_open, false);
  assert.equal(status.drainable, false);
  assert.throws(() => admission.beginLease("run-task"), UpdateAdmissionError);
  fs.rmSync(directory, { recursive: true, force: true });
});

test("configured path rejects relative and parent traversal", () => {
  assert.throws(() => new UpdateAdmission("relative/control"), TypeError);
  assert.throws(() => new UpdateAdmission("/tmp/../control"), TypeError);
});

test("a pending local terminal spool is visible and not drainable", () => {
  const directory = controlDir();
  const spool = fs.mkdtempSync(path.join(os.tmpdir(), "treseko-engine-spool-"));
  try {
    fs.writeFileSync(path.join(spool, "execution.json"), "{}", { mode: 0o600 });
    const admission = new UpdateAdmission(directory, spool);
    admission.acquireFence("spool-1");
    const status = admission.status();
    assert.equal(status.terminal_delivery.scope, "engine_process_and_local_spool");
    assert.equal(status.terminal_delivery.pending_local_deliveries, 1);
    assert.equal(status.terminal_delivery.needs_backend_confirmation, true);
    assert.equal(status.drainable, false);
  } finally {
    fs.rmSync(spool, { recursive: true, force: true });
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("spool EACCES and ENOTDIR are unavailable, never empty", () => {
  const control = controlDir();
  const spool = fs.mkdtempSync(path.join(os.tmpdir(), "treseko-engine-spool-errors-"));
  const nonDirectory = path.join(spool, "not-a-directory");
  fs.writeFileSync(nonDirectory, "fixture", { mode: 0o600 });
  try {
    const denied = new UpdateAdmission(control, spool);
    denied.acquireFence("eacces-1");
    const originalReadDir: any = fs.readdirSync;
    mock.method(fs, "readdirSync", function (target: any, ...args: any[]) {
      if (String(target) === spool) {
        const error = new Error("fixture permission denied") as NodeJS.ErrnoException;
        error.code = "EACCES";
        throw error;
      }
      return originalReadDir.call(fs, target, ...args);
    } as any);
    assert.equal(denied.status().terminal_delivery.local_spool_state, "unavailable");
    assert.equal(denied.status().drainable, false);
    mock.restoreAll();

    const notDirectory = new UpdateAdmission(control, nonDirectory);
    assert.equal(notDirectory.status().terminal_delivery.local_spool_state, "unavailable");
    assert.equal(notDirectory.status().drainable, false);
  } finally {
    mock.restoreAll();
    fs.rmSync(spool, { recursive: true, force: true });
    fs.rmSync(control, { recursive: true, force: true });
  }
});

test("configured spool symlink is rejected and FIFO marker is nonblocking", () => {
  const control = controlDir();
  const realSpool = fs.mkdtempSync(path.join(os.tmpdir(), "treseko-engine-real-spool-"));
  const symlink = path.join(realSpool, "link");
  fs.symlinkSync(realSpool, symlink, "dir");
  assert.throws(() => new UpdateAdmission(control, symlink), TypeError);

  const marker = path.join(control, ".treseko-engine-update-fence");
  execFileSync("mkfifo", [marker]);
  fs.chmodSync(marker, 0o600);
  const admission = new UpdateAdmission(control, realSpool);
  const status = admission.status();
  assert.equal(status.marker_state, "invalid");
  assert.equal(status.drainable, false);

  fs.rmSync(realSpool, { recursive: true, force: true });
  fs.rmSync(control, { recursive: true, force: true });
});
