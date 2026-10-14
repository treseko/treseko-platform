import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const probe = path.join(frontendRoot, "test/security-browserslist-probe.mjs");
const result = JSON.parse(execFileSync(process.execPath, [probe], { encoding: "utf8" }));

for (const [index, item] of result.cases.entries()) {
  test(`browserslist ${item.kind} security case ${index.toString().padStart(3, "0")}`, () => {
    assert.equal(item.valid, true, `${item.kind} input must be handled safely`);
  });
}

test("browserslist contains both advisory fixes", () => {
  const [major, minor, patch] = result.version.split(".").map(Number);
  assert.ok(major > 4 || (major === 4 && (minor > 28 || (minor === 28 && patch >= 7))), `${result.version} is in an affected advisory range`);
});
