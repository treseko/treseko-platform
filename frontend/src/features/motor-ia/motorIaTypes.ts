export type MotorIaTranslator = (key: any, params?: Record<string, string | number>) => string

export type IaLogLevel = 'error' | 'warn' | 'engine' | 'ws' | 'run' | 'system' | 'queue' | 'info'
export type IaRunStatus = 'EN_ESPERA' | 'EN_EJECUCION' | 'PASO' | 'FALLO' | 'BLOQUEADO' | 'ERROR' | 'STREAM_CERRADO'

export type IaLogEntry = {
  ts: string
  level: IaLogLevel
  source?: string
  agent?: string
  message: string
  executionId?: string
  caseCode?: string
  step?: string | number
  attempt?: string | number
  confidence?: number
  reason?: string
  metrics?: Record<string, any>
}

export type IaExecutionStream = {
  executionId: string
  caseId: string
  runId?: string
  caseCode?: string
  caseTitle?: string
  runName?: string
  status?: IaRunStatus
  startedAt?: string
  endedAt?: string
  lastMessage?: string
  lastStep?: string | number
  confidence?: number
  consensus?: string
  humanReviewRequired?: boolean
}

export type IaQueueItem = {
  caseId: string
  executionId: string
  runId?: string
  caseCode: string
  caseTitle: string
  component: string
  runName?: string
  status: IaRunStatus
  startedAt?: string
  endedAt?: string
  lastMessage?: string
  lastStep?: string | number
  confidence?: number
  consensus?: string
  humanReviewRequired?: boolean
}

export type AiEngineHealthState = {
  status?: string
  detail?: string | null
  engine?: {
    status?: string
    service?: string
    version?: string
    engine?: {
      status?: string
      service?: string
      engine?: string
      version?: string
    }
    llm?: {
      endpoint?: string
      provider?: string
      model?: string
      status_code?: number
      model_response?: string | null
      requires_api_key?: boolean
      api_key_configured?: boolean
    }
  } | null
}
