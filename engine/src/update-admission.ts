import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type express from "express";

export const UPDATE_ADMISSION_PROTOCOL = "treseko-engine-update-admission";
export const UPDATE_ADMISSION_VERSION = 1;
const TRANSACTION_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;
const MARKER_NAME = ".treseko-engine-update-fence";
const MAX_MARKER_BYTES = 4096;

export class UpdateAdmissionError extends Error {
  readonly code = "ENGINE_UPDATE_ADMISSION_BLOCKED";

  constructor(message: string) {
    super(message);
    this.name = "UpdateAdmissionError";
  }
}

type Marker = { schema: 1; transaction: string };
type LeaseKind = "run-task" | "run-task-sync" | "external";

type AdmissionStatus = {
  protocol: string;
  protocol_version: number;
  enabled: boolean;
  admission_open: boolean;
  marker_state: "disabled" | "absent" | "present" | "invalid";
  owner_transaction: string | null;
  fenced: boolean;
  drainable: boolean;
  active_leases: number;
  active_by_kind: Record<string, number>;
  process: { pid: number; started_at: string; identity: string };
  terminal_delivery: {
    scope: "engine_process_and_local_spool";
    pending_local_deliveries: number;
    local_spool_state: "empty" | "pending" | "unavailable";
    needs_backend_confirmation: true;
  };
};

export const EXTERNAL_ADMISSION_PATHS = [
  "/generate-stories-sync",
  "/generate-test-cases-sync",
  "/diagnose-quality-sync",
  "/provider-health",
  "/opencode/providers",
  "/agent-health",
] as const;

function safeTransaction(value: unknown): value is string {
  return typeof value === "string" && TRANSACTION_RE.test(value);
}

function privateDirectory(directory: string): void {
  const stat = fs.lstatSync(directory);
  const uid = typeof process.getuid === "function" ? process.getuid() : stat.uid;
  if (!stat.isDirectory() || (stat.mode & 0o077) !== 0 || (stat.uid !== 0 && stat.uid !== uid)) {
    throw new Error("Engine update control directory is not private");
  }
}

function fsyncDirectory(directory: string): void {
  const fd = fs.openSync(directory, fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY || 0));
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

function safeLocalPath(directory: string): boolean {
  if (!path.isAbsolute(directory) || directory.split(path.sep).includes("..")) return false;
  try {
    return !fs.lstatSync(directory).isSymbolicLink();
  } catch (error: any) {
    if (error?.code !== "ENOENT") return false;
    let parent = path.dirname(directory);
    while (parent !== path.dirname(parent)) {
      try {
        return fs.lstatSync(parent).isDirectory();
      } catch (parentError: any) {
        if (parentError?.code !== "ENOENT") return false;
        parent = path.dirname(parent);
      }
    }
    return true;
  }
}

function pendingLocalDeliveries(directory: string): { count: number; state: "empty" | "pending" | "unavailable" } {
  if (!safeLocalPath(directory)) return { count: 0, state: "unavailable" };
  try {
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return { count: 0, state: "unavailable" };
    const count = fs.readdirSync(directory).filter((name) => name.endsWith(".json")).length;
    return { count, state: count ? "pending" : "empty" };
  } catch (error: any) {
    if (error?.code === "ENOENT") return { count: 0, state: "empty" };
    return { count: 0, state: "unavailable" };
  }
}

export class UpdateAdmission {
  private readonly directory: string | null;
  private readonly marker: string | null;
  private readonly pendingDirectory: string;
  private readonly startedAt = new Date(Date.now() - process.uptime() * 1000).toISOString();
  private readonly processIdentity = crypto.createHash("sha256")
    .update(`${process.pid}:${this.startedAt}:${crypto.randomUUID()}`)
    .digest("hex");
  private readonly leases = new Map<string, LeaseKind>();

  constructor(
    directory = process.env.TRESEKO_ENGINE_UPDATE_CONTROL_DIR?.trim() || "",
    pendingDirectory = process.env.ENGINE_PENDING_DELIVERIES_DIR
      || path.join(process.env.ENGINE_RUNTIME_DIR || process.cwd(), "pending-deliveries"),
  ) {
    if (directory && (!path.isAbsolute(directory) || directory.split(path.sep).includes(".."))) {
      throw new TypeError("Engine update control directory must be absolute and must not contain ..");
    }
    if (pendingDirectory && (!path.isAbsolute(pendingDirectory) || pendingDirectory.split(path.sep).includes(".."))) {
      throw new TypeError("Engine pending delivery directory must be absolute and must not contain ..");
    }
    if (pendingDirectory && !safeLocalPath(pendingDirectory)) {
      throw new TypeError("Engine pending delivery directory must not use symlinks");
    }
    this.directory = directory || null;
    this.marker = this.directory ? path.join(this.directory, MARKER_NAME) : null;
    this.pendingDirectory = pendingDirectory;
  }

