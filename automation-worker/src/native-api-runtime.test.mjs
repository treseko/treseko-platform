import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import test from "node:test";

import { runApiWorkerSuite } from "./native-api-runtime.mjs";
import { buildBody } from "./api-native-http.mjs";
import { MAX_TOTAL_EVIDENCE_BYTES, validateDestination } from "./api-native-utils.mjs";

function startServer() {
  const seen = [];
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on("data", chunk => chunks.push(chunk));
    request.on("end", () => {
      const body = Buffer.concat(chunks).toString(); seen.push({ path: request.url, method: request.method, body, headers: request.headers });
      if (request.url === "/large") { const value = Buffer.alloc(2 * 1024 * 1024 + 1, "x"); response.setHeader("content-length", value.length); response.end(value); return; }
      if (request.url === "/payload") { const value = JSON.stringify({ payload: "x".repeat(1900 * 1024) }); response.setHeader("content-type", "application/json"); response.end(value); return; }
      if (request.url === "/near-limit") { const value = JSON.stringify({ payload: "x".repeat(2 * 1024 * 1024 - 100) }); response.setHeader("content-type", "application/json"); response.end(value); return; }
      if (request.url === "/state") { const value = JSON.stringify({ payload: "x".repeat(600 * 1024) }); response.setHeader("content-type", "application/json"); response.end(value); return; }
      if (request.url === "/slow") { setTimeout(() => response.end("slow"), 150); return; }
      if (request.url?.startsWith("/redirect/")) { response.statusCode = Number(request.url.split("/").at(-1)); response.setHeader("location", "/final"); response.end(); return; }
      if (request.url === "/final") { response.setHeader("content-type", "application/json"); response.end(JSON.stringify({ ok: true, method: request.method, body })); return; }
      if (request.url === "/login") { response.setHeader("content-type", "application/json"); response.end(JSON.stringify({ id: "flow-42", token: "secret-token-42", ok: true })); return; }
      if (request.url?.startsWith("/flow/")) { response.setHeader("content-type", "application/json"); response.end(JSON.stringify({ ok: request.headers.authorization === "Bearer secret-token-42", case: request.headers["x-case"] })); return; }
      if (request.url === "/schema") { response.setHeader("content-type", "application/json"); response.end(JSON.stringify({ data: { id: 2, name: "ok" } })); return; }
      response.setHeader("content-type", "application/json"); response.end(JSON.stringify({ ok: true, request_id: request.headers["x-request-id"] }));
    });
  });
  return new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve({ server, seen, url: `http://127.0.0.1:${server.address().port}` })));
}

function job(url, cases, extra = {}) { return { schema_version: "treseko.api-worker-job/v1", job_type: "API_EXECUTION", environment: { url, variables: {}, configuracion_api: {} }, cases, ...extra }; }

test("ejecuta casos en orden, acepta dataset aliases y separa estado compartido de persistencia", async t => {
  const fixture = await startServer(); t.after(() => fixture.server.close());
  const result = await runApiWorkerSuite(job(fixture.url, [
    { case_id: "case-1", execution_id: "execution-1", dataset: { case_value: "row-1" }, dynamic_values: { "$randomUUID": "uuid-precalculado" }, dynamic_seed: "same-seed", configuracion_api: { request: { method: "POST", url: "{{base_url}}/login", headers: [{ key: "X-Request-Id", value: "{{request_id}}" }, { key: "X-Case", value: "{{case_value}}" }], body: { mode: "json", content: '{"dynamic":"{{$randomUUID}}"}' } }, post_response_script: "pm.variables.set('api.flow_id', pm.response.json().id); pm.variables.persist('api.token', pm.response.json().token)" } },
    { case_id: "case-2", execution_id: "execution-2", configuracion_api: { request: { method: "GET", url: "{{base_url}}/flow/{{api.flow_id}}", auth: { type: "bearer", variable: "api.token" } }, assertions: [{ source: "response.body", selector: "$.ok", operator: "equals", expected: true }] } },
  ], { dataset: { variables: { request_id: "dataset-request-1" } } }), { allowLoopbackForTests: true });
  assert.equal(result.status, "PASSED"); assert.equal(result.api_results.length, 2); assert.equal(result.api_results[0].result.dynamic_variables.values.$randomUUID, "uuid-precalculado");
  assert.equal(result.api_results[0].state_updates.shared_variables["api.flow_id"], "flow-42"); assert.equal(result.api_results[0].state_updates.persistent_variables["api.token"], "secret-token-42");
  assert.equal(result.api_results[0].result.persistent_variables["api.token"], "[REDACTED]"); assert.equal(result.api_results[1].result.status, "PASSED");
  assert.equal(fixture.seen[0].headers["x-request-id"], "dataset-request-1"); assert.equal(fixture.seen[0].headers["x-case"], "row-1");
});

test("public_test_data solo cambia evidencia, no las reglas de transporte", async t => {
  const fixture = await startServer(); t.after(() => fixture.server.close());
  const payload = job(fixture.url, [{ case_id: "public", execution_id: "public-execution", configuracion_api: { evidence_policy: { public_test_data: true }, request: { method: "GET", url: "{{base_url}}/flow/public", auth: { type: "bearer", token: "secret-token-42" } } } }]);
  const publicResult = await runApiWorkerSuite(payload, { allowLoopbackForTests: true });
  assert.equal(publicResult.api_results[0].result.steps[0].request.headers.Authorization, "Bearer secret-token-42");
  const blocked = await runApiWorkerSuite(job("http://127.0.0.1:1", [{ case_id: "ssrf", execution_id: "ssrf-execution", configuracion_api: { request: { method: "GET", url: "{{base_url}}" } } }]), { allowLoopbackForTests: false });
  assert.equal(blocked.api_results[0].result.status, "BLOCKED"); assert.match(blocked.api_results[0].result.steps[0].errors[0].error, /SSRF|Destino/);
});

