export function isClaimConflict(error) {
  const status = Number(error?.http_status || error?.status || String(error?.error_code || "").match(/^HTTP_(\d+)$/)?.[1] || 0);
  return status === 409 || /tomado por otro|otro worker|otro runner|claim.*conflict|ya fue reclamado/i.test(String(error?.message || ""));
}

export function claimConflictMessage(jobId) {
  return `El job ${jobId} fue tomado por otro worker; se volverá a consultar la cola.`;
}
