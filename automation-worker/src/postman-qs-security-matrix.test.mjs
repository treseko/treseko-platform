import assert from "node:assert/strict";
import test from "node:test";
import {
  normalQsSerialization,
  postmanRequestQsVersion,
  qsAdvisoryCasesAreHandled,
} from "../test/security/postman-qs-probe.mjs";

test("Postman Request resolves the patched qs release", () => {
  assert.equal(postmanRequestQsVersion, "6.16.0");
});

for (let i = 0; i < 250; i += 1) {
  test(`Postman Request qs preserves ordinary serialization ${i}`, () => {
    assert.equal(normalQsSerialization(i), true);
  });
}

for (let i = 0; i < 250; i += 1) {
  test(`Postman Request qs handles advisory inputs safely ${i}`, () => {
    assert.equal(qsAdvisoryCasesAreHandled(i), true);
  });
}
