import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const probe = path.join(frontendRoot, "test/security-nanoid-negative-size-probe.mjs");
const result = JSON.parse(execFileSync(process.execPath, [probe], { encoding: "utf8" }));

for (const [index, item] of result.cases.entries()) {
  test(`nanoid ${item.kind} size regression ${index.toString().padStart(3, "0")}`, () => {
    assert.equal(item.valid, true, `${item.kind} must complete with the expected string length`);
  });
}

test("nanoid non-secure generator includes the negative-size fix", () => {
  const [major, minor, patch] = result.version.split(".").map(Number);
  assert.ok(major > 3 || (major === 3 && (minor > 3 || (minor === 3 && patch >= 16))), `${result.version} is in the negative-size advisory range`);
});
