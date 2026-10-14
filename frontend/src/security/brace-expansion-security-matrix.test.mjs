import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const probe = path.join(frontendRoot, "test/security-brace-expansion-probe.mjs");
const inventory = JSON.parse(execFileSync(process.execPath, [probe], { encoding: "utf8" }));

for (const [index, item] of inventory.cases.entries()) {
  test(`brace-expansion ${item.kind} control ${index.toString().padStart(3, "0")}`, () => {
    assert.deepEqual(item.actual, item.expected);
  });
}

test("all locked brace-expansion copies include the advisory fixes", () => {
  assert.equal(inventory.versions.length, 2);
  for (const version of inventory.versions) {
    const [major, minor, patch] = version.split(".").map(Number);
    assert.ok((major === 1 && (minor > 1 || (minor === 1 && patch >= 20))) || (major === 5 && (minor > 0 || patch >= 12)), `${version} is in an affected advisory range`);
  }
});
