import postmanRuntime from "postman-runtime";
import postmanCollection from "postman-collection";

const { Collection, VariableScope } = postmanCollection;

const MAX_ITEMS = 500;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

function asValues(values) {
  if (Array.isArray(values)) return values;
  return Object.entries(values || {}).map(([key, value]) => ({ key, value }));
}

function scope(values, name) {
  return new VariableScope({ name, values: asValues(values) });
}

function itemCount(items = []) {
  return items.reduce((total, item) => total + (Array.isArray(item?.item) ? itemCount(item.item) : 1), 0);
}

function rawUrl(request) {
  if (!request) return "";
  if (typeof request.url === "string") return request.url;
  if (request.url?.toString) return request.url.toString();
  return request.url?.raw || "";
}

function hostAllowed(urlValue, allowedHosts) {
  let parsed;
  try {
    parsed = new URL(String(urlValue));
  } catch {
    throw new Error(`URL inválida para el runtime Postman: ${String(urlValue).slice(0, 300)}`);
  }
  if (!/^https?:$/.test(parsed.protocol)) throw new Error(`Protocolo no permitido: ${parsed.protocol}`);
  const host = parsed.hostname.toLowerCase();
  const allowed = new Set((allowedHosts || []).map(value => String(value).toLowerCase().replace(/^https?:\/\//, "").split("/")[0]));
  if (!allowed.size || !(allowed.has(host) || [...allowed].some(value => value.startsWith("*.") && host.endsWith(value.slice(1))))) {
    throw new Error(`El destino ${host} no está incluido en la allowlist del ambiente`);
  }
  return parsed;
}

function safeText(value) {
  return String(value ?? "").replace(/(authorization|cookie|token|password|secret|api[-_]?key)(\s*[:=]\s*)([^\s,;]+)/gi, "$1$2[REDACTED]").slice(0, 4000);
}

function safeRequest(request) {
  return { method: request?.method, url: safeText(rawUrl(request)) };
}

function validateCollectionRequests(items, values, allowedHosts) {
  for (const item of items || []) {
    if (Array.isArray(item?.item)) {
      validateCollectionRequests(item.item, values, allowedHosts);
      continue;
    }
    if (!item?.request) continue;
    const original = rawUrl(item.request);
    const resolved = original.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (match, key) => {
      const value = values.find(scopeValues => Object.prototype.hasOwnProperty.call(scopeValues, key))?.[key];
      return value === undefined ? match : String(value);
    });
    if (/\{\{/.test(resolved)) throw new Error(`La request ${item.name || "sin nombre"} tiene una URL sin resolver`);
    hostAllowed(resolved, allowedHosts);
  }
}

/**
 * Execute a Postman collection only inside the worker process.
 *
 * The worker is the explicit feature gate for this runtime. The declarative
 * backend runner remains the default path; this adapter is never selected by
 * imported cases unless a job explicitly requests `framework=postman`.
 */
export function runPostmanCollection({
  collection,
  environment = {},
  globals = {},
  localVariables = {},
  iterationData = [],
  allowedHosts = [],
  timeoutMs = 300000,
  maxItems = MAX_ITEMS,
} = {}) {
  if (!collection || typeof collection !== "object") throw new Error("El job Postman no incluye una colección válida");
  const items = collection.item || [];
  const count = itemCount(items);
  if (count < 1) throw new Error("La colección Postman no contiene requests");
  if (count > Math.min(MAX_ITEMS, Number(maxItems) || MAX_ITEMS)) throw new Error(`La colección supera el límite de ${MAX_ITEMS} requests`);
  if (!Array.isArray(allowedHosts) || allowedHosts.length === 0) throw new Error("El runtime Postman requiere una allowlist de hosts del ambiente");
  const environmentValues = Object.fromEntries(asValues(environment).map(item => [item.key, item.value]));
  const globalsValues = Object.fromEntries(asValues(globals).map(item => [item.key, item.value]));
  const localValues = Object.fromEntries(asValues(localVariables).map(item => [item.key, item.value]));
  validateCollectionRequests(items, [localValues, environmentValues, globalsValues], allowedHosts);

  const events = [];
  const assertions = [];
  const requests = [];
  const started = Date.now();
  const runner = new postmanRuntime.Runner();
  const collectionObject = new Collection(collection);
  const options = {
    data: Array.isArray(iterationData) ? iterationData : [iterationData],
    environment: scope(environment, "environment"),
    globals: scope(globals, "globals"),
    localVariables: scope(localVariables, "local"),
    iterationCount: 1,
    stopOnError: false,
    stopOnFailure: false,
    timeout: { request: Math.min(Number(timeoutMs) || 300000, 120000), script: 5000 },
    requester: {
      followRedirects: false,
      maxRedirects: 0,
      maxResponseSize: MAX_RESPONSE_BYTES,
      strictSSL: true,
      disableCookies: false,
      timings: true,
    },
    script: {
      packageResolver: ({ packages } = {}, callback) => {
        if (packages && Object.keys(packages).length > 0) {
          return callback(new Error("Los paquetes externos no están disponibles en el runtime Postman de Treseko"));
        }
        return callback(null, {});
      },
    },
  };

  return new Promise((resolve, reject) => {
    let timer = setTimeout(() => reject(new Error("La ejecución Postman superó el tiempo máximo permitido")), Math.max(1000, Number(timeoutMs) || 300000));
    const finish = (error) => {
      clearTimeout(timer);
      if (error) {
        const failure = error;
        return reject(failure instanceof Error ? failure : new Error(`El runtime Postman reportó un error: ${safeText(JSON.stringify(failure))}`));
      }
      const failed = assertions.some(item => item.status === "FAILED");
      resolve({
        status: failed ? "FAILED" : "PASSED",
        duration_ms: Date.now() - started,
        requests,
        assertions,
        events,
        runtime: "postman-runtime",
        runtime_version: "7.56.1",
        allowlist_hosts: [...allowedHosts],
        items_total: count,
      });
    };
    runner.run(collectionObject, options, (error, run) => {
      if (error) return finish(error);
      run.start({
        beforeRequest: (_error, _cursor, request) => {
          if (_error) throw _error;
          hostAllowed(rawUrl(request), allowedHosts);
          events.push({ type: "before_request", request: safeRequest(request) });
        },
        request: (_error, _cursor, response, request) => {
          if (_error) events.push({ type: "request_error", error: safeText(_error.message || _error), request: safeRequest(request) });
          requests.push({
            request: safeRequest(request),
            status: response?.code ?? null,
            response_time_ms: response?.responseTime ?? null,
            response_size_bytes: response?.responseSize ?? null,
          });
        },
        assertion: (_cursor, values) => {
          for (const value of values || []) assertions.push({ name: value.name || "Postman assertion", status: value.error ? "FAILED" : "PASSED", error: value.error ? safeText(value.error.message || value.error) : null });
        },
        test: (_error, _cursor, results) => {
          for (const result of results || []) {
            for (const [name, passed] of Object.entries(result?.result?.tests || {})) assertions.push({ name, status: passed ? "PASSED" : "FAILED", error: passed ? null : "La prueba Postman no se cumplió" });
          }
        },
        console: (_cursor, level, ...args) => events.push({ type: "console", level, message: safeText(args.join(" ")) }),
        exception: (_cursor, error) => events.push({ type: "exception", error: safeText(error?.message || error) }),
        done: finish,
      });
    });
  });
}

export async function executePostmanRuntimeJob({ job, runnerName = "Postman Runtime Worker" } = {}) {
  const payload = job?.payload_congelado || {};
  const result = await runPostmanCollection({
    collection: payload.collection || payload.postman_collection,
    environment: payload.environment || {},
    globals: payload.globals || {},
    localVariables: payload.local_variables || payload.variables || {},
    iterationData: payload.iteration_data || [],
    allowedHosts: payload.allowed_hosts || payload.environment?.allowed_hosts || [],
    timeoutMs: Math.max(1000, Number(job?.timeout_seconds || payload.timeout_seconds || 300) * 1000),
    maxItems: payload.max_items,
  });
  return {
    ...result,
    observations: "Colección Postman ejecutada por el runtime aislado del worker.",
    metadata: { worker: runnerName, framework: "postman", script_runtime: "postman-runtime", allowlist_hosts: result.allowlist_hosts },
    steps: result.requests.map((request, index) => ({ index: index + 1, status: request.status >= 200 && request.status < 400 ? "PASSED" : "FAILED", ...request })),
  };
}
