import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createResultDelivery } from "./result-delivery.mjs";
import { createLeaseHeartbeat } from "./lease-manager.mjs";
import { buildHeartbeatPayload } from "./heartbeat-payload.mjs";
import { claimConflictMessage, isClaimConflict } from "./queue-messages.mjs";

function tempSpool() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "treseko-worker-spool-"));
}

function error(status, message = "fallo de red") {
  const value = new Error(message);
  if (status) value.http_status = status;
  if (!status) value.error_code = "UPSTREAM_UNAVAILABLE";
  return value;
}

test("guarda el resultado antes del POST y reintenta errores de red", async () => {
  const spoolDir = tempSpool();
  let attempts = 0;
  let spoolExistedBeforePost = false;
  const delivery = createResultDelivery({
    spoolDir,
    retryBaseMs: 1,
    sleep: async () => {},
    postResult: async (_jobId, payload) => {
      spoolExistedBeforePost = fs.readdirSync(spoolDir).some(name => name.endsWith(".json"));
      assert.equal(payload.result_event_id, "event-red-1");
      attempts += 1;
      if (attempts === 1) throw error();
      if (attempts === 2) throw error(503, "backend temporalmente no disponible");
    },
  });
  const outcome = await delivery.deliver({
    jobId: "job-red-1",
    leaseToken: "lease-red-1",
    resultEventId: "event-red-1",
    result: { status: "PASSED" },
    runOnce: true,
  });
  assert.equal(outcome.status, "CONFIRMED");
  assert.equal(attempts, 3);
  assert.equal(spoolExistedBeforePost, true);
  assert.deepEqual(delivery.pendingFiles(), []);
  fs.rmSync(spoolDir, { recursive: true, force: true });
});

test("RUN_ONCE conserva el spool y un proceso reiniciado reutiliza el mismo event id", async () => {
  const spoolDir = tempSpool();
  const first = createResultDelivery({
    spoolDir,
    maxAttempts: 1,
    postResult: async () => { throw error(); },
  });
  await assert.rejects(
    first.deliver({ jobId: "job-restart", leaseToken: "lease-1", resultEventId: "event-stable", result: { status: "FAILED" }, runOnce: true }),
    /No se confirmó/,
  );
  const filesAfterCrash = first.pendingFiles();
  assert.equal(filesAfterCrash.length, 1);
  const sent = [];
  const restarted = createResultDelivery({
    spoolDir,
    postResult: async (_jobId, payload) => { sent.push(payload); },
  });
  const leasesReactivated = [];
  assert.equal((await restarted.flushPending({
    runOnce: true,
    beforeEach: async envelope => leasesReactivated.push([envelope.job_id, envelope.lease_token]),
  })), true);
  assert.deepEqual(leasesReactivated, [["job-restart", "lease-1"]]);
  assert.equal(sent[0].result_event_id, "event-stable");
  assert.equal(sent[0].lease_token, "lease-1");
  assert.deepEqual(restarted.pendingFiles(), []);
  fs.rmSync(spoolDir, { recursive: true, force: true });
});

test("un spool pendiente mantiene un único lease activo hasta recibir ACK", async () => {
  const spoolDir = tempSpool();
  const delivery = createResultDelivery({
    spoolDir,
    maxAttempts: 1,
    postResult: async () => { throw error(503, "backend temporalmente no disponible"); },
  });
  for (const suffix of ["a", "b"]) {
    delivery.persist({
      version: 1,
      job_id: `job-${suffix}`,
      result_event_id: `event-${suffix}`,
      lease_token: `lease-${suffix}`,
      payload: { status: "PASSED", lease_token: `lease-${suffix}`, result_event_id: `event-${suffix}` },
    });
  }
  const activated = [];
  const confirmed = await delivery.flushPending({
    beforeEach: async envelope => activated.push(envelope.job_id),
  });

  assert.equal(confirmed, false);
  assert.deepEqual(activated, ["job-a"]);
  assert.equal(delivery.pendingFiles().length, 2);
  fs.rmSync(spoolDir, { recursive: true, force: true });
});

test("ACK 2xx elimina exclusivamente el spool después de confirmar", async () => {
  const spoolDir = tempSpool();
  let called = 0;
  const delivery = createResultDelivery({
    spoolDir,
    postResult: async () => { called += 1; return { estado: "PASSED" }; },
  });
  const outcome = await delivery.deliver({ jobId: "job-ack", leaseToken: "lease-ack", result: { status: "PASSED" }, runOnce: true });
  assert.equal(outcome.status, "CONFIRMED");
  assert.equal(called, 1);
  assert.equal(fs.readdirSync(spoolDir).filter(name => name.endsWith(".json")).length, 0);
  fs.rmSync(spoolDir, { recursive: true, force: true });
});

