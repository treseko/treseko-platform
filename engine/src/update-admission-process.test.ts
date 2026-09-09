import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn, type ChildProcess } from "node:child_process";

const engineDirectory = path.resolve(import.meta.dirname, "..");
const token = "process-test-token";

type JsonResponse = { status: number; body: any };

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve((server.address() as import("node:net").AddressInfo).port)));
}

function requestJson(port: number, pathname: string, body: unknown, method = "POST"): Promise<JsonResponse> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const request = http.request({
      hostname: "127.0.0.1",
      port,
      path: pathname,
      method,
      headers: method === "GET"
        ? { "x-engine-internal-token": token }
        : { "content-type": "application/json", "content-length": Buffer.byteLength(payload), "x-engine-internal-token": token },
    }, (response) => {
      let raw = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { raw += chunk; });
      response.on("end", () => resolve({ status: response.statusCode || 0, body: raw ? JSON.parse(raw) : null }));
    });
    request.on("error", reject);
    request.end(method === "GET" ? undefined : payload);
  });
}

function waitForExit(process: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (process.exitCode !== null) return resolve();
    process.once("exit", () => resolve());
  });
}

async function waitForHealth(port: number): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await requestJson(port, "/health", {}, "GET");
      if (response.status === 200) return;
    } catch {
      // The real server may still be loading its modules.
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Engine process did not become healthy");
}

function startEngine(port: number, control: string, spool: string, runtime: string, logs: string): ChildProcess {
  return spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
    cwd: engineDirectory,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      NODE_ENV: "production",
      APP_ENV: "production",
      ENGINE_PORT: String(port),
      AI_ENGINE_INTERNAL_TOKEN: token,
      TRESEKO_ENGINE_UPDATE_CONTROL_DIR: control,
      ENGINE_PENDING_DELIVERIES_DIR: spool,
      ENGINE_RUNTIME_DIR: runtime,
      ENGINE_LOG_DIR: logs,
      ENGINE_REPORTS_DIR: path.join(runtime, "reports"),
      AI_MAX_RETRIES: "1",
      AI_REQUEST_TIMEOUT_MS: "5000",
      ENGINE_CORS_ORIGIN: "",
    },
  });
}

function freePort(): Promise<number> {
  const server = http.createServer();
  return listen(server).then((port) => new Promise((resolve) => server.close(() => resolve(port))));
}

test("real server enforces Engine admission across provider work and restart", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "treseko-engine-process-admission-"));
  const control = path.join(root, "control");
  const spool = path.join(root, "spool");
  const runtime = path.join(root, "runtime");
  const logs = path.join(root, "logs");
  for (const directory of [control, spool, runtime, logs]) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    fs.chmodSync(directory, 0o700);
  }

  let providerRequests = 0;
  let providerRequestSeen!: () => void;
  const providerStarted = new Promise<void>((resolve) => { providerRequestSeen = resolve; });
  const provider = http.createServer((_request, response) => {
    providerRequests += 1;
    providerRequestSeen();
    setTimeout(() => {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ choices: [{ message: { content: "ok" } }], usage: {} }));
    }, 250);
  });
  const providerPort = await listen(provider);
  const enginePort = await freePort();
  const endpoint = `http://127.0.0.1:${providerPort}/v1`;
  let engine: ChildProcess | undefined;

  const marker = path.join(control, ".treseko-engine-update-fence");
  const writeFence = (transaction: string) => fs.writeFileSync(marker, JSON.stringify({ schema: 1, transaction }) + "\n", { mode: 0o600 });
  const removeFence = () => { if (fs.existsSync(marker)) fs.unlinkSync(marker); };
  const status = () => requestJson(enginePort, "/internal/update/admission", {}, "GET");

  try {
    engine = startEngine(enginePort, control, spool, runtime, logs);
    await waitForHealth(enginePort);

    const unauthorized = await new Promise<JsonResponse>((resolve, reject) => {
      const request = http.get({ hostname: "127.0.0.1", port: enginePort, path: "/internal/update/admission" }, (response) => {
        let raw = "";
        response.on("data", (chunk) => { raw += chunk; });
        response.on("end", () => resolve({ status: response.statusCode || 0, body: raw ? JSON.parse(raw) : null }));
      });
      request.on("error", reject);
    });
    assert.equal(unauthorized.status, 401);
    const initial = await status();
    assert.equal(initial.status, 200);
    assert.equal(initial.body.enabled, true);
    assert.equal(initial.body.marker_state, "absent");
    assert.equal(typeof initial.body.process.identity, "string");
    assert.equal(initial.body.process.pid, engine.pid);

    const client = http.request({
      hostname: "127.0.0.1",
      port: enginePort,
      path: "/provider-health",
      method: "POST",
      headers: { "content-type": "application/json", "x-engine-internal-token": token },
    });
    client.on("error", () => undefined);
    client.end(JSON.stringify({ provider: "openai-compatible", llm_endpoint: endpoint, model: "stub", probe_vision: false }));
    await providerStarted;
    let active = await status();
    assert.equal(active.body.active_by_kind.external, 1);
    assert.equal(active.body.drainable, false);
    client.destroy();
    await new Promise((resolve) => setTimeout(resolve, 40));
    active = await status();
    assert.equal(active.body.active_by_kind.external, 1);
    await new Promise((resolve) => setTimeout(resolve, 280));
    for (let attempt = 0; attempt < 20; attempt += 1) {
      active = await status();
      if (active.body.active_leases === 0) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(active.body.active_leases, 0);
    assert.equal(providerRequests, 1);

    writeFence("process-fence-1");
    let fenced = await status();
    assert.equal(fenced.body.owner_transaction, "process-fence-1");
    assert.equal(fenced.body.drainable, true);
    const blockedUpper = await requestJson(enginePort, "/PROVIDER-HEALTH/", { provider: "openai-compatible", llm_endpoint: endpoint, model: "stub", probe_vision: false });
    const blockedPlain = await requestJson(enginePort, "/provider-health", { provider: "openai-compatible", llm_endpoint: endpoint, model: "stub", probe_vision: false });
    assert.equal(blockedUpper.status, 503);
    assert.equal(blockedPlain.status, 503);
    assert.equal(providerRequests, 1);

    await new Promise<void>((resolve) => { engine?.once("exit", () => resolve()); engine?.kill("SIGTERM"); });
    engine = startEngine(enginePort, control, spool, runtime, logs);
    await waitForHealth(enginePort);
    fenced = await status();
    assert.equal(fenced.body.fenced, true);
    assert.equal(fenced.body.owner_transaction, "process-fence-1");

    fs.rmSync(spool, { recursive: true, force: true });
    fs.writeFileSync(spool, "not-a-directory", { mode: 0o600 });
    const invalidSpool = await status();
    assert.equal(invalidSpool.body.terminal_delivery.local_spool_state, "unavailable");
    assert.equal(invalidSpool.body.drainable, false);
  } finally {
    removeFence();
    if (engine && engine.exitCode === null) {
      engine.kill("SIGTERM");
      await Promise.race([waitForExit(engine), new Promise((resolve) => setTimeout(resolve, 1000))]);
      if (engine.exitCode === null) engine.kill("SIGKILL");
    }
    await new Promise<void>((resolve) => provider.close(() => resolve()));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
