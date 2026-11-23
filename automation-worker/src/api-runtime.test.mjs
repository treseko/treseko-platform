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

test("pairing without a solution id does not call the API or spam errors", async (t) => {
  const previousFetch = globalThis.fetch;
  const previousRegistrationToken = process.env.QA_REGISTRATION_TOKEN;
  delete process.env.QA_REGISTRATION_TOKEN;
  globalThis.fetch = async () => { throw new Error("The API must not be called"); };
  const previousConsoleError = console.error;
  const errors = [];
  console.error = (message) => errors.push(message);
  t.after(() => {
    globalThis.fetch = previousFetch;
    console.error = previousConsoleError;
    if (previousRegistrationToken === undefined) delete process.env.QA_REGISTRATION_TOKEN;
    else process.env.QA_REGISTRATION_TOKEN = previousRegistrationToken;
  });

  const runtime = createApiRuntime({
    API_BASE: "https://treseko.example.test/api", REQUEST_TIMEOUT_MS: 20,
    RUNNER_NAME: "Worker QA", ORGANIZACION_ID: "", state: { runnerToken: "", runnerId: "", activeCorrelationId: "" },
    capabilities: () => ({}), traceEntry() {}, traceRequestId: () => "request-id",
    errorFromResponse: () => new Error("Unexpected API request"), performance,
  });

  await runtime.registerIfNeeded();
  await runtime.registerIfNeeded();
  assert.equal(errors.length, 1);
  assert.match(errors[0], /QA_ORGANIZACION_ID/);
});

test("worker update download reads the authenticated package build id", async (t) => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    assert.equal(options.headers["X-Runner-Token"], "runner-token");
    return new Response(Buffer.from("worker-package"), {
      status: 200,
      headers: {
        "X-Worker-Update-Version": "1.0.8",
        "X-Worker-Update-SHA256": "a".repeat(64),
        "X-Worker-Update-Build-ID": "b".repeat(64),
      },
    });
  };
  t.after(() => { globalThis.fetch = previousFetch; });

  const runtime = createApiRuntime({
    API_BASE: "https://treseko.example.test/api", REQUEST_TIMEOUT_MS: 1000,
    state: { runnerToken: "runner-token", activeCorrelationId: "" },
    traceRequestId: () => "update-request",
    errorFromResponse: (_data, _text, status) => Object.assign(new Error("HTTP failure"), { status }),
  });
  const downloaded = await runtime.downloadWorkerUpdate();
  assert.equal(downloaded.version, "1.0.8");
  assert.equal(downloaded.checksum, "a".repeat(64));
  assert.equal(downloaded.buildId, "b".repeat(64));
  assert.equal(downloaded.bytes.toString(), "worker-package");
});

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

test("clears a revoked runner token so the next poll can pair again", async (t) => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ detail: "Runner token invalido" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
  t.after(() => { globalThis.fetch = previousFetch; });

  const state = { runnerToken: "revoked-token", runnerId: "old-runner", activeCorrelationId: "" };
  let credentialsCleared = 0;
  const runtime = createApiRuntime({
    API_BASE: "https://treseko.example.test/api", REQUEST_TIMEOUT_MS: 1000,
    RUNNER_NAME: "Worker QA", state, tokenPath: "controlled-token-path",
    capabilities: () => ({ frameworks: ["treseko-api"] }),
    traceEntry() {}, traceRequestId: () => "request-id",
    errorFromResponse: (data, _text, status) => Object.assign(new Error(data?.detail || "HTTP failure"), {
      error_code: status === 401 ? "HTTP_401" : `HTTP_${status}`,
    }),
    safeJsonParse: (value) => { try { return JSON.parse(value); } catch { return null; } },
    isInvalidRunnerTokenError: (error) => error.error_code === "HTTP_401",
    clearRunnerCredentials: () => {
      credentialsCleared += 1;
      state.runnerToken = "";
      state.runnerId = "";
    },
    saveTokenFile() {}, performance,
  });

  await assert.rejects(runtime.api("/automation-runners/me"), { error_code: "HTTP_401" });
  assert.equal(credentialsCleared, 1);
  assert.equal(state.runnerToken, "");
  assert.equal(state.runnerId, "");
});

test("a rejected runner token proceeds through pairing and saves the replacement", async (t) => {
  const previousFetch = globalThis.fetch;
  const previousRegistrationToken = process.env.QA_REGISTRATION_TOKEN;
  delete process.env.QA_REGISTRATION_TOKEN;
  let calls = 0;
  globalThis.fetch = async (url, options = {}) => {
    calls += 1;
    if (url.endsWith("/automation-runners/me")) {
      return Response.json({ detail: "Runner token invalido" }, { status: 401 });
    }
    if (url.endsWith("/automation-runners/pairing-requests")) {
      return Response.json({
        code: "WK-654321", pairing_token: "pairing-secret",
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      }, { status: 201 });
    }
    assert.match(url, /\/automation-runners\/pairing-requests\/WK-654321$/);
    assert.equal(options.headers["X-Pairing-Token"], "pairing-secret");
    return Response.json({
      estado: "APPROVED", runner_token: "replacement-token",
      runner: { id: "replacement-runner", nombre: "Worker QA" },
    });
  };
  t.after(() => {
    globalThis.fetch = previousFetch;
    if (previousRegistrationToken === undefined) delete process.env.QA_REGISTRATION_TOKEN;
    else process.env.QA_REGISTRATION_TOKEN = previousRegistrationToken;
  });

  const state = { runnerToken: "revoked-token", runnerId: "old-runner", activeCorrelationId: "" };
  let credentialsCleared = 0;
  const saved = [];
  const runtime = createApiRuntime({
    API_BASE: "https://treseko.example.test/api", REQUEST_TIMEOUT_MS: 1000,
    RUNNER_NAME: "Worker QA", ORGANIZACION_ID: "qa-solution-id", tokenPath: "controlled-token-path", state,
    capabilities: () => ({ frameworks: ["treseko-api"] }),
    traceEntry() {}, traceRequestId: () => "request-id",
    errorFromResponse: (data, _text, status) => Object.assign(new Error(data?.detail || "HTTP failure"), {
      error_code: status === 401 ? "HTTP_401" : `HTTP_${status}`,
    }),
    safeJsonParse: (value) => { try { return JSON.parse(value); } catch { return null; } },
    isInvalidRunnerTokenError: (error) => error.error_code === "HTTP_401",
    clearRunnerCredentials: () => {
      credentialsCleared += 1;
      state.runnerToken = "";
      state.runnerId = "";
    },
    saveTokenFile: (token) => saved.push(token),
    sleep: async () => {}, performance,
  });

  await runtime.registerIfNeeded();
  assert.equal(calls, 3);
  assert.equal(credentialsCleared, 1);
  assert.equal(state.runnerToken, "replacement-token");
  assert.equal(state.runnerId, "replacement-runner");
  assert.deepEqual(saved, ["replacement-token"]);
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
