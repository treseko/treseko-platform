import assert from "node:assert/strict";
import http from "node:http";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const axios = require("axios");
const server = http.createServer((request, response) => {
  response.writeHead(200, { "content-type": "text/plain" });
  response.end(request.method);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}/method`;

async function requestObservedMethod(config, shorthand = false) {
  let receivedMethod;
  const responsePromise = new Promise(resolve => {
    const listener = request => {
      receivedMethod = request.method;
      server.off("request", listener);
      resolve(request.method);
    };
    server.on("request", listener);
  });
  Object.prototype.method = "DELETE";
  try {
    const requestConfig = { url, ...config };
    await (shorthand ? axios(requestConfig) : axios.request(requestConfig));
  } finally {
    delete Object.prototype.method;
  }
  await responsePromise;
  return receivedMethod;
}

test("Axios inherited method regression matrix", async t => {
  for (let i = 0; i < 250; i += 1) {
    await t.test(`default request ignores inherited method ${i}`, async () => {
      assert.equal(await requestObservedMethod({}), "GET");
    });
  }

  for (let i = 0; i < 250; i += 1) {
    await t.test(`callable shorthand ignores inherited method ${i}`, async () => {
      assert.equal(await requestObservedMethod({}, true), "GET");
    });
  }

  for (let i = 0; i < 250; i += 1) {
    await t.test(`explicit GET remains GET under inherited method ${i}`, async () => {
      assert.equal(await requestObservedMethod({ method: "GET" }), "GET");
    });
  }
});

test.after(() => new Promise((resolve, reject) => {
  server.close(error => error ? reject(error) : resolve());
}));
