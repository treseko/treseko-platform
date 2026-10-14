import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const probe = path.join(frontendRoot, "test/security-postcss-no-from-probe.mjs");
const result = JSON.parse(execFileSync(process.execPath, [probe], { encoding: "utf8" }));

for (const [index, item] of result.cases.entries()) {
  test(`postcss ${item.kind} regression ${index.toString().padStart(3, "0")}`, () => {
    assert.equal(item.safe, true, `${item.kind} must not disclose a source map`);
  });
}

test("postcss includes the no-from source map fix", () => {
  const [major, minor, patch] = result.version.split(".").map(Number);
  assert.ok(major > 8 || (major === 8 && (minor > 5 || (minor === 5 && patch >= 23))), `${result.version} remains in the no-from advisory range`);
});
