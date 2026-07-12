export type RealtimeConnectionStatus = 'disabled' | 'connecting' | 'connected' | 'reconnecting' | 'polling'

export type RealtimeEvent = {
  event_id?: string
  event_type: string
  project_id?: string | null
  component_id?: string | null
  build_id?: string | null
  suite_id?: string | null
  case_id?: string | null
  run_id?: string | null
  execution_id?: string | null
  bug_id?: string | null
  actor_id?: string | null
  timestamp?: string
  payload?: Record<string, any>
}
