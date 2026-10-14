import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lock = JSON.parse(fs.readFileSync(path.join(frontendRoot, "package-lock.json"), "utf8"));
const lockPath = Object.keys(lock.packages ?? {}).find((name) => name.endsWith("js-yaml"));
const packageDirectory = process.env.TRESEKO_JS_YAML_PACKAGE_DIR || path.join(frontendRoot, lockPath);
const metadata = JSON.parse(fs.readFileSync(path.join(packageDirectory, "package.json"), "utf8"));
const yaml = createRequire(path.join(packageDirectory, "package.json"))(packageDirectory);
const cases = [];

for (let index = 0; index < 250; index += 1) {
  const emptyMappings = Array.from({ length: 4 + (index % 3) }, () => "{}").join(", ");
  const targets = Array.from({ length: 4 }, () => "  - <<: *emptyMappings").join("\n");
  const input = `source: &emptyMappings [${emptyMappings}]\ntargets:\n${targets}\n`;
  let rejectedByLimit = false;
  try {
    yaml.load(input, { schema: yaml.YAML11_SCHEMA, maxTotalMergeKeys: 10 });
  } catch (error) {
    rejectedByLimit = error.name === "YAMLException" && /maxTotalMergeKeys/.test(error.reason ?? error.message);
  }
  cases.push({ kind: "empty-merge-over-limit", valid: rejectedByLimit });
}

for (let index = 0; index < 250; index += 1) {
  const input = `source: &oneMapping [{value: ${index}}]\ntarget:\n  <<: *oneMapping\n`;
  try {
    const parsed = yaml.load(input, { schema: yaml.YAML11_SCHEMA, maxTotalMergeKeys: 10 });
    cases.push({ kind: "within-limit", valid: parsed.target?.value === index });
  } catch {
    cases.push({ kind: "within-limit", valid: false });
  }
}

process.stdout.write(JSON.stringify({ version: metadata.version, cases }));
