import assert from "node:assert/strict";
import { createPrivateKey, generateKeyPairSync, verify } from "node:crypto";
import http from "node:http";
import { runPostmanCollection } from "../../src/postman-runtime.mjs";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});
const keyObject = createPrivateKey(privateKey);
const dataUri = `data:application/pkcs8;kid=qa-key;base64,${keyObject.export({ type: "pkcs8", format: "der" }).toString("base64")}`;

let lastAuthorization = null;
const server = http.createServer((request, response) => {
  lastAuthorization = request.headers.authorization || null;
  response.end("ok");
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}/asap`;

function collection(index, keyValue, keyId = "qa-key") {
  return {
    info: { name: "Treseko ASAP auth security corpus" },
    item: [{
      name: `asap-${index}`,
      request: {
        method: "GET",
        url,
        auth: { type: "asap", asap: [
          { key: "kid", value: keyId },
          { key: "iss", value: "treseko-qa" },
          { key: "aud", value: "127.0.0.1" },
          { key: "jti", value: `security-case-${index}` },
          { key: "privateKey", value: keyValue },
        ] },
      },
    }],
  };
}

export async function validAsapSignature(index) {
  lastAuthorization = null;
  const result = await runPostmanCollection({ collection: collection(index, dataUri), allowedHosts: ["127.0.0.1"], timeoutMs: 5000 });
  assert.equal(result.status, "PASSED");
  assert.equal(result.requests[0]?.status, 200);
  assert.match(lastAuthorization || "", /^Bearer /);
  const [header, payload, signature] = lastAuthorization.slice(7).split(".");
  assert.equal(verify("RSA-SHA256", Buffer.from(`${header}.${payload}`), publicKey, Buffer.from(signature, "base64url")), true);
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  assert.equal(claims.iss, "treseko-qa");
  assert.equal(claims.aud, "127.0.0.1");
  assert.equal(typeof claims.jti, "string");
  assert.ok(claims.jti.length > 0);
  return true;
}

export async function malformedAsapKeyDoesNotSign(index) {
  lastAuthorization = null;
  const badKeys = [
    "data:application/pkcs8;kid=wrong;base64,AAAA",
    "data:application/pkcs8;kid=qa-key;base64,@@@",
    "data:application/pkcs8;kid=qa-key;base64,AA==",
    "data:application/pkcs8;kid=qa-key;base64,not-der",
    "data:application/pkcs8;kid=qa-key;base64,",
  ];
  const result = await runPostmanCollection({
    collection: collection(index, badKeys[index % badKeys.length]),
    allowedHosts: ["127.0.0.1"], timeoutMs: 5000,
  });
  assert.equal(result.events.some(event => event.type === "console" && /could not sign the request/.test(event.message)), true);
  assert.equal(lastAuthorization?.startsWith("Bearer ") || false, false);
  return true;
}

export function closeAsapProbe() {
  return new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
