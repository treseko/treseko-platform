import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { registerRunRoutes } from "./run-routes.ts";
import { UpdateAdmission, registerExternalAdmissionMiddleware, registerUpdateAdmissionRoute, releaseLeaseWhenResponseCompletes } from "./update-admission.ts";

function directory(): string {
  const value = fs.mkdtempSync(path.join(os.tmpdir(), "treseko-engine-admission-routes-"));
  fs.chmodSync(value, 0o700);
  return value;
}

function deps(admission: UpdateAdmission, runTask: (...args: any[]) => Promise<any>, active = new Set<string>()) {
  const protectedStoryEndpoint = () => true;
  const publicError = (_req: any, _status: number, message: string, errorCode: string) => ({
    error: { error_code: errorCode, message }, detail: message,
  });
  return {
    protectedStoryEndpoint,
    requestCorrelationId: () => "test-correlation",
    allowedEndpoint: () => true,
    allowedFallbacks: () => true,
    sendPublicError: (_req: any, res: any, status: number, message: string, code: string) => res.status(status).json(publicError(_req, status, message, code)),
    runTask,
    traceRequestId: () => "trace",
    traceEntry: () => undefined,
    traceBody: () => "[test]",
    publicError,
    sanitizeTraceValue: (value: unknown) => value,
    ENGINE_NAME: "test-engine",
    ENGINE_VERSION: "1.0.3",
    io: {},
    activeExecutionIds: active,
    updateAdmission: admission,
  };
}

function listen(app: express.Express): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const address = server.address() as import("node:net").AddressInfo;
      resolve({ server, port: address.port });
    });
  });
}

async function request(port: number, pathName: string, body: unknown, method = "POST", extraHeaders: Record<string, string> = {}) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const payload = JSON.stringify(body);
    const headers = method === "GET" ? extraHeaders : { "content-type": "application/json", "content-length": Buffer.byteLength(payload), ...extraHeaders };
    const req = http.request({ hostname: "127.0.0.1", port, path: pathName, method, headers }, (res) => {
      let raw = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { raw += chunk; });
      res.on("end", () => resolve({ status: res.statusCode || 0, body: raw ? JSON.parse(raw) : null }));
    });
    req.on("error", reject);
    req.end(method === "GET" ? undefined : payload);
  });
}

test("status is authenticated and exposes identity plus active lease state", async () => {
  const admission = new UpdateAdmission(directory());
  const app = express();
  registerUpdateAdmissionRoute(app, admission, (req, res) => {
    if (req.header("x-test-auth") !== "ok") {
      res.status(401).json({ error: "unauthorized" });
      return false;
    }
    return true;
  });
  const { server, port } = await listen(app);
  try {
    assert.equal((await request(port, "/internal/update/admission", {}, "GET")).status, 401);
    const release = admission.beginLease("external", "status-test");
    const result = await request(port, "/internal/update/admission", {}, "GET", { "x-test-auth": "ok" });
    assert.equal(result.status, 200, JSON.stringify(result));
    assert.equal(result.body.protocol, "treseko-engine-update-admission", JSON.stringify(result));
    assert.equal(result.body.protocol_version, 1, JSON.stringify(result));
    assert.equal(result.body.active_leases, 1, JSON.stringify(result));
    assert.equal(typeof result.body.process.identity, "string");
    release();
  } finally {
    server.close();
  }
});

