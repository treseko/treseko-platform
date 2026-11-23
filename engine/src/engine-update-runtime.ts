import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { Express } from "express";
import { UpdateAdmission, registerExternalAdmissionMiddleware, registerUpdateAdmissionRoute } from "./update-admission.ts";
import { createEngineSelfUpdater } from "../engine-self-update.mjs";

export function createEngineUpdateRuntime({
  rootDir,
  app,
  internalToken,
  backendWsUrl,
  protectedRoute,
  shutdown,
}: {
  rootDir: string;
  app: Express;
  internalToken: string;
  backendWsUrl: string;
  protectedRoute: (req: import("express").Request, res: import("express").Response) => boolean;
  shutdown: (transaction: string | null) => Promise<void>;
}) {
  const controlDir = process.env.TRESEKO_ENGINE_UPDATE_CONTROL_DIR || path.join(rootDir, "update-control");
  fs.mkdirSync(controlDir, { recursive: true, mode: 0o700 });
  const controlStat = fs.lstatSync(controlDir);
  if (!controlStat.isDirectory() || controlStat.isSymbolicLink()) {
    throw new Error("Engine update-control directory is not a private directory");
  }
  if (typeof process.getuid === "function" && controlStat.uid !== process.getuid()) {
    throw new Error("Engine update-control directory has the wrong owner");
  }
  if ((controlStat.mode & 0o077) !== 0) fs.chmodSync(controlDir, 0o700);
  process.env.TRESEKO_ENGINE_UPDATE_CONTROL_DIR = controlDir;

  const updateAdmission = new UpdateAdmission(controlDir);
  registerExternalAdmissionMiddleware(app, updateAdmission, protectedRoute);
  registerUpdateAdmissionRoute(app, updateAdmission, protectedRoute);
  const engineSelfUpdater = createEngineSelfUpdater({
    fs,
    path,
    spawnSync,
    process,
    rootDir,
    admission: updateAdmission,
    backendWsUrl,
    token: internalToken,
    pollIntervalMs: Number(process.env.TRESEKO_ENGINE_UPDATE_POLL_MS || 60_000),
    restart: shutdown,
  });
  return { updateAdmission, engineSelfUpdater };
}

export function createEngineShutdown({ driver, io, updateAdmission }: {
  driver: { shutdown: () => Promise<void> };
  io: { disconnectSockets: (close: boolean) => void; close: (callback: () => void) => void };
  updateAdmission: UpdateAdmission;
}) {
  return async (exitCode = 0, transaction: string | null = null) => {
    await driver.shutdown();
    io.disconnectSockets(true);
    io.close(() => {
      if (transaction) {
        try { updateAdmission.releaseFence(transaction); }
        catch (error) { console.error("No se pudo liberar el fence de autoactualizacion del Engine:", error); }
      }
      process.exit(exitCode);
    });
  };
}

export function startDeferredUpdateRestart({ rootDir, isBusy, shutdown }: {
  rootDir: string;
  isBusy: () => boolean;
  shutdown: () => Promise<void>;
}) {
  const restartMarker = path.join(rootDir, ".treseko-update-restart");
  const rollbackMarker = path.join(rootDir, ".treseko-update-rollback");
  setInterval(() => {
    if (fs.existsSync(rollbackMarker) || !fs.existsSync(restartMarker) || isBusy()) return;
    try {
      fs.unlinkSync(restartMarker);
      console.info("Update de Engine preparado; reiniciando sin ejecuciones activas.");
      void shutdown();
    } catch (error) {
      console.error("No se pudo aplicar el reinicio diferido del Engine:", error);
    }
  }, 2_000).unref();
}
