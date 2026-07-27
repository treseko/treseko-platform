import type { AgentDriver, AgentHealth, AgentRunInput, AgentTurnInput, AgentExecutionResult, StrictAIAction } from './agent-driver.ts';
import { isAllowedAIAction } from './agent-driver.ts';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync } from 'node:fs';

export type OpenCodeOptions = { baseUrl?: string; username?: string; password?: string; apiKey?: string; provider?: string; model?: string; agent?: string; timeoutMs?: number; autoStart?: boolean };

export class OpenCodeDriver implements AgentDriver {
  private readonly options: Required<OpenCodeOptions>;
  private readonly sessions = new Map<string, string>();
  private static process?: ChildProcess;
  private static processKeyFingerprint = '';
  constructor(options: OpenCodeOptions = {}) {
    // Callers may pass an optional env-derived URL. Do not let an undefined
    // property overwrite the managed loopback default and crash the Engine.
    this.options = {
      baseUrl: options.baseUrl || 'http://127.0.0.1:4096',
      username: options.username || 'treseko', password: options.password || '',
      apiKey: options.apiKey || '', provider: options.provider || '', model: options.model || '',
      agent: options.agent || '', timeoutMs: options.timeoutMs || 30_000,
      autoStart: options.autoStart ?? true,
    };
  }
  private providerEnv(): Record<string, string> {
    const provider = String(this.options.provider || this.options.model.split('/')[0] || 'openai').toLowerCase().replace(/_/g, '-');
    const env: Record<string, string> = {};
    if (!this.options.apiKey) return env;
    // The OpenCode account key is process-only. Zen uses OPENCODE_API_KEY and
    // Go uses OPENCODE_GO_API_KEY; supplying the same account key lets
    // /config/providers report whichever catalog the account is authorized for.
    if (provider === 'opencode') return { OPENCODE_API_KEY: this.options.apiKey, OPENCODE_GO_API_KEY: this.options.apiKey };
    const names: Record<string, string> = { openai: 'OPENAI_API_KEY', 'openai-compatible': 'OPENAI_API_KEY', anthropic: 'ANTHROPIC_API_KEY', gemini: 'GEMINI_API_KEY', google: 'GOOGLE_GENERATIVE_AI_API_KEY', openrouter: 'OPENROUTER_API_KEY', deepseek: 'DEEPSEEK_API_KEY', groq: 'GROQ_API_KEY', mistral: 'MISTRAL_API_KEY', xai: 'XAI_API_KEY', 'opencode-go': 'OPENCODE_GO_API_KEY' };
    const name = names[provider];
    if (name) env[name] = this.options.apiKey;
    return env;
  }
  private publicCatalog(value: any): any {
    if (Array.isArray(value)) return value.map((item) => this.publicCatalog(item));
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !/(^|_)(api_?)?key$|token|secret|authorization|credential|password/i.test(key))
        .map(([key, item]) => [key, this.publicCatalog(item)]),
    );
  }
  private async startServer(): Promise<void> {
    if (!this.options.autoStart) return;
    const fingerprint = `${this.options.provider}:${this.options.apiKey || ''}`;
    if (OpenCodeDriver.process && !OpenCodeDriver.process.killed && OpenCodeDriver.processKeyFingerprint !== fingerprint) await OpenCodeDriver.shutdown();
    if (OpenCodeDriver.process && !OpenCodeDriver.process.killed) return;
    const url = new URL(this.options.baseUrl);
    const port = Number(url.port || 4096);
    const workdir = process.env.OPENCODE_WORKDIR || '/tmp/treseko-opencode';
    const configDir = `${workdir}/config`;
    const dataDir = `${workdir}/data`;
    const stateDir = `${workdir}/state`;
    mkdirSync(configDir, { recursive: true });
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(stateDir, { recursive: true });
    const child = spawn(process.env.OPENCODE_BIN || 'opencode', ['serve', '--hostname', '127.0.0.1', '--port', String(port), '--pure'], {
      cwd: workdir,
      // The Engine drops privileges before this child starts. Keep every
      // OpenCode runtime directory writable and ephemeral; credentials stay
      // only in this process environment and are never written to auth.json.
      env: {
        ...process.env,
        ...this.providerEnv(),
        HOME: workdir,
        XDG_CONFIG_HOME: configDir,
        XDG_DATA_HOME: dataDir,
        XDG_STATE_HOME: stateDir,
        OPENCODE_SERVER_PASSWORD: this.options.password || process.env.OPENCODE_SERVER_PASSWORD || '',
      },
      stdio: 'ignore',
    });
    OpenCodeDriver.process = child;
    OpenCodeDriver.processKeyFingerprint = fingerprint;
    child.once('exit', () => { if (OpenCodeDriver.process === child) { OpenCodeDriver.process = undefined; OpenCodeDriver.processKeyFingerprint = ''; } });
    await new Promise(resolve => setTimeout(resolve, 350));
  }
  async providers() {
    const health = await this.ensureAvailable();
    if (health.status !== 'ok') throw new Error(health.detail || 'OpenCode no disponible');
    const response = await this.request('/config/providers');
    const data: any = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`OpenCode catálogo falló (${response.status})`);
    // /config/providers can include the resolved provider key. It must never
    // leave the Engine, even though the request itself is internal.
    return this.publicCatalog(data);
  }
  async ensureAvailable(): Promise<AgentHealth> { let health = await this.health(); if (health.status === 'ok') return health; await this.startServer(); for (let attempt = 0; attempt < 60; attempt += 1) { health = await this.health(); if (health.status === 'ok') return health; await new Promise(resolve => setTimeout(resolve, 250)); } return health; }
  private headers() { const headers: Record<string, string> = { 'content-type': 'application/json' }; if (this.options.password) headers.authorization = `Basic ${Buffer.from(`${this.options.username}:${this.options.password}`).toString('base64')}`; return headers; }
  private async request(path: string, init: RequestInit = {}) { return fetch(`${this.options.baseUrl}${path}`, { ...init, headers: { ...this.headers(), ...(init.headers || {}) }, signal: AbortSignal.timeout(this.options.timeoutMs) }); }
  async health(): Promise<AgentHealth> {
    const started = Date.now();
    try { const response = await this.request('/global/health'); if (!response.ok) return { status: 'error', driver: 'opencode', detail: `OpenCode respondió HTTP ${response.status}`, latency_ms: Date.now() - started }; const data: any = await response.json(); return { status: 'ok', driver: 'opencode', version: data.version, model: this.options.model, latency_ms: Date.now() - started }; }
    catch (error: any) { return { status: 'blocked', driver: 'opencode', detail: `OpenCode no disponible: ${error?.message || String(error)}`, latency_ms: Date.now() - started }; }
  }
  static async shutdown(): Promise<void> { const child = OpenCodeDriver.process; OpenCodeDriver.process = undefined; if (!child || child.killed) return; child.kill('SIGTERM'); await new Promise(resolve => setTimeout(resolve, 250)); if (!child.killed) child.kill('SIGKILL'); }
  async startRun(input: AgentRunInput) { const response = await this.request('/session', { method: 'POST', body: JSON.stringify({ title: `Treseko ${input.runId}` }) }); if (!response.ok) throw new Error(`OpenCode no pudo crear sesión (${response.status})`); const data: any = await response.json(); const sessionId = data.id || data.sessionID; if (!sessionId) throw new Error('OpenCode devolvió una sesión inválida'); this.sessions.set(input.runId, sessionId); return { runId: input.runId, sessionId }; }
  async nextAction(input: AgentTurnInput): Promise<StrictAIAction> { const sessionId = this.sessions.get(input.runId); if (!sessionId) throw new Error('RUN_NOT_STARTED'); const [providerID, ...modelParts] = this.options.model.split('/'); const model = providerID && modelParts.length ? { providerID, modelID: modelParts.join('/') } : undefined; const response = await this.request(`/session/${encodeURIComponent(sessionId)}/message`, { method: 'POST', body: JSON.stringify({ model, agent: this.options.agent || undefined, parts: [{ type: 'text', text: `${input.prompt}\nDevuelve únicamente JSON con una acción permitida de Treseko.` }] }) }); if (!response.ok) throw new Error(`OpenCode mensaje falló (${response.status})`); const data: any = await response.json(); const text = data?.parts?.find((part: any) => part.type === 'text')?.text || data?.text || data?.content || ''; let parsed: any; try { parsed = typeof text === 'string' ? JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || text) : text; } catch { throw new Error('OPENCODE_INVALID_JSON'); } if (!isAllowedAIAction(parsed)) throw new Error('OPENCODE_ACTION_NOT_ALLOWED'); return { ...parsed, step_number: input.stepNumber || parsed.step_number, reason: String(parsed.reason || 'Decisión OpenCode'), confidence: Number(parsed.confidence ?? 0) } as StrictAIAction; }
  async sendExecutionResult(input: AgentExecutionResult) { const sessionId = this.sessions.get(input.runId); if (!sessionId) return; await this.request(`/session/${encodeURIComponent(sessionId)}/message`, { method: 'POST', body: JSON.stringify({ parts: [{ type: 'text', text: JSON.stringify({ execution_result: { ok: input.ok, observation: input.observation, screenshot_ref: input.screenshotRef } }) }] }) }); }
  async cancelRun(runId: string) { this.sessions.delete(runId); }
  async closeRun(runId: string) { const sessionId = this.sessions.get(runId); this.sessions.delete(runId); if (sessionId) await this.request(`/session/${encodeURIComponent(sessionId)}`, { method: 'DELETE' }).catch(() => undefined); }
}
