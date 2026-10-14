import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lock = JSON.parse(fs.readFileSync(path.join(frontendRoot, "package-lock.json"), "utf8"));
const packagePaths = Object.keys(lock.packages ?? {}).filter((name) => name.endsWith("brace-expansion"));
const loaded = packagePaths.map((lockPath) => {
  const packageDirectory = path.join(frontendRoot, lockPath);
  const metadata = JSON.parse(fs.readFileSync(path.join(packageDirectory, "package.json"), "utf8"));
  const requireFromPackage = createRequire(path.join(packageDirectory, "package.json"));
  const packageApi = requireFromPackage(packageDirectory);
  const expand = typeof packageApi === "function" ? packageApi : packageApi.expand;
  return { lockPath, version: metadata.version, expand };
});

const cases = [];
for (const [packageIndex, entry] of loaded.entries()) {
  for (let index = 0; index < 250; index += 1) {
    const left = `left-${packageIndex}-${index}`;
    const right = `right-${packageIndex}-${index}`;
    cases.push({
      packageIndex,
      kind: "valid",
      input: `{${left},${right}}`,
      expected: [left, right],
      actual: entry.expand(`{${left},${right}}`),
    });
    const malformed = `{literal-${packageIndex}-${index},unfinished`;
    cases.push({
      packageIndex,
      kind: "malformed",
      input: malformed,
      expected: [malformed],
      actual: entry.expand(malformed),
    });
  }
}

process.stdout.write(JSON.stringify({ packagePaths, versions: loaded.map(({ version }) => version), cases }));
