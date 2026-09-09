export function buildHeartbeatPayload({
  status,
  capabilities,
  resources,
  activeJobs,
  currentJobId,
  leaseToken,
  uptimeSeconds,
} = {}) {
  return {
    estado: status,
    capabilities,
    resources,
    active_jobs: activeJobs,
    current_job_id: currentJobId || null,
    ...(currentJobId && leaseToken ? { lease_token: leaseToken } : {}),
    uptime_seconds: uptimeSeconds,
  };
}
