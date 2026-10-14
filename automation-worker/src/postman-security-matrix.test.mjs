import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import { runPostmanCollection } from "./postman-runtime.mjs";

function collection(url) {
  return { info: { name: "Postman security corpus" }, item: [{ name: "matrix", request: { method: "GET", url } }] };
}

const server = http.createServer((_request, response) => response.end("ok"));
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const allowedUrl = `http://127.0.0.1:${port}/health`;

for (let i = 0; i < 250; i += 1) {
  test(`Postman accepts allowlisted local destination ${i}`, async () => {
    const result = await runPostmanCollection({ collection: collection(`${allowedUrl}?case=${i}`), allowedHosts: ["127.0.0.1"], timeoutMs: 5000 });
    assert.equal(result.status, "PASSED");
    assert.equal(result.requests[0].status, 200);
  });
}

for (let i = 0; i < 250; i += 1) {
  const urls = [
    `https://outside-${i}.example.test/`,
    `ftp://127.0.0.1/${i}`,
    `http://127.0.0.1.evil.test/${i}`,
    `not-a-url-${i}`,
    `https://user:pass@outside-${i}.example.test/`,
  ];
  test(`Postman rejects untrusted destination ${i}`, async () => {
    await assert.rejects(
      Promise.resolve().then(() => runPostmanCollection({ collection: collection(urls[i % urls.length]), allowedHosts: ["127.0.0.1"], timeoutMs: 5000 })),
      /URL inválida|Protocolo no permitido|allowlist del ambiente/,
    );
  });
}

test.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
