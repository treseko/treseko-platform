import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lock = JSON.parse(fs.readFileSync(path.join(frontendRoot, "package-lock.json"), "utf8"));
const lockPath = Object.keys(lock.packages ?? {}).find((name) => name.endsWith("browserslist"));
const packageDirectory = path.join(frontendRoot, lockPath);
const metadata = JSON.parse(fs.readFileSync(path.join(packageDirectory, "package.json"), "utf8"));
const browserslist = createRequire(path.join(packageDirectory, "package.json"))(packageDirectory);
const cases = [];

for (let index = 0; index < 250; index += 1) {
  const year = 1900 + Math.floor(index / 12);
  const month = String((index % 12) + 1).padStart(2, "0");
  const query = `since ${year}-${month}-01`;
  let result;
  try {
    result = browserslist(query);
  } catch {
    result = null;
  }
  cases.push({ kind: "distinct-query", query, valid: Array.isArray(result) && result.length > 0 });
}

for (let index = 0; index < 250; index += 1) {
  const stats = JSON.parse(`{"__proto__":{"probe-${index}":"100"}}`);
  let result;
  try {
    result = browserslist("> 0.1%", { stats });
  } catch {
    result = null;
  }
  cases.push({ kind: "prototype-key-stats", valid: Array.isArray(result) && result.length > 0 });
}

process.stdout.write(JSON.stringify({ version: metadata.version, cases }));
