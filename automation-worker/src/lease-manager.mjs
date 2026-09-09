export function createLeaseHeartbeat({
  heartbeat,
  intervalMs = 10_000,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  log = () => {},
} = {}) {
  if (typeof heartbeat !== "function") throw new Error("Se requiere una función de heartbeat.");
  let timer = null;
  let stopped = false;
  let inFlight = false;

  async function tick() {
    if (stopped || inFlight) return;
    inFlight = true;
    try {
      await heartbeat();
    } catch (error) {
      const status = Number(error?.http_status || error?.status || 0);
      const temporaryHttpFailure = status >= 500 || [408, 425, 429].includes(status);
      if (status >= 400 && status < 500 && !temporaryHttpFailure) {
        log("lease_lost", "El lease del job fue rechazado; el resultado será validado por el backend.");
        stopped = true;
      } else {
        log("heartbeat_retry", "No se pudo renovar el lease; se reintentará en el próximo heartbeat.");
      }
    } finally {
      inFlight = false;
    }
  }

  function start() {
    stopped = false;
    if (timer) clearIntervalFn(timer);
    timer = setIntervalFn(() => { void tick(); }, Math.max(100, Number(intervalMs) || 10_000));
    if (typeof timer?.unref === "function") timer.unref();
    return { tick, stop };
  }

  function stop() {
    stopped = true;
    if (timer) clearIntervalFn(timer);
    timer = null;
  }

  return { start, stop, tick, isStopped: () => stopped };
}
