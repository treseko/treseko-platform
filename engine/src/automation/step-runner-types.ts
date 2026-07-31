import type { ExecutionCheckpoint, StepRunResult, StructuredHistoryItem } from './action-types.ts'

export interface StepRunnerOptions {
  executionId: string
  task: string
  expected?: string
  maxAttempts?: number
  agentWorkflow?: any[]
  contextData?: Record<string, any>
  emit?: (event: string, data: any) => void
  logger?: { log: (source: string, level: string, message: string, details?: Record<string, unknown>) => void }
}

export interface RunStepsResult {
  steps: StepRunResult[]
  history: StructuredHistoryItem[]
  visited_urls: string[]
  errors: string[]
  checkpoints: ExecutionCheckpoint[]
}
