import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const probe = spawnSync(process.execPath, [path.join(frontendRoot, "test/security-vitest-worker-probe.mjs")], {
  cwd: frontendRoot,
  encoding: "utf8",
  timeout: 120_000,
});
assert.equal(probe.status, 0, probe.stderr || "Vitest worker probe failed");
const result = JSON.parse(probe.stdout);

test("Vitest worker dependency versions are outside the affected ranges", () => {
  assert.ok(result.versions.vitest && result.versions.mocker, "Vitest packages must be installed");
  const majorMinorPatch = (version) => version.split(".").map(Number);
  const atLeast = (version, [major, minor, patch]) => {
    const [vMajor, vMinor, vPatch] = majorMinorPatch(version);
    return vMajor > major || (vMajor === major && (vMinor > minor || (vMinor === minor && vPatch >= patch)));
  };
  assert.ok(atLeast(result.versions.vitest, [4, 1, 11]), `vitest ${result.versions.vitest} is affected`);
  assert.ok(atLeast(result.versions.mocker, [4, 1, 11]), `@vitest/mocker ${result.versions.mocker} is affected`);
  assert.ok(!result.versions.tinypool || atLeast(result.versions.tinypool, [2, 1, 2]), `tinypool ${result.versions.tinypool} is affected`);
});

for (const [index, item] of result.cases.entries()) {
  test(`worker security ${item.kind} ${index + 1}`, () => assert.equal(item.safe, true, `unsafe ${item.kind} at case ${index + 1}`));
}
