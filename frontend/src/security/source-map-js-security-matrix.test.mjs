import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const probe = path.join(frontendRoot, "test/security-source-map-js-probe.mjs");
const result = JSON.parse(execFileSync(process.execPath, [probe], { encoding: "utf8" }));

for (const [index, item] of result.cases.entries()) {
  test(`source-map-js ${item.kind} section offset ${index.toString().padStart(3, "0")}`, () => {
    assert.equal(item.valid, true, `${item.kind} source map remains readable`);
  });
}

test("source-map-js version validates indexed section offsets", () => {
  const [major, minor, patch] = result.version.split(".").map(Number);
  assert.ok(major > 1 || (major === 1 && (minor > 2 || (minor === 2 && patch >= 2))), `${result.version} is in the affected advisory range`);
});
