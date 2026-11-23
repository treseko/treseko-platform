import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const runtimeRoot = path.dirname(fileURLToPath(import.meta.url));
const pointerPath = path.join(runtimeRoot, ".treseko-active-worker-release.json");
const releaseRoot = path.join(runtimeRoot, ".worker-releases");

function loadRootEnv() {
  const envFile = path.join(runtimeRoot, ".env");
  if (!fs.existsSync(envFile)) return;
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || process.env[key]) continue;
    process.env[key] = trimmed.slice(separator + 1).trim();
  }
}

function activeEntryPoint() {
  if (!fs.existsSync(pointerPath)) return path.join(runtimeRoot, "src", "worker.mjs");
  const pointer = JSON.parse(fs.readFileSync(pointerPath, "utf8"));
  if (pointer?.schema !== 1 || typeof pointer.release !== "string"
      || !/^[0-9]+\.[0-9]+\.[0-9]+-[a-f0-9]{12}$/.test(pointer.release)) {
    throw new Error("El puntero de la version activa del Worker no es valido.");
  }
  const entry = path.resolve(releaseRoot, pointer.release, "src", "worker.mjs");
  if (!entry.startsWith(`${releaseRoot}${path.sep}`)) throw new Error("La version activa apunta fuera del directorio autorizado.");
  const metadata = fs.lstatSync(entry);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("El entrypoint activo del Worker no es un archivo regular.");
  return entry;
}

loadRootEnv();
process.env.QA_WORKER_RUNTIME_DIR = runtimeRoot;
process.env.QA_RUNNER_TOKEN_FILE ||= path.join(runtimeRoot, ".runner-token");
process.env.QA_RUNNER_PAIRING_STATE_FILE ||= `${process.env.QA_RUNNER_TOKEN_FILE}.pairing`;
process.env.QA_WORKER_INSTANCE_ID_FILE ||= path.join(runtimeRoot, ".worker-instance-id");
process.env.QA_RESULT_SPOOL_DIR ||= path.join(runtimeRoot, ".state", "result-spool");
process.env.QA_CLAIM_INTENT_DIR ||= path.join(runtimeRoot, ".state", "claim-intent");
process.env.QA_UPDATE_CONTROL_DIR ||= path.join(runtimeRoot, ".state", "update-control");

let child;
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    stopping = true;
    child?.kill(signal);
  });
}

function launchActiveRelease() {
  const entry = activeEntryPoint();
  child = spawn(process.execPath, [entry, ...process.argv.slice(2)], {
    cwd: path.dirname(entry),
    env: process.env,
    stdio: "inherit",
  });
  child.on("error", error => {
    console.error("No se pudo iniciar el runtime Automation Worker:", error.message);
    process.exitCode = 1;
  });
  child.on("exit", (code, signal) => {
    if (signal) {
      if (!stopping) process.kill(process.pid, signal);
      else process.exitCode = signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : 129;
      return;
    }
    if (code === 75 && !stopping) {
      try {
        launchActiveRelease();
      } catch (error) {
        console.error("No se pudo activar la nueva release del Automation Worker:", error.message);
        process.exitCode = 1;
      }
      return;
    }
    process.exitCode = Number.isInteger(code) ? code : 1;
  });
}

launchActiveRelease();
