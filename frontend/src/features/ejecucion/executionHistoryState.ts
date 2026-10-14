export function hydrateExecutionHistory(test: any, history: any) {
  if (history?.error) return { ...test, historyError: history.error }
  const latest = history[0]
  return {
    ...test, historyError: null, history, historyTotal: history.total ?? history.length,
    historyStats: history.stats || null,
    lastResult: latest?.status || null, lastExecutedAt: latest?.date || null,
    lastExecutedBy: latest?.executedBy || null, lastExecutedVersion: latest?.versionExecuted || null,
  }
}
