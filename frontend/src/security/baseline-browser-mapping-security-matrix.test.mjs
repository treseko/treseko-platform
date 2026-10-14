import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const probe = path.join(frontendRoot, "test/security-baseline-browser-mapping-probe.mjs");
const result = JSON.parse(execFileSync(process.execPath, [probe], { encoding: "utf8" }));

for (const [index, item] of result.cases.entries()) {
  test(`baseline browser mapping ${item.kind} case ${index.toString().padStart(3, "0")}`, () => {
    if (item.kind === "conflicting-options") {
      assert.equal(item.didExit, false, "invalid input must not terminate the process");
      assert.equal(item.threw, true, "invalid input must be reported as an exception");
    } else {
      assert.equal(item.validResult, true, "valid options still return browser data");
    }
  });
}

test("baseline-browser-mapping version includes the process-exit fix", () => {
  const [major, minor] = result.version.split(".").map(Number);
  assert.ok(major > 2 || (major === 2 && minor >= 11), `${result.version} is in an affected advisory range`);
});
