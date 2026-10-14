import assert from "node:assert/strict";
import http from "node:http";
import { runPostmanCollection } from "../../src/postman-runtime.mjs";

let requestBody = "";
const server = http.createServer((request, response) => {
  requestBody = "";
  request.setEncoding("utf8");
  request.on("data", chunk => { requestBody += chunk; });
  request.on("end", () => response.end("ok"));
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}/dynamic-variable`;

function makeCollection(index, token) {
  return {
    info: { name: "Treseko Postman collection dynamic variable matrix" },
    item: [{
      name: `dynamic-${index}`,
      request: {
        method: "POST",
        url,
        header: [{ key: "Content-Type", value: "application/json" }],
        body: { mode: "raw", raw: JSON.stringify({ generated: token }) },
      },
    }],
  };
}

export async function validFakerDynamicVariable(index) {
  const result = await runPostmanCollection({
    collection: makeCollection(index, "{{$randomCity}}"),
    allowedHosts: ["127.0.0.1"], timeoutMs: 5000,
  });
  assert.equal(result.status, "PASSED");
  assert.equal(result.requests[0]?.status, 200);
  const body = JSON.parse(requestBody);
  assert.equal(typeof body.generated, "string");
  assert.ok(body.generated.length > 0);
  assert.doesNotMatch(body.generated, /\{\{|\}\}/);
  return true;
}

export async function unknownDynamicVariableRemainsLiteral(index) {
  const token = `{{$tresekoUnknown${index}}}`;
  const result = await runPostmanCollection({
    collection: makeCollection(index, token),
    allowedHosts: ["127.0.0.1"], timeoutMs: 5000,
  });
  assert.equal(result.status, "PASSED");
  assert.equal(result.requests[0]?.status, 200);
  assert.deepEqual(JSON.parse(requestBody), { generated: token });
  return true;
}

export function closeCollectionUsageProbe() {
  return new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
