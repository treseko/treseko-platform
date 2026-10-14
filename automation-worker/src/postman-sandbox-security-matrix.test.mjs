import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runPostmanCollection } from "./postman-runtime.mjs";

const server = http.createServer((_request, response) => response.end("ok"));
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}/health`;

function collection(script) {
  return { info: { name: "Postman sandbox security corpus" }, item: [{ name: "sandbox probe", request: { method: "GET", url }, event: [{ listen: "test", script: { exec: [script] } }] }] };
}

for (let i = 0; i < 250; i += 1) {
  test(`Postman sandbox cannot read host sentinel ${i}`, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "treseko-postman-sandbox-"));
    const sentinel = path.join(dir, `sentinel-${i}.txt`);
    fs.writeFileSync(sentinel, `host-marker-${i}`);
    try {
      const script = `const fs=require('fs'); let leaked=false; try { leaked=fs.readFileSync(${JSON.stringify(sentinel)},'utf8')===${JSON.stringify(`host-marker-${i}`)}; } catch(e) {} pm.test('host filesystem is isolated',()=>pm.expect(leaked).to.eql(false));`;
      const result = await runPostmanCollection({ collection: collection(script), allowedHosts: ["127.0.0.1"], timeoutMs: 5000 });
      assert.equal(result.status, "PASSED");
      assert.equal(result.assertions[0]?.status, "PASSED");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}

for (let i = 0; i < 250; i += 1) {
  test(`Postman sandbox denies access to vulnerable Faker module ${i}`, async () => {
    const fakerModules = ["@faker-js/faker", "@faker-js/faker/locale/en", "faker", "@faker-js/faker/dist/index.js", "@faker-js/faker/locale/en"];
    const moduleName = fakerModules[i % fakerModules.length];
    const result = await runPostmanCollection({ collection: collection(`require(${JSON.stringify(moduleName)});`), allowedHosts: ["127.0.0.1"], timeoutMs: 5000 });
    assert.equal(result.events.some(event => event.type === "exception" && event.error.includes("Cannot find module")), true);
  });
}

test.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
