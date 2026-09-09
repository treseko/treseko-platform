export function createTraceRuntime({ fs, path, repoRoot, enabled = false } = {}) {
  const traceEnabled = Boolean(enabled);
  const secretKey = /(authorization|api[_-]?key|cookie|password|refresh[_-]?token|secret|token|credential|private[_-]?key|state_updates|shared_variables|persistent_variables)/i;
  const secretText = /(authorization|api[_-]?key|cookie|password|refresh[_-]?token|secret|[a-z0-9_-]*token|credential|private[_-]?key|key)(\s*[:=]\s*)(bearer\s+)?[^\s&,'"}]+/gi;
  const secretJsonText = /(["'](?:authorization|api[_-]?key|cookie|password|refresh[_-]?token|secret|[a-z0-9_-]*token|credential|private[_-]?key|state_updates|shared_variables|persistent_variables)["']\s*:\s*)("(?:\\.|[^"\\])*"|[^,}\s]+)/gi;

  function redactTraceText(value) {
    return String(value)
      .replace(secretJsonText, (_match, key) => `${key}"[redacted]"`)
      .replace(secretText, (_match, key, separator) => `${key}${separator}[redacted]`);
  }

  function safeTraceValue(value, depth = 0) {
    if (depth > 8) return "[max-depth]";
    if (value == null || typeof value === "number" || typeof value === "boolean") return value;
    if (typeof value === "string") {
      const redacted = redactTraceText(value);
      return redacted.length > 2000 ? `${redacted.slice(0, 2000)}…` : redacted;
    }
    if (Array.isArray(value)) return value.slice(0, 50).map(item => safeTraceValue(item, depth + 1));
    if (typeof value === "object") return Object.fromEntries(Object.entries(value).slice(0, 100).map(([key, item]) => [
      key,
      secretKey.test(key) ? "[redacted]" : safeTraceValue(item, depth + 1),
    ]));
    return String(value);
  }

  function traceEntry(event, payload = {}) {
    if (!traceEnabled) return;
    const dir = path.join(repoRoot, "logs", "test-trace");
    fs.mkdirSync(dir, { recursive: true });
    const day = new Date().toISOString().slice(0, 10);
    const entry = { ts: new Date().toISOString(), source: "automation-worker", event, ...payload };
    fs.appendFileSync(path.join(dir, `automation-worker-${day}.jsonl`), `${JSON.stringify(safeTraceValue(entry))}\n`, "utf8");
  }

  function formatLogArg(arg) {
    if (typeof arg === "string") return redactTraceText(arg);
    if (arg instanceof Error) return redactTraceText(arg.message || String(arg));
    try { return JSON.stringify(safeTraceValue(arg)); } catch { return redactTraceText(String(arg)); }
  }

  return { redactTraceText, safeTraceValue, traceEntry, formatLogArg };
}
