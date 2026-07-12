export type BackendStatus = 'PASO' | 'FALLO' | 'BLOQUEADO';

export type StrictActionName =
  | 'navigate'
  | 'click'
  | 'click_at'
  | 'type'
  | 'select'
  | 'press'
  | 'wait'
  | 'assert_visible'
  | 'assert_text'
  | 'finish'
  | 'fail'
  | 'blocked';

export interface QAEngineStep {
  number: number;
  action?: string;
  data?: string;
  expected?: string;
}

export interface BrowserElementSnapshot {
  ref: string;
  tag: string;
  role?: string;
  name?: string;
  text?: string;
  value?: string;
  type?: string;
  placeholder?: string;
  label?: string;
  title?: string;
  disabled: boolean;
  visible: boolean;
  editable: boolean;
  clickable: boolean;
  bbox?: { x: number; y: number; width: number; height: number };
}

export interface BrowserObservation {
  url: string;
  title: string;
  readyState: string;
  viewport?: { width: number; height: number };
  loadingSignals: string[];
  dialogs: string[];
  visibleText: string[];
  elements: BrowserElementSnapshot[];
  forms: Array<{ ref: string; fields: string[] }>;
}

export interface StrictAIAction {
  action: StrictActionName;
  target_ref?: string;
  x?: number;
  y?: number;
  value?: string;
  reason: string;
  expected?: string;
  confidence: number;
  step_number: number;
}

export interface ActionExecutionResult {
  ok: boolean;
  command: string;
  message: string;
  error?: string;
}

export interface StructuredHistoryItem {
  step_number: number;
  attempt: number;
  observation_before: Pick<BrowserObservation, 'url' | 'title' | 'readyState' | 'loadingSignals'>;
  action: StrictAIAction;
  execution: ActionExecutionResult;
  duration_ms: number;
  screenshot_base64?: string;
  metrics?: Record<string, unknown>;
  validation?: {
    ok: boolean;
    reason: string;
  };
  raw_ai_response?: unknown;
}

export interface StepRunResult {
  number: number;
  status: BackendStatus;
  observations?: string;
  error_log?: string;
  screenshot_base64?: string;
  history: StructuredHistoryItem[];
  confidence?: number;
  failure_category?: string;
}
