export function createApiRuntime(deps) {
  const {
    API_BASE, REQUEST_TIMEOUT_MS, RUNNER_NAME, ORGANIZACION_ID, tokenPath, state,
    capabilities, isInvalidRunnerTokenError, clearRunnerCredentials, saveTokenFile,
    traceEntry, traceRequestId, errorFromResponse, safeJsonParse, sleep, performance,
  } = deps;

async function fetchJson(url, options = {}) {
  const requestId = options.requestId || traceRequestId();
  const correlationId = options.correlationId || options.headers?.["X-Correlation-ID"] || options.headers?.["x-correlation-id"] || requestId;
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  traceEntry("http_request", {
    request_id: requestId,
    correlation_id: correlationId,
    method: options.method || "GET",
    url,
    headers: options.headers || {},
    body: safeJsonParse(options.body),
  });
  try {
    const response = await fetch(url, { ...options, headers: { ...(options.headers || {}), "X-Correlation-ID": correlationId }, signal: controller.signal });
    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch (_error) {
        const invalidResponse = new Error("El servicio devolvió una respuesta inválida.");
        invalidResponse.error_code = "UPSTREAM_INVALID_RESPONSE";
        invalidResponse.correlation_id = response.headers.get("x-correlation-id") || correlationId;
        invalidResponse.retryable = true;
        throw invalidResponse;
      }
    }
    traceEntry("http_response", {
      request_id: requestId,
      correlation_id: correlationId,
      method: options.method || "GET",
      url,
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: safeJsonParse(options.body),
      response_body: data ?? text,
      duration_ms: Math.round((performance.now() - started) * 100) / 100,
    });
    if (!response.ok) {
      throw errorFromResponse(data, text, response.status, response.headers.get("x-correlation-id") || correlationId);
    }
    return data;
  } catch (error) {
    traceEntry("error", {
      request_id: requestId,
      correlation_id: error?.correlation_id || correlationId,
      method: options.method || "GET",
      url,
      headers: options.headers || {},
      body: safeJsonParse(options.body),
      duration_ms: Math.round((performance.now() - started) * 100) / 100,
      error: { message: error?.message || String(error), stack: error?.stack },
    });
    if (error?.name === "AbortError") {
      const timeoutError = new Error("Tiempo de espera agotado al comunicarse con Treseko.");
      timeoutError.error_code = "UPSTREAM_TIMEOUT";
      timeoutError.correlation_id = correlationId;
      timeoutError.retryable = true;
      throw timeoutError;
    }
    if (!error?.error_code && (error?.name === "TypeError" || error?.code === "ECONNREFUSED" || error?.code === "ENOTFOUND")) {
      error.error_code = "UPSTREAM_UNAVAILABLE";
      error.correlation_id = error.correlation_id || correlationId;
      error.retryable = true;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function api(pathname, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(state.runnerToken ? { "X-Runner-Token": state.runnerToken } : {}),
    ...(options.headers || {}),
  };
  return fetchJson(`${API_BASE}${pathname}`, { ...options, correlationId: options.correlationId || state.activeCorrelationId, headers });
}

async function registerIfNeeded() {
  if (state.runnerToken) {
    try {
      const me = await api("/automation-runners/me");
      state.runnerId = me.id;
      return;
    } catch (error) {
      if (!isInvalidRunnerTokenError(error)) throw error;
      console.warn("Runner token rechazado; se limpia la credencial local y se inicia recuperación.");
      clearRunnerCredentials();
    }
  }

  const registrationToken = process.env.QA_REGISTRATION_TOKEN || "";
  if (!registrationToken || registrationToken.includes("paste_registration_token_here")) {
    await pairWithPlatform();
    return;
  }

  const registerUrl = `${API_BASE}/automation-runners/register`;
  const registerBody = {
    registration_token: registrationToken,
    nombre: RUNNER_NAME,
    tipo: "LOCAL",
    capabilities: capabilities(),
  };
  const registerRequestId = traceRequestId();
  const registerStarted = performance.now();
  traceEntry("http_request", {
    request_id: registerRequestId,
    method: "POST",
    url: registerUrl,
    headers: { "Content-Type": "application/json", "X-Correlation-ID": state.activeCorrelationId || registerRequestId },
    body: registerBody,
  });
  const created = await fetch(registerUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Correlation-ID": state.activeCorrelationId || registerRequestId },
    body: JSON.stringify(registerBody),
  }).then(async (response) => {
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    traceEntry("http_response", {
      request_id: registerRequestId,
      method: "POST",
      url: registerUrl,
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: registerBody,
      response_body: data ?? text,
      duration_ms: Math.round((performance.now() - registerStarted) * 100) / 100,
    });
    if (!response.ok) throw errorFromResponse(data, text, response.status, response.headers.get("x-correlation-id") || state.activeCorrelationId || registerRequestId);
    return data;
  });

  state.runnerToken = created.runner_token;
  state.runnerId = created.id;
  saveTokenFile(state.runnerToken);
  console.log(`Worker vinculado como ${created.nombre}. Token guardado en ${tokenPath}`);
}

async function pairWithPlatform() {
  while (!state.runnerToken) {
    console.log(`Solicitando vinculacion a ${API_BASE}...`);
    const request = await createPairingRequest();
    const expiresAt = new Date(request.expires_at).getTime();
    console.log("");
    console.log(`Worker esperando vinculacion. Codigo: ${request.code}.`);
    console.log(`Apruebalo en Automatizacion > Workers. Expira: ${new Date(request.expires_at).toLocaleString()}.`);

    while (Date.now() < expiresAt && !state.runnerToken) {
      await sleep(3000);
      const status = await fetchJson(`${API_BASE}/automation-runners/pairing-requests/${encodeURIComponent(request.code)}`, {
        headers: {
          "Content-Type": "application/json",
          "X-Pairing-Token": request.pairing_token,
        },
      });

      if (status.estado === "APPROVED" && status.runner_token) {
        state.runnerToken = status.runner_token;
        state.runnerId = status.runner?.id || "";
        saveTokenFile(state.runnerToken);
        console.log(`Worker vinculado como ${status.runner?.nombre || RUNNER_NAME}. Token guardado en ${tokenPath}`);
        return;
      }

      if (status.estado === "DENIED") {
        console.log("Solicitud rechazada. Se generara un nuevo codigo en unos segundos.");
        break;
      }

      if (status.estado === "EXPIRED") {
        console.log("Solicitud expirada. Se generara un nuevo codigo.");
        break;
      }
    }
  }
}

async function createPairingRequest() {
  return fetchJson(`${API_BASE}/automation-runners/pairing-requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      nombre: RUNNER_NAME,
      tipo: "LOCAL",
      organizacion_id: ORGANIZACION_ID || null,
      capabilities: capabilities(),
      // The code is still single-use and protected by its pairing token. A
      // two-hour window gives the operator enough time to approve it in UI.
      ttl_minutes: 120,
    }),
  });
}

  return { fetchJson, api, registerIfNeeded, pairWithPlatform, createPairingRequest };
}
