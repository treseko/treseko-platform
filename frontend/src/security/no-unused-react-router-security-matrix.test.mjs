import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sourceRoot = path.join(frontendRoot, "src");
const sourceFiles = [];

function collectSourceFiles(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) collectSourceFiles(filename);
    else if (/\.(?:[cm]?[jt]sx?)$/i.test(entry.name)) sourceFiles.push(filename);
  }
}

collectSourceFiles(sourceRoot);
const routerImport = /(?:from\s*|require\s*\()\s*["']react-router(?:-dom)?(?:\/|["'])/;

for (const filename of sourceFiles) {
  test(`frontend module ${path.relative(sourceRoot, filename)} does not import React Router`, () => {
    assert.doesNotMatch(fs.readFileSync(filename, "utf8"), routerImport);
  });
}

test("unused React Router packages are absent from manifest and lockfile", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(frontendRoot, "package.json"), "utf8"));
  const lock = JSON.parse(fs.readFileSync(path.join(frontendRoot, "package-lock.json"), "utf8"));
  assert.equal(manifest.dependencies?.["react-router-dom"], undefined);
  assert.equal(lock.packages?.["node_modules/react-router-dom"], undefined);
  assert.equal(lock.packages?.["node_modules/react-router"], undefined);
});
