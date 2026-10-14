import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lock = JSON.parse(fs.readFileSync(path.join(frontendRoot, "package-lock.json"), "utf8"));
const lockPath = Object.keys(lock.packages ?? {}).find((name) => name.endsWith("nanoid"));
const packageDirectory = path.join(frontendRoot, lockPath);
const metadata = JSON.parse(fs.readFileSync(path.join(packageDirectory, "package.json"), "utf8"));
const childCode = `
  const { customAlphabet } = require(${JSON.stringify(packageDirectory)});
  const cases = [];
  for (let index = 0; index < 250; index += 1) {
    const value = customAlphabet('abc', 0)();
    cases.push({ kind: 'zero-size', valid: typeof value === 'string' && value.length === 0 });
  }
  for (let size = 1; size <= 250; size += 1) {
    const value = customAlphabet('abc', size)();
    cases.push({ kind: 'positive-size', valid: typeof value === 'string' && value.length === size });
  }
  process.stdout.write(JSON.stringify(cases));
`;
const child = spawnSync(process.execPath, ["-e", childCode], { encoding: "utf8", timeout: 750 });
let cases;
if (child.error?.code === "ETIMEDOUT") {
  cases = Array.from({ length: 500 }, (_, index) => ({
    kind: index < 250 ? "zero-size" : "positive-size",
    valid: false,
  }));
} else {
  try {
    cases = JSON.parse(child.stdout);
  } catch {
    cases = Array.from({ length: 500 }, (_, index) => ({
      kind: index < 250 ? "zero-size" : "positive-size",
      valid: false,
    }));
  }
}

process.stdout.write(JSON.stringify({ version: metadata.version, timedOut: child.error?.code === "ETIMEDOUT", cases }));
