import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lock = JSON.parse(fs.readFileSync(path.join(frontendRoot, "package-lock.json"), "utf8"));
const lockPath = Object.keys(lock.packages ?? {}).find((name) => name.endsWith("baseline-browser-mapping"));
const packageDirectory = path.join(frontendRoot, lockPath);
const metadata = JSON.parse(fs.readFileSync(path.join(packageDirectory, "package.json"), "utf8"));
const baseline = createRequire(path.join(packageDirectory, "package.json"))(packageDirectory);
const originalExit = process.exit;
const originalLog = console.log;
let exitCalls = 0;
process.exit = () => {
  exitCalls += 1;
  throw new Error("PROCESS_EXIT_INTERCEPTED");
};
console.log = () => {};

const cases = [];
for (let index = 0; index < 250; index += 1) {
  let threw = false;
  const previousExitCalls = exitCalls;
  try {
    baseline.getCompatibleVersions({
      targetYear: 2020 + (index % 7),
      widelyAvailableOnDate: `202${index % 5}-01-01`,
      suppressWarnings: true,
    });
  } catch {
    threw = true;
  }
  cases.push({ kind: "conflicting-options", didExit: exitCalls > previousExitCalls, threw });
}

for (let index = 0; index < 250; index += 1) {
  let validResult = false;
  try {
    const result = baseline.getCompatibleVersions({ targetYear: 2018 + (index % 7), suppressWarnings: true });
    validResult = Array.isArray(result) && result.length > 0;
  } catch {
    validResult = false;
  }
  cases.push({ kind: "valid-options", validResult });
}

process.exit = originalExit;
console.log = originalLog;
process.stdout.write(JSON.stringify({ version: metadata.version, cases }));
