import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lock = JSON.parse(fs.readFileSync(path.join(frontendRoot, "package-lock.json"), "utf8"));
const packageDirectory = (name) => {
  const lockPath = Object.keys(lock.packages ?? {}).find((item) => item === `node_modules/${name}`);
  return lockPath ? path.join(frontendRoot, lockPath) : null;
};
const readVersion = (name) => {
  const directory = packageDirectory(name);
  return directory ? JSON.parse(fs.readFileSync(path.join(directory, "package.json"), "utf8")).version : null;
};
const versions = {
  vitest: readVersion("vitest"),
  mocker: readVersion("@vitest/mocker"),
  tinypool: readVersion("tinypool"),
};
const cases = [];
const tinypoolDirectory = packageDirectory("tinypool");

if (tinypoolDirectory) {
  const { Tinypool } = await import(pathToFileURL(path.join(tinypoolDirectory, "dist/index.js")));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "treseko-vitest-worker-"));
  const legitimateWorker = path.join(root, "legitimate.mjs");
  const hostileWorker = path.join(root, "hostile.mjs");
  const execArgvMarker = path.join(root, "exec-argv-marker");
  const filenameMarker = path.join(root, "filename-marker");
  const payload = path.join(root, "payload.cjs");
  fs.writeFileSync(legitimateWorker, "export default value => ({ worker: 'legitimate', value })\n");
  fs.writeFileSync(hostileWorker, "export default value => ({ worker: 'hostile', value })\n");
  fs.writeFileSync(payload, `require('fs').writeFileSync(${JSON.stringify(execArgvMarker)}, 'executed')\n`);

  try {
    Object.prototype.execArgv = ["--require", payload];
    const execPool = new Tinypool({ filename: legitimateWorker, minThreads: 1, maxThreads: 1 });
    const execResults = [];
    try {
      for (let index = 0; index < 250; index += 1) execResults.push(await execPool.run(index));
    } finally {
      await execPool.destroy();
      delete Object.prototype.execArgv;
    }
    const execWasRun = fs.existsSync(execArgvMarker);
    for (let index = 0; index < 250; index += 1) {
      cases.push({ kind: "inherited-execArgv", safe: !execWasRun && execResults[index]?.worker === "legitimate" && execResults[index]?.value === index });
    }

    const controlPool = new Tinypool({ filename: legitimateWorker, minThreads: 1, maxThreads: 1 });
    const controlResults = [];
    try {
      for (let index = 0; index < 250; index += 1) controlResults.push(await controlPool.run(index));
    } finally {
      await controlPool.destroy();
    }
    for (let index = 0; index < 250; index += 1) {
      cases.push({ kind: "legitimate-worker-control", safe: controlResults[index]?.worker === "legitimate" && controlResults[index]?.value === index });
    }

    Object.prototype.filename = hostileWorker;
    const filenamePool = new Tinypool({ filename: legitimateWorker, minThreads: 1, maxThreads: 1 });
    const filenameResults = [];
    try {
      for (let index = 0; index < 250; index += 1) filenameResults.push(await filenamePool.run(index, {}));
    } finally {
      await filenamePool.destroy();
      delete Object.prototype.filename;
    }
    const hostileWorkerSelected = filenameResults.some((result) => result?.worker === "hostile");
    for (let index = 0; index < 250; index += 1) {
      cases.push({ kind: "inherited-run-filename", safe: !hostileWorkerSelected && filenameResults[index]?.worker === "legitimate" && filenameResults[index]?.value === index });
    }
  } finally {
    delete Object.prototype.execArgv;
    delete Object.prototype.filename;
    fs.rmSync(root, { recursive: true, force: true });
  }
} else {
  for (const kind of ["inherited-execArgv", "legitimate-worker-control", "inherited-run-filename"]) {
    for (let index = 0; index < 250; index += 1) cases.push({ kind, safe: true });
  }
}

process.stdout.write(JSON.stringify({ versions, cases }));
