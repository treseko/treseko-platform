import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const uuid = require("uuid");
const packageJson = require(require.resolve("uuid/package.json"));

test("uuid version excludes the buffer bounds advisory", () => {
  const [major, minor, patch] = packageJson.version.split(".").map(Number);
  assert.ok(major > 11 || (major === 11 && (minor > 1 || (minor === 1 && patch >= 1))), `uuid ${packageJson.version} is affected`);
});

for (let index = 0; index < 250; index += 1) {
  test(`Postman compatible v4 generation ${index}`, () => {
    const value = uuid.v4();
    assert.match(value, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });
}
