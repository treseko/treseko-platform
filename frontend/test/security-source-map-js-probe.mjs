import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lock = JSON.parse(fs.readFileSync(path.join(frontendRoot, "package-lock.json"), "utf8"));
const lockPath = Object.keys(lock.packages ?? {}).find((name) => name.endsWith("source-map-js"));
const packageDirectory = path.join(frontendRoot, lockPath);
const metadata = JSON.parse(fs.readFileSync(path.join(packageDirectory, "package.json"), "utf8"));
const sourceMap = createRequire(path.join(packageDirectory, "package.json"))(packageDirectory);
const cases = [];

for (let index = 0; index < 250; index += 1) {
  const lineOffset = index;
  const map = {
    version: 3,
    sections: [{ offset: { line: lineOffset, column: index % 13 }, map: { version: 3, sources: ["input.js"], names: [], mappings: "AAAA" } }],
  };
  try {
    const consumer = new sourceMap.SourceMapConsumer(map);
    const mappings = [];
    consumer.eachMapping((mapping) => mappings.push(mapping));
    cases.push({ kind: "ordinary-offset", valid: mappings.length === 1 && mappings[0].generatedLine === lineOffset + 1 });
    consumer.destroy?.();
  } catch {
    cases.push({ kind: "ordinary-offset", valid: false });
  }
}

for (let index = 0; index < 250; index += 1) {
  const lineOffset = 10000 + index;
  const map = {
    version: 3,
    sections: [{ offset: { line: lineOffset, column: 0 }, map: { version: 3, sources: ["input.js"], names: [], mappings: "AAAA" } }],
  };
  try {
    const consumer = new sourceMap.SourceMapConsumer(map);
    const mappings = [];
    consumer.eachMapping((mapping) => mappings.push(mapping));
    cases.push({ kind: "large-offset", valid: mappings.length === 1 && mappings[0].generatedLine === lineOffset + 1 });
    consumer.destroy?.();
  } catch {
    cases.push({ kind: "large-offset", valid: false });
  }
}

process.stdout.write(JSON.stringify({ version: metadata.version, cases }));
