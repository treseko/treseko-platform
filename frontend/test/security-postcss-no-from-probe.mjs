import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lock = JSON.parse(fs.readFileSync(path.join(frontendRoot, "package-lock.json"), "utf8"));
const lockPath = Object.keys(lock.packages ?? {}).find((name) => name.endsWith("postcss"));
const packageDirectory = path.join(frontendRoot, lockPath);
const metadata = JSON.parse(fs.readFileSync(path.join(packageDirectory, "package.json"), "utf8"));
const postcss = createRequire(path.join(packageDirectory, "package.json"))(packageDirectory);
const root = fs.mkdtempSync(path.join(os.tmpdir(), "treseko-postcss-no-from-"));
const originalWarn = console.warn;
console.warn = () => {};
const cases = [];

try {
  for (let index = 0; index < 250; index += 1) {
    const sentinel = `POSTCSS_NO_FROM_SECRET_${index}`;
    const mapPath = path.join(root, `absolute-${index}.map`);
    fs.writeFileSync(mapPath, JSON.stringify({ version: 3, sources: ["private.css"], sourcesContent: [sentinel], names: [], mappings: "" }));
    const css = `a { color: red }\n/*# sourceMappingURL=${mapPath} */`;
    try {
      const result = await postcss([]).process(css, { map: true });
      cases.push({ kind: "absolute-without-from", safe: !String(result.map ?? "").includes(sentinel) });
    } catch {
      cases.push({ kind: "absolute-without-from", safe: true });
    }
  }

  for (let index = 0; index < 250; index += 1) {
    const sentinel = `POSTCSS_MAP_DISABLED_SECRET_${index}`;
    const mapPath = path.join(root, `disabled-${index}.map`);
    fs.writeFileSync(mapPath, JSON.stringify({ version: 3, sources: ["private.css"], sourcesContent: [sentinel], names: [], mappings: "" }));
    const css = `a { color: green }\n/*# sourceMappingURL=${mapPath} */`;
    try {
      const result = await postcss([]).process(css, { map: false });
      cases.push({ kind: "disabled-map", safe: result.map === undefined });
    } catch {
      cases.push({ kind: "disabled-map", safe: false });
    }
  }
} finally {
  console.warn = originalWarn;
  fs.rmSync(root, { recursive: true, force: true });
}

process.stdout.write(JSON.stringify({ version: metadata.version, cases }));
