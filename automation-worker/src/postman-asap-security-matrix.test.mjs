import assert from "node:assert/strict";
import test from "node:test";
import { closeAsapProbe, malformedAsapKeyDoesNotSign, validAsapSignature } from "../test/security/postman-asap-probe.mjs";

for (let i = 0; i < 250; i += 1) {
  test(`Postman ASAP signs valid PKCS8 key and claims ${i}`, async () => {
    assert.equal(await validAsapSignature(i), true);
  });
}

for (let i = 0; i < 250; i += 1) {
  test(`Postman ASAP rejects malformed key before adding a bearer token ${i}`, async () => {
    assert.equal(await malformedAsapKeyDoesNotSign(i), true);
  });
}

test.after(closeAsapProbe);
