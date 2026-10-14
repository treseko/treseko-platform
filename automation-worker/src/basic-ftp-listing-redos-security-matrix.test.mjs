import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const packagePath = require.resolve("basic-ftp/package.json");
const version = require(packagePath).version;
const { parseLine } = require(path.join(path.dirname(packagePath), "dist/parseListUnix.js"));
const cases = [];

for (let index = 0; index < 250; index += 1) {
  const bytes = 8192 + (index % 8) * 128;
  const line = `-rw-r--r-- 1 ${"a ".repeat(Math.floor((bytes - 32) / 2))}!`;
  const started = performance.now();
  parseLine(line);
  const elapsedMs = performance.now() - started;
  cases.push({ kind: "malformed-unix-listing", elapsedMs, safe: elapsedMs < 20 });
}

for (let index = 0; index < 250; index += 1) {
  const line = `-rw-r--r-- 1 owner group ${1000 + index} Jan 1 2020 file-${index}.txt`;
  const started = performance.now();
  const parsed = parseLine(line);
  const elapsedMs = performance.now() - started;
  cases.push({ kind: "valid-unix-listing-control", elapsedMs, safe: Boolean(parsed) && elapsedMs < 20 });
}

test("basic-ftp listing parser is outside the quadratic backtracking range", () => {
  const [major, minor, patch] = version.split(".").map(Number);
  assert.ok(major > 6 || (major === 6 && (minor > 2 || (minor === 2 && patch >= 1))), `basic-ftp ${version} is affected`);
});

for (const [index, item] of cases.entries()) {
  test(`${item.kind} case ${String(index).padStart(3, "0")}`, () => {
    assert.equal(item.safe, true, `${item.kind} took ${item.elapsedMs.toFixed(2)}ms`);
  });
}