test("async run-task lease survives response and pending terminal callback", async () => {
  const admission = new UpdateAdmission(directory());
  const app = express();
  app.use(express.json());
  let callbackStarted!: () => void;
  const callbackSeen = new Promise<void>((resolve) => { callbackStarted = resolve; });
  let callbackFinished!: () => void;
  const callbackDone = new Promise<void>((resolve) => { callbackFinished = resolve; });
  const callbackServer = http.createServer((req, res) => {
    callbackStarted();
    setTimeout(() => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ execution_id: "async-1", acknowledged: true, report_complete: true, terminal_delivery_id: "ai-terminal:async-1" }));
      callbackFinished();
    }, 100);
  });
  await new Promise<void>((resolve) => callbackServer.listen(0, "127.0.0.1", resolve));
  const callbackPort = (callbackServer.address() as import("node:net").AddressInfo).port;
  registerRunRoutes(app, deps(admission, async () => ({ status: "PASO", execution_id: "async-1" })));
  const { server, port } = await listen(app);
  try {
    const response = await request(port, "/run-task", { task: "test", testId: "async-1", callback_url: `http://127.0.0.1:${callbackPort}/callback` });
    assert.equal(response.status, 200);
    await callbackSeen;
    assert.equal(admission.status().active_by_kind["run-task"], 1);
    await callbackDone;
    for (let i = 0; i < 20 && admission.status().active_leases !== 0; i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(admission.status().active_leases, 0);
  } finally {
    server.close();
    callbackServer.close();
  }
});

test("sync run-task is leased without testId and releases after an error", async () => {
  const admission = new UpdateAdmission(directory());
  const app = express();
  app.use(express.json());
  let resolveTask!: () => void;
  const task = new Promise<void>((resolve) => { resolveTask = resolve; });
  registerRunRoutes(app, deps(admission, async () => { await task; throw new Error("fixture failure"); }));
  const { server, port } = await listen(app);
  try {
    const pending = request(port, "/run-task-sync", { task: "test" });
    for (let i = 0; i < 20 && admission.status().active_by_kind["run-task-sync"] !== 1; i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(admission.status().active_by_kind["run-task-sync"], 1);
    resolveTask();
    assert.equal((await pending).status, 500);
    assert.equal(admission.status().active_leases, 0);
  } finally {
    server.close();
  }
});

test("fence rejects a new run before the task starts", async () => {
  const admission = new UpdateAdmission(directory());
  admission.acquireFence("route-fence");
  let called = false;
  const app = express();
  app.use(express.json());
  registerRunRoutes(app, deps(admission, async () => { called = true; return {}; }));
  const { server, port } = await listen(app);
  try {
    const response = await request(port, "/run-task-sync", { task: "blocked" });
    assert.equal(response.status, 503);
    assert.equal(called, false);
  } finally {
    server.close();
  }
});

test("client disconnect does not release an external lease before work responds", async () => {
  const admission = new UpdateAdmission(directory());
  const app = express();
  app.get("/external", async (_req, res) => {
    const release = admission.beginLease("external", "disconnect-test");
    releaseLeaseWhenResponseCompletes(res, release);
    await new Promise((resolve) => setTimeout(resolve, 80));
    res.json({ done: true });
  });
  const { server, port } = await listen(app);
  try {
    const req = http.get({ hostname: "127.0.0.1", port, path: "/external" });
    req.on("error", () => undefined);
    for (let i = 0; i < 30 && admission.status().active_leases !== 1; i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(admission.status().active_leases, 1);
    req.destroy();
    await new Promise((resolve) => setTimeout(resolve, 15));
    assert.equal(admission.status().active_leases, 1);
    for (let i = 0; i < 30 && admission.status().active_leases !== 0; i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(admission.status().active_leases, 0);
  } finally {
    server.close();
  }
});

test("external route matching covers case and trailing slash, and fence blocks both", async () => {
  const admission = new UpdateAdmission(directory());
  const app = express();
  let calls = 0;
  registerExternalAdmissionMiddleware(app, admission, () => true);
  app.post("/generate-stories-sync", (_req, res) => {
    calls += 1;
    res.json({ ok: true });
  });
  const { server, port } = await listen(app);
  try {
    assert.equal((await request(port, "/GENERATE-STORIES-SYNC/", {})).status, 200);
    assert.equal((await request(port, "/generate-stories-sync", {})).status, 200);
    assert.equal(calls, 2);
    admission.acquireFence("route-match-fence");
    assert.equal((await request(port, "/GENERATE-STORIES-SYNC/", {})).status, 503);
    assert.equal((await request(port, "/generate-stories-sync", {})).status, 503);
    assert.equal(calls, 2);
  } finally {
    server.close();
  }
});