  private readMarker(): { state: "disabled" | "absent" | "present" | "invalid"; marker?: Marker } {
    if (!this.directory || !this.marker) return { state: "disabled" };
    try {
      privateDirectory(this.directory);
      let fd: number;
      try {
        fd = fs.openSync(this.marker, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0));
      } catch (error: any) {
        if (error?.code === "ENOENT") return { state: "absent" };
        return { state: "invalid" };
      }
      let raw: string;
      try {
        const stat = fs.fstatSync(fd);
        const uid = typeof process.getuid === "function" ? process.getuid() : stat.uid;
        if (!stat.isFile() || (stat.mode & 0o077) !== 0 || (stat.uid !== 0 && stat.uid !== uid) || stat.size > MAX_MARKER_BYTES) {
          return { state: "invalid" };
        }
        const buffer = Buffer.alloc(MAX_MARKER_BYTES + 1);
        const bytes = fs.readSync(fd, buffer, 0, buffer.length, 0);
        if (bytes > MAX_MARKER_BYTES) return { state: "invalid" };
        raw = buffer.subarray(0, bytes).toString("utf8");
      } finally {
        fs.closeSync(fd);
      }
      const value = JSON.parse(raw) as Partial<Marker>;
      if (value.schema !== 1 || !safeTransaction(value.transaction)
          || Object.keys(value).some((key) => !["schema", "transaction"].includes(key))) {
        return { state: "invalid" };
      }
      return { state: "present", marker: value as Marker };
    } catch {
      return { state: "invalid" };
    }
  }

  status(): AdmissionStatus {
    const marker = this.readMarker();
    const activeByKind: Record<string, number> = {};
    for (const kind of this.leases.values()) activeByKind[kind] = (activeByKind[kind] || 0) + 1;
    const active = this.leases.size;
    const pending = pendingLocalDeliveries(this.pendingDirectory);
    const fenced = marker.state === "present";
    return {
      protocol: UPDATE_ADMISSION_PROTOCOL,
      protocol_version: UPDATE_ADMISSION_VERSION,
      enabled: marker.state !== "disabled",
      admission_open: marker.state === "disabled" || marker.state === "absent",
      marker_state: marker.state,
      owner_transaction: marker.marker?.transaction || null,
      fenced,
      drainable: marker.state === "present" && active === 0 && pending.state === "empty",
      active_leases: active,
      active_by_kind: activeByKind,
      process: { pid: process.pid, started_at: this.startedAt, identity: this.processIdentity },
      terminal_delivery: {
        scope: "engine_process_and_local_spool",
        pending_local_deliveries: pending.count,
        local_spool_state: pending.state,
        needs_backend_confirmation: true,
      },
    };
  }

  private assertAdmissionOpen(): void {
    const status = this.status();
    if (status.marker_state === "invalid") throw new UpdateAdmissionError("Engine update admission control is unreadable or corrupt");
    if (status.fenced) throw new UpdateAdmissionError("Engine admission is fenced for an update");
  }

  beginLease(kind: LeaseKind, label = "request"): () => void {
    this.assertAdmissionOpen();
    const id = `${kind}:${label}:${crypto.randomUUID()}`;
    this.leases.set(id, kind);
    try {
      this.assertAdmissionOpen();
    } catch (error) {
      this.leases.delete(id);
      throw error;
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.leases.delete(id);
    };
  }

  acquireFence(transaction: string): void {
    if (!safeTransaction(transaction)) throw new TypeError("Invalid update transaction");
    if (!this.directory || !this.marker) throw new UpdateAdmissionError("Engine update admission control is not configured");
    try {
      privateDirectory(this.directory);
      const existing = this.readMarker();
      if (existing.state === "invalid") throw new UpdateAdmissionError("Engine update admission control is unreadable or corrupt");
      if (existing.marker) {
        if (existing.marker.transaction !== transaction) throw new UpdateAdmissionError("Engine fence belongs to another transaction");
        return;
      }
      const fd = fs.openSync(this.marker, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0), 0o600);
      try {
        fs.writeFileSync(fd, JSON.stringify({ schema: 1, transaction }) + "\n", { encoding: "utf8" });
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      fsyncDirectory(this.directory);
    } catch (error) {
      if (error instanceof UpdateAdmissionError) throw error;
      if ((error as any)?.code === "EEXIST") {
        const current = this.readMarker();
        if (current.state === "present" && current.marker?.transaction === transaction) return;
        if (current.state === "invalid") throw new UpdateAdmissionError("Engine update admission control is unreadable or corrupt");
        throw new UpdateAdmissionError("Engine fence belongs to another transaction");
      }
      throw new UpdateAdmissionError("Engine update admission fence could not be written");
    }
  }

  releaseFence(transaction: string): void {
    if (!safeTransaction(transaction)) throw new TypeError("Invalid update transaction");
    if (!this.marker) return;
    const existing = this.readMarker();
    if (existing.state === "disabled" || existing.state === "absent") return;
    if (existing.state === "invalid") throw new UpdateAdmissionError("Engine update admission control is unreadable or corrupt");
    if (existing.marker?.transaction !== transaction) throw new UpdateAdmissionError("Engine fence belongs to another transaction");
    fs.unlinkSync(this.marker);
    if (this.directory) fsyncDirectory(this.directory);
  }
}

export function releaseLeaseWhenResponseCompletes(
  response: express.Response,
  release: () => void,
): void {
  response.once("finish", release);
  const originalEnd = response.end.bind(response);
  (response as any).end = (...args: any[]) => {
    const result = originalEnd(...args);
    release();
    return result;
  };
}

export function registerUpdateAdmissionRoute(
  app: express.Express,
  admission: UpdateAdmission,
  authenticate: (req: express.Request, res: express.Response) => boolean,
): void {
  app.get("/internal/update/admission", (req, res) => {
    if (!authenticate(req, res)) return;
    res.json(admission.status());
  });
}

export function registerExternalAdmissionMiddleware(
  app: express.Express,
  admission: UpdateAdmission,
  authenticate: (req: express.Request, res: express.Response) => boolean,
): void {
  app.use([...EXTERNAL_ADMISSION_PATHS], (req, res, next) => {
    if (!authenticate(req, res)) return;
    let release: (() => void) | undefined;
    try {
      release = admission.beginLease("external", `${req.method}:${req.path}`);
    } catch (_error) {
      return res.status(503).json({
        error: {
          error_code: "ENGINE_UPDATE_ADMISSION_BLOCKED",
          message: "El Engine está cerrado para actualizaciones.",
        },
      });
    }
    releaseLeaseWhenResponseCompletes(res, () => release?.());
    return next();
  });
}