test("4xx no reintentable va a cuarentena con diagnóstico sin lease ni payload", async () => {
  const spoolDir = tempSpool();
  const messages = [];
  const delivery = createResultDelivery({
    spoolDir,
    postResult: async () => { throw error(409, "El lease vencido fue reemplazado por otro runner"); },
    log: (_kind, message) => messages.push(message),
  });
  const outcome = await delivery.deliver({
    jobId: "job-quarantine",
    leaseToken: "lease-secret-no-log",
    resultEventId: "event-quarantine",
    result: { status: "FAILED", observations: "payload sensible no debe ir al diagnóstico" },
  });
  assert.equal(outcome.status, "QUARANTINED");
  const quarantineDir = path.join(spoolDir, "quarantine");
  const diagnostic = fs.readFileSync(path.join(quarantineDir, "job-quarantine-event-quarantine.diagnostic.json"), "utf8");
  assert.doesNotMatch(diagnostic, /lease-secret-no-log|payload sensible/);
  assert.match(messages.join("\n"), /lease.*venció|reemplazado/i);
  fs.rmSync(spoolDir, { recursive: true, force: true });
});

test("RUN_ONCE termina con error cuando el backend rechaza y cuarentena conserva la evidencia", async () => {
  const spoolDir = tempSpool();
  const delivery = createResultDelivery({
    spoolDir,
    postResult: async () => { throw error(409, "lease vencido y reemplazado"); },
  });
  await assert.rejects(
    delivery.deliver({ jobId: "job-once-quarantine", leaseToken: "lease-1", resultEventId: "event-1", result: { status: "FAILED" }, runOnce: true }),
    errorValue => errorValue?.error_code === "RESULT_DELIVERY_QUARANTINED",
  );
  assert.deepEqual(delivery.pendingFiles(), []);
  assert.equal(fs.readdirSync(path.join(spoolDir, "quarantine")).filter(name => name.endsWith(".quarantine.json")).length, 1);
  fs.rmSync(spoolDir, { recursive: true, force: true });
});

test("heartbeat renueva el lease con current_job_id y lease_token durante el trabajo", async () => {
  let timerCallback;
  const heartbeats = [];
  const manager = createLeaseHeartbeat({
    intervalMs: 100,
    setIntervalFn: callback => { timerCallback = callback; return { unref() {} }; },
    clearIntervalFn: () => {},
    heartbeat: async () => heartbeats.push(buildHeartbeatPayload({ status: "BUSY", currentJobId: "job-long", leaseToken: "lease-long", activeJobs: 1 })),
  });
  manager.start();
  await manager.tick();
  await timerCallback();
  assert.equal(heartbeats.length, 2);
  assert.equal(heartbeats[0].current_job_id, "job-long");
  assert.equal(heartbeats[0].lease_token, "lease-long");
  manager.stop();
});

test("conflicto 409 de claim se clasifica como carrera normal y tiene mensaje accionable", () => {
  assert.equal(isClaimConflict({ error_code: "HTTP_409" }), true);
  assert.equal(isClaimConflict({ http_status: 500 }), false);
  assert.match(claimConflictMessage("job-race"), /tomado por otro worker.*consultar la cola/i);
});

test("lease rechazado detiene futuros heartbeats sin hacer loop infinito", async () => {
  let ticks = 0;
  const logs = [];
  const manager = createLeaseHeartbeat({
    heartbeat: async () => { ticks += 1; const failure = error(403, "lease vencido"); throw failure; },
    log: (_kind, message) => logs.push(message),
  });
  await manager.tick();
  await manager.tick();
  assert.equal(ticks, 1);
  assert.equal(manager.isStopped(), true);
  assert.match(logs[0], /lease.*rechazado/i);
});

test("rate limit temporal no se confunde con pérdida definitiva del lease", async () => {
  let ticks = 0;
  const manager = createLeaseHeartbeat({
    heartbeat: async () => {
      ticks += 1;
      throw error(429, "Demasiadas solicitudes");
    },
  });

  await manager.tick();
  await manager.tick();

  assert.equal(ticks, 2);
  assert.equal(manager.isStopped(), false);
});
