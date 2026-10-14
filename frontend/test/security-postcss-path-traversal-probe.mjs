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
const root = fs.mkdtempSync(path.join(os.tmpdir(), "treseko-postcss-path-"));
const cases = [];

try {
  for (let index = 0; index < 250; index += 1) {
    const projectDirectory = path.join(root, `project-${index}`, "nested");
    fs.mkdirSync(projectDirectory, { recursive: true });
    const sentinel = `POSTCSS_TRAVERSAL_SECRET_${index}`;
    const mapPath = path.join(root, `secret-${index}.map`);
    fs.writeFileSync(mapPath, JSON.stringify({ version: 3, sources: ["private.css"], sourcesContent: [sentinel], names: [], mappings: "" }));
    const cssPath = path.join(projectDirectory, "input.css");
    const css = `a { color: red }\n/*# sourceMappingURL=../../secret-${index}.map */`;
    try {
      const result = await postcss([]).process(css, { from: cssPath, map: true });
      cases.push({ kind: "traversal", safe: !String(result.map ?? "").includes(sentinel) });
    } catch {
      cases.push({ kind: "traversal", safe: true });
    }
  }

  for (let index = 0; index < 250; index += 1) {
    const directory = path.join(root, `legitimate-${index}`);
    fs.mkdirSync(directory, { recursive: true });
    const sentinel = `POSTCSS_LOCAL_MAP_${index}`;
    fs.writeFileSync(path.join(directory, "input.map"), JSON.stringify({ version: 3, sources: ["original.css"], sourcesContent: [sentinel], names: [], mappings: "" }));
    const cssPath = path.join(directory, "input.css");
    const css = `a { color: blue }\n/*# sourceMappingURL=input.map */`;
    try {
      const result = await postcss([]).process(css, { from: cssPath, map: true });
      cases.push({ kind: "same-directory-map", safe: String(result.map ?? "").includes(sentinel) });
    } catch {
      cases.push({ kind: "same-directory-map", safe: false });
    }
  }
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

process.stdout.write(JSON.stringify({ version: metadata.version, cases }));
