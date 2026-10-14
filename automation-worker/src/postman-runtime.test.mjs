import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import { runPostmanCollection } from "./postman-runtime.mjs";

function collectionFor(url, script) {
  const item = { name: "Smoke request", request: { method: "GET", url } };
  if (script) item.event = [{ listen: "test", script: { exec: [script] } }];
  return { info: { name: "Postman runtime smoke" }, item: [item] };
}

test("Postman runtime ejecuta una request permitida y conserva resultado", async () => {
  const server = http.createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ ok: true, path: request.url }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    const result = await runPostmanCollection({
      collection: collectionFor(`http://127.0.0.1:${port}/health`, "pm.test('ok', () => pm.response.to.have.status(200));"),
      allowedHosts: ["127.0.0.1"],
      timeoutMs: 5000,
    });
    assert.equal(result.status, "PASSED");
    assert.equal(result.requests[0].status, 200);
    assert.deepEqual(result.assertions, [{ name: "ok", status: "PASSED", error: null }]);
    assert.equal(result.runtime, "postman-runtime");
  } finally {
    server.close();
  }
});

test("Postman runtime rechaza destinos fuera de la allowlist antes de enviar", async () => {
  await assert.rejects(
    Promise.resolve().then(() => runPostmanCollection({
      collection: collectionFor("https://not-allowed.example.test/health"),
      allowedHosts: ["127.0.0.1"],
      timeoutMs: 5000,
    })),
    /allowlist del ambiente/,
  );
});

test('Postman preserves complete request headers and large response bytes', async t => {
  const body=Buffer.alloc(3*1024*1024,120);
  const server=http.createServer((req,res)=>res.end(body));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>{server.closeAllConnections();server.close();});
  const collection=collectionFor(`http://127.0.0.1:${server.address().port}/`);
  collection.item[0].request.header=[{key:'Authorization',value:'Bearer original-business-token'}];
  const result=await runPostmanCollection({collection,allowedHosts:['127.0.0.1'],timeoutMs:5000});
  assert.equal(result.requests[0].request.header[0].value,'Bearer original-business-token');
  assert.equal(Buffer.from(result.requests[0].response.body_base64,'base64').compare(body),0);
});
