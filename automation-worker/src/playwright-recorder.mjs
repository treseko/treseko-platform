import path from "node:path";
import os from "node:os";

export function sanitizeRecordedPlaywrightScript(source) {
  let script = String(source || "").replace(/\u0000/g, "");
  script = script.replace(
    /(\.(?:fill|pressSequentially|type|selectOption|setInputFiles)\s*\(\s*)(['"])(?:\\.|(?!\2)[\s\S])*?\2/g,
    (_match, prefix) => `${prefix}''`,
  );
  script = script.replace(
    /(\bpage\.goto\s*\(\s*)(['"])(?:\\.|[^\\])*?\2/,
    (_match, prefix) => `${prefix}variables.base_url`,
  );
  script = script.replace(
    /(\bpage\.goto\s*\(\s*)(['"])(https?:\/\/[^'"]+)\2/g,
    (_match, prefix, quote, rawUrl) => {
      try {
        const cleanUrl = new URL(rawUrl);
        cleanUrl.username = "";
        cleanUrl.password = "";
        cleanUrl.search = "";
        cleanUrl.hash = "";
        return `${prefix}${quote}${cleanUrl.toString()}${quote}`;
      } catch {
        return `${prefix}${quote}${rawUrl.split(/[?#]/, 1)[0]}${quote}`;
      }
    },
  );
  return script.trim();
}

export function hasRecordedPlaywrightAction(source) {
  const script = String(source || "");
  // Codegen always writes a test wrapper and a page.goto() even when the user
  // did not interact with the target. Do not treat that navigation scaffold as
  // a usable recording.
  return /\.(?:click|dblclick|fill|clear|check|uncheck|selectOption|setInputFiles|press|pressSequentially|type|hover|focus|tap|dragTo|scrollIntoViewIfNeeded|dispatchEvent)\s*\(/.test(script);
}

export function createPlaywrightRecorder({ fs, spawn, cliPath, api, sleep, now = Date.now }) {
  return async function record(job, { signal } = {}) {
    const payload = job.payload_congelado || {};
    const targetUrl = String(payload.url || "");
    if (!/^https?:\/\//i.test(targetUrl)) {
      return { status: "BLOCKED", observations: "El ambiente no tiene una URL web válida.", error_message: "El Worker rechazó la URL configurada para el ambiente." };
    }

    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "treseko-playwright-recorder-"));
    try { fs.chmodSync(workspace, 0o700); } catch {}
    const outputPath = path.join(workspace, "recorded.spec.js");
    const startedAt = now();
    let child;
    let closeResolve;
    const closed = new Promise(resolve => { closeResolve = resolve; });
    let closeResult = null;
    const finishClose = (result) => {
      if (closeResult) return;
      closeResult = result;
      closeResolve(result);
    };

    const stopChild = async () => {
      if (!child || closeResult) return;
      try { child.kill("SIGINT"); } catch {}
      await Promise.race([closed, sleep(5000)]);
      if (!closeResult) {
        try { child.kill("SIGTERM"); } catch {}
        await Promise.race([closed, sleep(2000)]);
      }
      if (!closeResult) {
        try { child.kill("SIGKILL"); } catch {}
        await Promise.race([closed, sleep(1000)]);
      }
    };

    try {
      child = spawn(process.execPath, [
        typeof cliPath === "function" ? cliPath() : cliPath,
        "codegen",
        "--browser=chromium",
        "--target=playwright-test",
        "--output",
        outputPath,
        targetUrl,
      ], { cwd: workspace, stdio: "ignore", windowsHide: false });
      child.once("error", error => finishClose({ code: -1, error }));
      child.once("close", (code, exitSignal) => finishClose({ code, signal: exitSignal }));

      const timeoutAt = startedAt + Math.min(30 * 60_000, Math.max(60_000, Number(job.timeout_seconds || 1800) * 1000));
      let action = "CONTINUE";
      while (!closeResult && now() < timeoutAt && !signal?.aborted) {
        const control = await api(`/automation-recordings/${job.id}/control`, {
          headers: { "X-Job-Lease-Token": job.lease_token },
        });
        action = String(control?.action || "CONTINUE").toUpperCase();
        if (action === "STOP" || action === "CANCEL") {
          await stopChild();
          break;
        }
        await Promise.race([closed, sleep(1200)]);
      }

      if (signal?.aborted || action === "CANCEL") {
        await stopChild();
        return {
          status: "CANCELLED",
          duration_seconds: Math.max(0, Math.round((now() - startedAt) / 1000)),
          observations: "La grabación se canceló.",
          metadata: {},
        };
      }
      if (!closeResult && now() >= timeoutAt) {
        await stopChild();
        return {
          status: "TIMEOUT",
          duration_seconds: Math.max(0, Math.round((now() - startedAt) / 1000)),
          error_message: "La grabación superó el límite de 30 minutos.",
          metadata: {},
        };
      }

      const rawScript = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, "utf8") : "";
      const recordedScript = sanitizeRecordedPlaywrightScript(rawScript);
      if (!recordedScript) {
        return {
          status: "ERROR",
          duration_seconds: Math.max(0, Math.round((now() - startedAt) / 1000)),
          error_message: "Playwright no generó un recorrido. Inicia el navegador, realiza algunos pasos y vuelve a finalizar.",
          metadata: {},
        };
      }
      if (!hasRecordedPlaywrightAction(recordedScript)) {
        return {
          status: "ERROR",
          duration_seconds: Math.max(0, Math.round((now() - startedAt) / 1000)),
          error_message: "No se detectaron interacciones en la grabación. Realiza al menos una acción en Chromium y finaliza desde Treseko para recibir el recorrido.",
          observations: "Codegen solo generó la navegación inicial; no hay pasos que reproducir.",
          metadata: {},
        };
      }
      if (recordedScript.length > 100_000) {
        return {
          status: "ERROR",
          duration_seconds: Math.max(0, Math.round((now() - startedAt) / 1000)),
          error_message: "El recorrido generado supera el límite permitido. Divídelo en casos más pequeños.",
          metadata: {},
        };
      }
      return {
        status: "PASSED",
        duration_seconds: Math.max(0, Math.round((now() - startedAt) / 1000)),
        observations: "Recorrido grabado. Los valores escritos fueron vaciados y deben revisarse antes de ejecutar.",
        metadata: { recorded_script: recordedScript },
      };
    } catch (_error) {
      await stopChild();
      return {
        status: "ERROR",
        duration_seconds: Math.max(0, Math.round((now() - startedAt) / 1000)),
        error_message: "No se pudo iniciar o completar Playwright Codegen en este Worker.",
        metadata: {},
      };
    } finally {
      await stopChild();
      try { fs.rmSync(workspace, { recursive: true, force: true }); } catch {}
    }
  };
}
