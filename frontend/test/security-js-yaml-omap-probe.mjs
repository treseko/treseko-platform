import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lock = JSON.parse(fs.readFileSync(path.join(frontendRoot, "package-lock.json"), "utf8"));
const lockPath = Object.keys(lock.packages ?? {}).find((name) => name.endsWith("js-yaml"));
const packageDirectory = path.join(frontendRoot, lockPath);
const metadata = JSON.parse(fs.readFileSync(path.join(packageDirectory, "package.json"), "utf8"));
const yaml = createRequire(path.join(packageDirectory, "package.json"))(packageDirectory);
const cases = [];

for (let index = 0; index < 250; index += 1) {
  const entries = Array.from({ length: 40 }, (_, item) => `- key-${item}: value-${index}-${item}`);
  try {
    const parsed = yaml.load(`!!omap\n${entries.join("\n")}\n`);
    cases.push({ kind: "valid-omap", valid: Array.isArray(parsed) && parsed.length === entries.length });
  } catch {
    cases.push({ kind: "valid-omap", valid: false });
  }
}

for (let index = 0; index < 250; index += 1) {
  try {
    yaml.load(`!!omap\n- duplicate: first-${index}\n- duplicate: second-${index}\n`);
    cases.push({ kind: "duplicate-omap", valid: false });
  } catch (error) {
    cases.push({ kind: "duplicate-omap", valid: error.name === "YAMLException" });
  }
}

process.stdout.write(JSON.stringify({ version: metadata.version, cases }));
