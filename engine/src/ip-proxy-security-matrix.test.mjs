import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import fs from "node:fs";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const proxyaddr = require("proxy-addr");

const serverSource = fs.readFileSync(new URL("./server.ts", import.meta.url), "utf8");
assert.match(serverSource, /client_ip:\s*req\.ip/);
assert.doesNotMatch(serverSource, /app\.set\(\s*["']trust proxy["']/);

test("proxy-addr does not trust IPv4 peers through a short IPv4-mapped IPv6 subnet", () => {
  const trust = proxyaddr.compile(["::ffff:10.0.0.0/8"]);
  assert.equal(trust("192.0.2.1", 0), false);
  assert.equal(trust("10.1.2.3", 0), false);

  const correctTrust = proxyaddr.compile(["::ffff:10.0.0.0/104"]);
  assert.equal(correctTrust("10.1.2.3", 0), true);
  assert.equal(correctTrust("192.0.2.1", 0), false);
});

const app = express();
app.get("/whoami", (req, res) => res.json({ ip: req.ip }));
const server = app.listen(0, "127.0.0.1");
await new Promise(resolve => server.once("listening", resolve));
const address = server.address();
const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });

function getIp(headers = {}) {
  return new Promise((resolve, reject) => {
    const request = http.get({ hostname: "127.0.0.1", port: address.port, path: "/whoami", headers, agent }, response => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", chunk => { body += chunk; });
      response.on("end", () => resolve(JSON.parse(body).ip));
    });
    request.on("error", reject);
  });
}

for (let i = 0; i < 250; i += 1) {
  test(`Engine records socket peer without forwarded header ${i}`, async () => {
    assert.match(await getIp({ "X-Request-Id": `safe-${i}` }), /^(127\.0\.0\.1|::ffff:127\.0\.0\.1)$/);
  });
}

for (let i = 0; i < 250; i += 1) {
  const spoofed = [`203.0.113.${i % 255}`, `::ffff:192.0.2.${i % 255}`, `127.0.0.1, 198.51.100.${i % 255}`, `unknown-${i}`, `10.${i % 255}.0.1`][i % 5];
  test(`Engine ignores untrusted forwarded address ${i}`, async () => {
    const ip = await getIp({ "X-Forwarded-For": spoofed, "X-Real-IP": spoofed });
    assert.match(ip, /^(127\.0\.0\.1|::ffff:127\.0\.0\.1)$/);
    assert.notEqual(ip, spoofed);
  });
}

test.after(() => {
  agent.destroy();
  return new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});
