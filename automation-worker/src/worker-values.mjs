export function createWorkerValues({ HEADLESS, redactTraceText }) {
  function traceRequestId() {
    return `worker-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function safeJsonParse(text) {
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  function formatErrorDetail(detail) {
    if (!detail) return "";
    if (typeof detail === "string") return redactTraceText(detail);
    return JSON.stringify(detail);
  }

  function errorFromResponse(data, text, status, correlationId) {
    const publicError = data?.error && typeof data.error === "object" ? data.error : {};
    const error = new Error(formatErrorDetail(publicError.message || data?.detail || data?.error || text || `HTTP ${status}`));
    error.error_code = publicError.error_code || `HTTP_${status}`;
    error.correlation_id = publicError.correlation_id || correlationId;
    error.retryable = publicError.retryable;
    return error;
  }

  function isDebugMode(job) {
    const payload = job?.payload_congelado || {};
    return payload.debug_mode === true || payload.debug_mode === "true" || payload.debug === true || payload.debug === "true";
  }

  function shouldRunHeadless(job) {
    return HEADLESS && !isDebugMode(job);
  }

  return { traceRequestId, safeJsonParse, formatErrorDetail, errorFromResponse, isDebugMode, shouldRunHeadless };
}
