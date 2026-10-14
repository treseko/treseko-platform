import assert from "node:assert/strict";
import test from "node:test";
import {
  closeOauthProbe,
  hostileOauthQueryIsBounded,
  validOauthQuerySerializes,
} from "../test/security/postman-oauth-probe.mjs";

for (let i = 0; i < 250; i += 1) {
  test(`Postman OAuth1 serializes normal repeated query parameters ${i}`, async () => {
    assert.equal(await validOauthQuerySerializes(i), true);
  });
}

for (let i = 0; i < 250; i += 1) {
  test(`Postman OAuth1 bounds hostile query parameter shapes ${i}`, async () => {
    assert.equal(await hostileOauthQueryIsBounded(i), true);
  });
}

test.after(closeOauthProbe);
