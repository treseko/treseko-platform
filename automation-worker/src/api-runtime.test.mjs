import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { performance } from "node:perf_hooks";
import { createApiRuntime } from "./api-runtime.mjs";

function registrationRuntime(t, fetchImpl) {
  const previousFetch = globalThis.fetch;
  const previousToken = process.env.QA_REGISTRATION_TOKEN;
  globalThis.fetch = fetchImpl;
  process.env.QA_REGISTRATION_TOKEN = "controlled-registration-token";
  t.after(() => {
    globalThis.fetch = previousFetch;
    if (previousToken === undefined) delete process.env.QA_REGISTRATION_TOKEN;
    else process.env.QA_REGISTRATION_TOKEN = previousToken;
  });
  const state = { runnerToken: "", runnerId: "", activeCorrelationId: "registration-correlation" };
  const saved = [];
  const runtime = createApiRuntime({
    API_BASE: "https://treseko.example.test/api", REQUEST_TIMEOUT_MS: 20,
    RUNNER_NAME: "Worker QA", state, tokenPath: "controlled-token-path",
    capabilities: () => ({ frameworks: ["treseko-api"] }),
    traceEntry() {}, traceRequestId: () => "registration-request",
    performance, saveTokenFile: (value) => saved.push(value),
    safeJsonParse: (value) => { try { return JSON.parse(value); } catch { return null; } },
    errorFromResponse: (_data, _text, status) => Object.assign(new Error("HTTP failure"), { status }),
  });
  return { runtime, state, saved };
}

test("registration aborts a stalled server and can retry successfully", async (t) => {
  let calls = 0;
  const { runtime, state, saved } = registrationRuntime(t, async (_url, options) => {
    assert.equal(options.headers["X-Correlation-ID"], "registration-correlation");
    assert.ok(options.signal);
    if (++calls === 1) {
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      });
    }
    return Response.json({ id: "controlled-runner", runner_token: "controlled-runner-token", nombre: "Worker QA" }, { status: 201 });
  });
  await assert.rejects(runtime.registerIfNeeded(), { error_code: "UPSTREAM_TIMEOUT", retryable: true });
  assert.equal(state.runnerToken, "");
  assert.deepEqual(saved, []);
  await runtime.registerIfNeeded();
  assert.equal(state.runnerId, "controlled-runner");
  assert.deepEqual(saved, ["controlled-runner-token"]);
});

test("registration rejects malformed responses without saving credentials", async (t) => {
  const { runtime, state, saved } = registrationRuntime(t, async () => new Response("<html>Unavailable</html>", { status: 502 }));
  await assert.rejects(runtime.registerIfNeeded(), { error_code: "UPSTREAM_INVALID_RESPONSE", retryable: true });
  assert.equal(state.runnerToken, "");
  assert.deepEqual(saved, []);
});

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