test("bloquea IPv4 mapeada en IPv6 y respeta el timeout total del job", async t => {
  await assert.rejects(
    validateDestination("http://[::ffff:127.0.0.1]/health", { url: "https://api.example.test", allowed_hosts: ["::ffff:7f00:1"] }, {}),
    error => error?.code === "SSRF_BLOCKED",
  );
  const fixture = await startServer(); t.after(() => fixture.server.close());
  const result = await runApiWorkerSuite(job(fixture.url, [{ case_id: "total-timeout", execution_id: "total-timeout-e", configuracion_api: { request: { method: "GET", url: `${fixture.url}/slow`, timeout: { total_ms: 1000 } } } }]), { allowLoopbackForTests: true, timeoutSeconds: 0.05 });
  assert.equal(result.api_results[0].result.status, "TIMEOUT");
});

for (const redirectStatus of [301, 302, 303]) test(`aplica semántica POST a GET en redirección ${redirectStatus}`, async t => {
  const fixture = await startServer(); t.after(() => fixture.server.close());
  const result = await runApiWorkerSuite(job(fixture.url, [{ case_id: `r-${redirectStatus}`, execution_id: `e-${redirectStatus}`, configuracion_api: { request: { method: "POST", url: `${fixture.url}/redirect/${redirectStatus}`, body: { mode: "raw", content: "payload", media_type: "text/plain" }, redirects: { follow: true } } } }]), { allowLoopbackForTests: true });
  assert.equal(result.status, "PASSED"); assert.equal(fixture.seen.at(-1).method, "GET"); assert.equal(fixture.seen.at(-1).body, "");
});

test("conserva 307, content-type JSON, timeout y límite de respuesta", async t => {
  const fixture = await startServer(); t.after(() => fixture.server.close());
  const built = buildBody({ mode: "json", content: '{"ok":true}' }); assert.equal(built.headers["Content-Type"], "application/json");
  const timeout = await runApiWorkerSuite(job(fixture.url, [{ case_id: "timeout", execution_id: "timeout-e", configuracion_api: { request: { method: "GET", url: `${fixture.url}/slow`, timeout: { total_ms: 100 } } } }]), { allowLoopbackForTests: true });
  assert.equal(timeout.api_results[0].result.status, "TIMEOUT");
  const large = await runApiWorkerSuite(job(fixture.url, [{ case_id: "large", execution_id: "large-e", configuracion_api: { request: { method: "GET", url: `${fixture.url}/large` } } }]), { allowLoopbackForTests: true });
  assert.equal(large.api_results[0].result.status, "BLOCKED"); assert.equal(large.api_results[0].result.steps[0].errors[0].code, "RESPONSE_TOO_LARGE");
  const many = await runApiWorkerSuite(job(fixture.url, Array.from({ length: 5 }, (_, index) => ({ case_id: `big-${index}`, execution_id: `big-e-${index}`, configuracion_api: { request: { method: "GET", url: `${fixture.url}/payload` } } }))), { allowLoopbackForTests: true });
  assert.ok(Buffer.byteLength(JSON.stringify(many), "utf8") <= MAX_TOTAL_EVIDENCE_BYTES);
  const nearLimit = await runApiWorkerSuite(job(fixture.url, [{ case_id: "near", execution_id: "near-e", configuracion_api: { request: { method: "GET", url: `${fixture.url}/near-limit` } } }]), { allowLoopbackForTests: true });
  assert.ok(Buffer.byteLength(JSON.stringify(nearLimit.api_results[0]), "utf8") <= 4 * 1024 * 1024);
});

test("bloquea estado API extraído que excede el contrato del backend", async t => {
  const fixture = await startServer(); t.after(() => fixture.server.close());
  const result = await runApiWorkerSuite(job(fixture.url, [{ case_id: "state", execution_id: "state-e", configuracion_api: { request: { method: "GET", url: `${fixture.url}/state` }, extractors: [{ name: "api.large", source: "response.body", selector: "$.payload" }] } }]), { allowLoopbackForTests: true });
  assert.equal(result.status, "BLOCKED"); assert.match(result.api_results[0].result.errors[0].error, /variables API extraídas/); assert.deepEqual(result.api_results[0].state_updates, { shared_variables: {}, persistent_variables: {} });
});

test("json_schema y scripts seguros tienen resultado determinista", async t => {
  const fixture = await startServer(); t.after(() => fixture.server.close());
  const result = await runApiWorkerSuite(job(fixture.url, [{ case_id: "schema", execution_id: "schema-e", configuracion_api: { request: { method: "GET", url: `${fixture.url}/schema` }, assertions: [{ source: "response.body", operator: "json_schema", expected: { type: "object", required: ["data"], properties: { data: { type: "object", required: ["id", "name"] } } } }], post_response_script: "pm.test('schema ok', () => pm.expect(pm.response.json().data.id).to.eql(2));" } }]), { allowLoopbackForTests: true });
  assert.equal(result.status, "PASSED");
  const blocked = await runApiWorkerSuite(job(fixture.url, [{ case_id: "script", execution_id: "script-e", configuracion_api: { request: { method: "GET", url: `${fixture.url}/schema` }, pre_request_script: "fetch('https://evil.example.test')" } }]), { allowLoopbackForTests: true });
  assert.equal(blocked.status, "BLOCKED");
  const source = fs.readFileSync(new URL("./native-api-runtime.mjs", import.meta.url), "utf8"); assert.doesNotMatch(source, /Math\.random\s*\(/);
});
