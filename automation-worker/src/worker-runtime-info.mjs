import os from "node:os";
import fsNode from "node:fs";

export function normalizeApiBase(value) {
  let parsed;
  try {
    parsed = new URL(String(value || ""));
  } catch {
    throw new Error("QA_API_BASE debe ser una URL HTTP/HTTPS válida.");
  }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("QA_API_BASE debe usar HTTP/HTTPS y no puede incluir credenciales, query ni fragmento.");
  }
  return parsed.toString().replace(/\/+$/, "");
}

export function loadEnv(filePath, fs = fsNode) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

export function readWorkerVersion({ candidates, fs, require, packagePath, fallback = "0.0.0-dev" } = {}) {
  for (const candidate of candidates || []) {
    if (!candidate) continue;
    if (!String(candidate).includes("/") && !String(candidate).includes("\\")) return String(candidate).trim();
    try {
      if (fs.existsSync(candidate)) {
        const version = fs.readFileSync(candidate, "utf8").trim();
        if (version) return version;
      }
    } catch (_) { /* version lookup must not prevent startup */ }
  }
  try { return require(packagePath).version || fallback; } catch (_) { return fallback; }
}

export function localIps(networkInterfaces = os.networkInterfaces()) {
  const ips = [];
  for (const entries of Object.values(networkInterfaces)) {
    for (const entry of entries || []) if (!entry.internal && entry.family === "IPv4") ips.push(entry.address);
  }
  return ips;
}
