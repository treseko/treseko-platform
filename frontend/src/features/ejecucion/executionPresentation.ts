export type ExecutionMode = 'manual' | 'automated' | 'ia'
export type FeedbackVariant = 'success' | 'danger' | 'warning' | 'info'

export const createIaLog = (level: string, message: string, extra: Record<string, any> = {}) => ({
  ts: new Date().toISOString(),
  level,
  source: String(level).toUpperCase(),
  message,
  ...extra,
})
