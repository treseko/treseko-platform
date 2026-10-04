import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { performance } from "node:perf_hooks";
import { createApiRuntime } from "./api-runtime.mjs";

test("persiste el pairing pendiente antes de esperar la aprobacion", async (t) => {
  const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "treseko-worker-pairing-"));
  const pairingStatePath = path.join(stateDirectory, "pairing-state.json");
  t.after(() => fs.rmSync(stateDirectory, { recursive: true, force: true }));

  const previousFetch = globalThis.fetch;
  const pairingRequest = {
    code: "WK-123456",
    pairing_token: "qa-pairing-token",
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    nombre: "Worker QA",
    tipo: "LOCAL",
    estado: "PENDING",
  };
  let fetchCalls = 0;
  globalThis.fetch = async (url, options) => {
    fetchCalls += 1;
    assert.equal(url, "https://treseko.example.test/api/automation-runners/pairing-requests");
    assert.equal(options.method, "POST");
    return new Response(JSON.stringify(pairingRequest), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  };

  const stopAfterPersistence = new Error("stop after pairing persistence");
  const runtime = createApiRuntime({
    API_BASE: "https://treseko.example.test/api",
    REQUEST_TIMEOUT_MS: 1000,
    RUNNER_NAME: "Worker QA",
    ORGANIZACION_ID: "qa-solution-id",
    tokenPath: path.join(stateDirectory, ".runner-token"),
    pairingStatePath,
    workerInstanceId: "qa-worker-instance",
    state: { runnerToken: "", runnerId: "", activeCorrelationId: "" },
    capabilities: () => ({ frameworks: ["treseko-api"] }),
    isInvalidRunnerTokenError: () => false,
    clearRunnerCredentials() {},
    saveTokenFile() {},
    traceEntry() {},
    traceRequestId: () => "qa-request-id",
    errorFromResponse: () => new Error("unexpected HTTP error"),
    safeJsonParse: (value) => {
      try { return JSON.parse(value); } catch { return null; }
    },
    sleep: async () => { throw stopAfterPersistence; },
    performance,
  });

  try {
    await assert.rejects(runtime.pairWithPlatform(), (error) => error === stopAfterPersistence);
    assert.equal(fetchCalls, 1);
    assert.deepEqual(JSON.parse(fs.readFileSync(pairingStatePath, "utf8")), pairingRequest);
    assert.equal(fs.statSync(pairingStatePath).mode & 0o777, 0o600);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
