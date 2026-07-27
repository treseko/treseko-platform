export type AgentDriverName = 'treseko_engine' | 'opencode';

export type AgentHealth = {
  status: 'ok' | 'blocked' | 'error';
  driver: AgentDriverName;
  detail?: string;
  version?: string;
  model?: string;
  latency_ms?: number;
};

export type StrictAIAction = {
  action: 'navigate' | 'click' | 'click_at' | 'type' | 'fill_form' | 'check' | 'select' | 'press' | 'wait' | 'assert_visible' | 'assert_text' | 'finish' | 'fail' | 'blocked';
  target_ref?: string;
  value?: string;
  reason?: string;
  expected?: string;
  confidence?: number;
  step_number?: number;
};

export type AgentRunInput = { runId: string; prompt: string; model?: string; agent?: string };
export type AgentTurnInput = { runId: string; prompt: string; stepNumber?: number };
export type AgentExecutionResult = { runId: string; ok: boolean; observation?: unknown; screenshotRef?: string };

export interface AgentDriver {
  health(): Promise<AgentHealth>;
  startRun(input: AgentRunInput): Promise<{ runId: string; sessionId: string }>;
  nextAction(input: AgentTurnInput): Promise<StrictAIAction>;
  sendExecutionResult(input: AgentExecutionResult): Promise<void>;
  cancelRun(runId: string): Promise<void>;
  closeRun(runId: string): Promise<void>;
}

export function isAllowedAIAction(value: unknown): value is StrictAIAction {
  if (!value || typeof value !== 'object') return false;
  const action = (value as any).action;
  return ['navigate', 'click', 'click_at', 'type', 'fill_form', 'check', 'select', 'press', 'wait', 'assert_visible', 'assert_text', 'finish', 'fail', 'blocked'].includes(action);
}

export class TresekoEngineDriver implements AgentDriver {
  async health(): Promise<AgentHealth> { return { status: 'ok', driver: 'treseko_engine' }; }
  async startRun(input: AgentRunInput) { return { runId: input.runId, sessionId: input.runId }; }
  async nextAction(): Promise<StrictAIAction> { throw new Error('TresekoEngineDriver uses the native run loop'); }
  async sendExecutionResult(): Promise<void> { /* native run loop owns execution */ }
  async cancelRun(): Promise<void> { /* native run loop owns cancellation */ }
  async closeRun(): Promise<void> { /* native run loop owns cleanup */ }
}
