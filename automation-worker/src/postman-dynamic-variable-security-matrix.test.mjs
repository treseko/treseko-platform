import assert from "node:assert/strict";
import test from "node:test";
import {
  closeCollectionUsageProbe,
  unknownDynamicVariableRemainsLiteral,
  validFakerDynamicVariable,
} from "../test/security/postman-collection-usage-probe.mjs";

for (let i = 0; i < 250; i += 1) {
  test(`Postman resolves Faker generated city safely ${i}`, async () => {
    assert.equal(await validFakerDynamicVariable(i), true);
  });
}

for (let i = 0; i < 250; i += 1) {
  test(`Postman leaves unknown dynamic variable inert ${i}`, async () => {
    assert.equal(await unknownDynamicVariableRemainsLiteral(i), true);
  });
}

test.after(closeCollectionUsageProbe);
