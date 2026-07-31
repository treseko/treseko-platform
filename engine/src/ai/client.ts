import dotenv from 'dotenv';
import { traceEntry, traceRequestId } from '../test-trace.ts';
import type { QAEngineStep, StrictAIAction, StructuredHistoryItem } from '../automation/action-types.ts';
import type { AuditDecision, AuditEvidenceBundle, AuditImage } from '../audit/consensus.ts';
import { generateWithProvider, normalizeProvider, ProviderRequestError } from './provider-adapters.ts';
import type { AgentDriver } from './agent-driver.ts';
import { parseAIJson } from './responseParsing.ts';
import { sendWithRetry } from './requestRetry.ts';
import { checkLoadingState, planStepAction } from './agentStepPlanning.ts';
dotenv.config({ override: false });
export interface AIAction {
  action: 'click' | 'double_click' | 'right_click' | 'hover' | 'type' | 'navigate' | 'wait' | 'finish' | 'error' | 'press_enter' | 'upload' | 'scroll' | 'drag_and_drop' | 'select' | 'press' | 'assert_visible' | 'assert_text' | 'fail' | 'blocked';
  elementId?: string;
  target_ref?: string;
  targetId?: string;
  text?: string;
  value?: string;
  url?: string;
  reason: string;
  expected_result?: string;
  expected?: string;
  dataUsed?: string;
  confidence: number;
  step_number?: number;
}
export interface AIResult<T> {
  data: T;
  metrics: {
    latencyMs: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    estimatedCost: number;
  };
  prompt: any;
  rawResponse: any;
}
export class AIClient {
  private provider: string;
  private endpoint: string;
  public model: string;
  private apiKey: string | undefined;
  private readonly fallbackConfigs: Array<{ provider: string; endpoint: string; model: string; apiKey?: string; maxRetries?: number }>;
  private readonly maxContext: number;
  private readonly temperature: number;
  private readonly maxRetries: number;
  private readonly retryTemperature: number;
  private readonly tokenCostPer1K: number;
  private readonly promptTokenCostPer1K: number;
  private readonly completionTokenCostPer1K: number;
  private readonly requestTimeoutMs: number;
  private readonly maxCompletionTokens: number;
  private readonly disableThinking: boolean;
  public readonly supportsVision: boolean;
  private readonly agentWorkflow: any[];
  private messageHistory: any[] = [];
  private readonly agentDriver?: AgentDriver;
  private readonly agentRunId?: string;
  constructor(config: { provider?: string; endpoint?: string; model?: string; apiKey?: string; temperature?: number; agentWorkflow?: any[]; tokenCostPer1K?: number; promptTokenCostPer1K?: number; completionTokenCostPer1K?: number; visionEnabled?: boolean; maxCompletionTokens?: number; disableThinking?: boolean; maxRetries?: number; fallbacks?: Array<{ provider?: string; llm_endpoint?: string; endpoint?: string; model?: string; provider_api_key?: string; apiKey?: string; max_retries?: number }>; agentDriver?: AgentDriver; agentRunId?: string } = {}) {
    this.provider = normalizeProvider(config.provider || process.env.AI_PROVIDER || 'openai-compatible');
    this.endpoint = config.endpoint || process.env.AI_API_ENDPOINT || 'http://172.16.10.4:1234/v1';
    this.model = config.model || process.env.AI_MODEL || 'google/gemma-4-e4b';
    this.apiKey = config.apiKey || resolveProviderApiKey(this.provider);
    this.fallbackConfigs = (config.fallbacks || []).map((item) => ({
      provider: normalizeProvider(item.provider || 'openai-compatible'),
      endpoint: item.llm_endpoint || item.endpoint || '',
      model: item.model || '',
      apiKey: item.provider_api_key || item.apiKey,
      maxRetries: item.max_retries,
    })).filter((item) => item.endpoint && item.model);
    this.maxContext = parseInt(process.env.AI_MAX_CONTEXT || '32768');
    this.temperature = Number.isFinite(config.temperature) ? Number(config.temperature) : parseFloat(process.env.AI_TEMPERATURE || '0.1');
    this.maxRetries = Number.isFinite(config.maxRetries)
      ? Math.max(1, Math.min(5, Number(config.maxRetries)))
      : parseInt(process.env.AI_MAX_RETRIES || '5');
    this.retryTemperature = parseFloat(process.env.AI_RETRY_TEMPERATURE || '0.3');
    this.tokenCostPer1K = Number.isFinite(config.tokenCostPer1K) ? Number(config.tokenCostPer1K) : parseFloat(process.env.AI_TOKEN_COST_PER_1K || '0.01');
    this.promptTokenCostPer1K = Number.isFinite(config.promptTokenCostPer1K) ? Number(config.promptTokenCostPer1K) : parseFloat(process.env.AI_PROMPT_TOKEN_COST_PER_1K || '0');
    this.completionTokenCostPer1K = Number.isFinite(config.completionTokenCostPer1K) ? Number(config.completionTokenCostPer1K) : parseFloat(process.env.AI_COMPLETION_TOKEN_COST_PER_1K || '0');
    this.requestTimeoutMs = Math.max(5_000, Math.min(600_000, parseInt(process.env.AI_REQUEST_TIMEOUT_MS || '600000')));
    // Actions and audit decisions are compact JSON. A bounded completion keeps
    // one malformed or verbose model response from stalling an entire run.
    const configuredMaxCompletionTokens = Number.isFinite(config.maxCompletionTokens)
      ? Number(config.maxCompletionTokens)
      : parseInt(process.env.AI_MAX_COMPLETION_TOKENS || '256');
    // Authoring workflows can return several structured stories with
    // acceptance criteria. Keep room for a complete JSON contract instead of
    // silently accepting a response cut in the middle of a proposal.
    this.maxCompletionTokens = Math.max(32, Math.min(20000, configuredMaxCompletionTokens));
    this.disableThinking = config.disableThinking === true;
    // Do not infer vision from a model name: providers differ and an image request can fail or add cost.
    this.supportsVision = config.visionEnabled === true;
    this.agentWorkflow = Array.isArray(config.agentWorkflow) ? config.agentWorkflow : [];
    this.agentDriver = config.agentDriver;
    this.agentRunId = config.agentRunId;
    this.messageHistory.push({
      role: 'system',
      content: `Eres un Arquitecto Senior de QA Automation y Especialista en Auditoría de Software.
Tu mentalidad es de "pensamiento crítico": no solo buscas completar la tarea, sino asegurar la calidad y robustez del proceso.
PRINCIPIOS DE QA QUE DEBES APLICAR:
1. VERIFICACIÓN CONTINUA: Después de cada acción, analiza si el resultado visual y el estado del DOM coinciden con lo esperado.
2. DETECCIÓN DE ERRORES: Si detectas un mensaje de error, validación fallida o comportamiento inesperado, repórtalo inmediatamente en el campo "reason".
3. EFICIENCIA TÉCNICA: Elige los selectores y acciones más estables (IDs, nombres claros) para evitar fragilidad en la automatización.
4. VALIDACIÓN DE DATOS: Asegura que cada dato ingresado o valor leído (variables generadas por el sistema) sea rastreable en el campo "dataUsed".
5. SEGUIMIENTO DE VARIABLES: Si el sistema genera un ID o valor nuevo, memorízalo y úsalo en pasos posteriores si es necesario.
6. NAVEGACIÓN A FUNCIONALIDAD: Si el objetivo requiere interactuar con elementos (botones, inputs, tablas) que NO son visibles en la página actual, busca enlaces o menús que parezcan llevar a esa funcionalidad. No te quedes esperando (\`wait\`) si la página es un índice o menú.
REGLAS CRÍTICAS:
1. Responde SIEMPRE en formato JSON puro.
2. Toda explicación en el campo "reason" DEBE estar en ESPAÑOL y ser CONCISA (máx 200 caracteres).
3. Si el usuario no te da datos específicos, invéntalos de forma realista e informa cuáles usaste en "dataUsed".
4. NUNCA repitas una action que ya hiciste con éxito sobre el mismo elemento si el estado no ha cambiado.
5. Tu razonamiento debe ser técnico, directo y orientado a la calidad.
6. **CONFIANZA**: Evalúa qué tan seguro estás de la acción (0-100) en el campo "confidence". Si es menor a 80, explica por qué.
7. **EDICIÓN EN TABLAS**: Prioriza iconos de 'Editar', 'Lápiz' o botones de acción contextuales.
8. **PRAGMATISMO TÉCNICO**: Confía en el DOM. Si ves campos de texto (input), interactúa con ellos incluso si la página parece antigua o simple. No te rindas ni digas "finish/error" si hay elementos interactivos que coinciden con el objetivo.
9. **SCROLL RESTRINGIDO**: NO uses la acción 'scroll' a menos que estés 100% seguro de que el elemento que buscas no está en el viewport actual. Si el QA Guard te sugiere un ID en el historial (ej. el-18), interactúa DIRECTAMENTE con él sin hacer scroll.
10. **VERIFICACIÓN OBLIGATORIA**: Antes de concluir que una tarea terminó, DEBES confirmar visualmente que el último cambio solicitado se refleja en la pantalla. Si no estás seguro, usa "wait" para dar tiempo al sistema.
11. **FORMATO JSON ESTRICTO**: Responde SIEMPRE con las llaves exactas solicitadas. Ejemplo: { "action": "click", "elementId": "el-5", "reason": "Hago clic en el botón...", "expected_result": "...", "confidence": 95 }`
    });
    const configuredSystemPrompt = this.getAgentPrompt('SYSTEM');
    if (configuredSystemPrompt) {
      this.messageHistory[0].content = `${configuredSystemPrompt}\n\n${this.messageHistory[0].content}`;
    }
  }
  private getAgentPrompt(agentId: string): string {
    const targetIndex = this.agentWorkflow.findIndex((item) => String(item?.id || '').toUpperCase() === agentId);
    const agent = targetIndex >= 0 ? this.agentWorkflow[targetIndex] : undefined;
    if (!agent || agent.enabled === false) return '';
    const customBefore = this.agentWorkflow
      .slice(0, Math.max(0, targetIndex))
      .filter((item) => item?.enabled !== false && String(item?.id || '').toUpperCase().startsWith('CUSTOM_'))
      .map((item) => {
        const name = String(item?.name || item?.id || 'Agente custom').trim();
        const action = String(item?.action || 'custom_review').trim();
        const prompt = String(item?.prompt || '').trim();
        return prompt ? `### ${name} (${action})\n${prompt}` : '';
      })
      .filter(Boolean);
    return [...customBefore, String(agent.prompt || '').trim()].filter(Boolean).join('\n\n');
  }
  async getNextAction(goal: string, pageState: string, history: string[], screenshotBase64?: string, manualSteps?: string): Promise<AIResult<AIAction>> {
    const userPrompt = `
### OBJETIVO
"${goal}"
${manualSteps ? `### GUÍA MANUAL (Pasos/Datos sugeridos)
${manualSteps}
` : ''}
### ESTADO DEL NAVEGADOR
${pageState}
### HISTORIAL
${history.join('\n') || 'Ninguna aún'}
### INSTRUCCIONES
1. **UNA SOLA ACCIÓN**: Responde con un único objeto JSON.
2. **ESQUEMA**:
   { "action": "click", "elementId": "el-X", "reason": "...", "expected_result": "...", "confidence": 100 }
   { "action": "type", "elementId": "el-X", "text": "valor", "dataUsed": "valor", "reason": "...", "expected_result": "...", "confidence": 100 }
   { "action": "drag_and_drop", "elementId": "el-origen", "targetId": "el-destino", "reason": "...", "expected_result": "...", "confidence": 100 }
   { "action": "scroll", "elementId": "el-X (opcional)", "reason": "...", "expected_result": "...", "confidence": 100 }
   { "action": "finish", "reason": "...", "expected_result": "...", "confidence": 100 }
Responde JSON:
`;
    const currentMessage: any = {
      role: 'user',
      content: this.supportsVision && screenshotBase64 ? [
        { type: 'text', text: userPrompt },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${screenshotBase64}` } }
      ] : userPrompt
    };
    let payloadMessages = [...this.messageHistory, currentMessage];
    // Manage image context limit - KEEP ONLY THE LAST IMAGE
    let imageFound = false;
    for (let i = payloadMessages.length - 1; i >= 0; i--) {
      if (Array.isArray(payloadMessages[i].content)) {
        if (!imageFound) {
          imageFound = true; // Keep this one (the most recent)
        } else {
          // Convert previous images to text placeholder to save context
          const textPart = payloadMessages[i].content.find((c: any) => c.type === 'text');
          payloadMessages[i] = {
            role: payloadMessages[i].role,
            content: textPart ? `[Evidencia anterior] ${textPart.text.substring(0, 500)}...` : '[Evidencia anterior]'
          };
        }
      }
    }
    try {
      const result = await this.sendWithRetry<AIAction>(payloadMessages);
      // OPTIMIZACIÓN: Solo guardamos un resumen de la acción en la historia, NO el pageState completo
      const stepSummary = `Acción previa: ${result.data.action} en ${result.data.elementId || 'N/A'}. Motivo: ${result.data.reason}`;
      this.messageHistory.push({ role: 'user', content: stepSummary });
      this.messageHistory.push({ role: 'assistant', content: JSON.stringify(result.data) });
      return result;
    } catch (error: any) {
      return {
        data: { action: 'error', reason: error.message, confidence: 0 },
        metrics: { latencyMs: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCost: 0 },
        prompt: payloadMessages,
        rawResponse: error.response?.data || error.message
      };
    }
  }
  private safeJsonParse(raw: string): any {
    return parseAIJson(raw);
  }
  private async sendWithRetry<T>(messages: any[], temperature?: number, maxCompletionTokens?: number): Promise<AIResult<T>> {
    return sendWithRetry<T>(this, messages, temperature, maxCompletionTokens);
  }
  async checkLoadingState(screenshotBase64: string): Promise<AIResult<{ loading: boolean, reason: string }>> {
    return checkLoadingState(this, screenshotBase64);
  }
  async planStepAction(args: {
    step: QAEngineStep;
    goal: string;
    observationText: string;
    historyText: string;
    screenshotBase64?: string;
    attempt: number;
  }): Promise<AIResult<StrictAIAction>> {
    return planStepAction(this, args);
  }
  async sendAgentExecutionResult(input: { ok: boolean; observation?: unknown; screenshotRef?: string }): Promise<void> {
    if (!this.agentDriver || !this.agentRunId) return;
    await this.agentDriver.sendExecutionResult({ runId: this.agentRunId, ...input }).catch(() => undefined);
  }
  async guardAction(goal: string, action: AIAction, thought?: string, rawResponse?: any, metrics?: any): Promise<{ approved: boolean; reason: string }> {
    if (!action || action.action === 'error') {
      return { approved: false, reason: action?.reason || 'La IA no devolvió una acción ejecutable.' };
    }
    return { approved: true, reason: 'Acción autorizada.' };
  }
  async runWorkflowAgent(args: {
    nodeName: string;
    promptTemplate: string;
    input: Record<string, any>;
    outputSchema?: Record<string, any>;
    temperature?: number;
    maxCompletionTokens?: number;
  }): Promise<AIResult<any>> {
    const prompt = `${args.promptTemplate || 'Analiza el input del workflow y responde AgentOutput JSON.'}
### NODO
${args.nodeName}
### INPUT JSON
${JSON.stringify(args.input, null, 2).slice(0, 12000)}
### OUTPUT_SCHEMA
${JSON.stringify(args.outputSchema || { required: ['status', 'reason'] }, null, 2)}
### CONTRATO DE CONTEXTO COMPARTIDO
Si el input incluye resolved_context, úsalo como fuente de verdad para los
datos del paso. No vuelvas a convertir clave=valor ni reemplaces un valor
normalizado por ejemplos propios. Respeta source, confidence y
ambiguities; si hay un candidato respaldado, úsalo y deja constancia de la
interpretación. Si no existe ningún valor respaldado, informa el dato faltante
en reason y no inventes una URL, credencial, selector ni resultado.
Para cada decisión relevante, incluye en sharedMemoryPatch los campos
resolved_context, input_mapping o failure_diagnosis sin incluir secretos
en claro en mensajes, eventos o reportes. Los valores secretos deben aparecer
enmascarados como ********.
Responde SOLO JSON con esta forma minima:
{
  "status": "SUCCESS|FAILED|BLOCKED|SKIPPED",
  "reason": "motivo breve",
  "confidence": 90,
  "decision": {},
  "events": [],
  "sharedMemoryPatch": {}
}`;
    return await this.sendWithRetry<any>(
      [{ role: 'user', content: prompt }],
      args.temperature ?? this.temperature,
      args.maxCompletionTokens,
    );
  }
  async waitForStability(page: any): Promise<void> {
    try {
      await page.waitForLoadState('networkidle', { timeout: 5000 });
    } catch (_) {
      await page.waitForTimeout(500);
    }
  }
  async auditResults(goal: string, history: string[] | StructuredHistoryItem[], screenshotBase64: string): Promise<{ status: 'PASSED' | 'FAILED' | 'BLOCKED' | 'SKIPPED'; reason: string; confidence: number }> {
    if (history.length && typeof history[0] !== 'string') {
      const structured = history as StructuredHistoryItem[];
      if (structured.some((item) => item.execution.ok)) {
        const failed = structured.filter((item) => !item.execution.ok);
        if (failed.length === 0) {
          return { status: 'PASSED', reason: 'Todos los pasos ejecutados por IA finalizaron correctamente.', confidence: 90 };
        }
      }
    }
    const historyText = (history as any[]).map((item) => {
      if (typeof item === 'string') return item;
      return `Paso ${item.step_number}: ${item.action?.action || '-'} -> ${item.execution?.ok ? 'OK' : 'ERROR'} ${item.execution?.message || ''}`;
    });
    const pageState = historyText.join('\n') || 'No se registraron acciones exitosas.';
    const result = await this.validateGoal(goal, pageState, screenshotBase64, historyText);
    return result.data;
  }
  notifyVeto(action: string, reason: string) {
    this.messageHistory.push({
        role: 'user',
        content: `TU ACCIÓN DE "${action}" FUE RECHAZADA por el Agente Guard. Motivo: ${reason}. Por favor, analiza nuevamente la pantalla y propón una alternativa válida.`
    });
  }
  async checkHealth(): Promise<boolean> {
    const result = await this.checkHealthDetailed();
    return result.ok;
  }
  async checkHealthDetailed(): Promise<{ ok: boolean; category?: string; status?: number }> {
    try {
      await generateWithProvider({ provider: this.provider, endpoint: this.endpoint, apiKey: this.apiKey, timeoutMs: Math.min(this.requestTimeoutMs, 30_000) }, { model: this.model, messages: [{ role: 'user', content: 'Responde JSON: {"ok":true}' }], temperature: 0, maxTokens: 16 });
      return { ok: true };
    } catch (error: any) {
      traceEntry('error', {
        event_detail: 'ai_health_failed',
        endpoint: `${this.endpoint}/chat/completions`,
        error: {
          message: error?.message || String(error),
          code: error?.code,
          status: error?.response?.status,
          response_body: error?.response?.data,
          stack: error?.stack,
        },
      });
      return {
        ok: false,
        category: error instanceof ProviderRequestError ? error.category : 'provider_error',
        status: error instanceof ProviderRequestError ? error.status : undefined,
      };
    }
  }
  async validateGoal(
    goal: string,
    pageState: string,
    screenshotBase64: string,
    history: string[],
    evidenceBundle?: AuditEvidenceBundle,
    evidenceImages: AuditImage[] = [],
  ): Promise<AIResult<AuditDecision>> {
    const agentPrompt = this.getAgentPrompt('AUDITOR');
    const prompt = `${agentPrompt ? `${agentPrompt}\n\n` : ''}
### AUDITORÍA DE QA SENIOR - EVALUACIÓN FINAL
Objetivo: "${goal}"
### HISTORIAL DE PASOS EXITOSOS
${history.join('\n') || 'No se registraron pasos exitosos.'}
### ESTADO FINAL
${pageState.substring(0, 3000)}
### PAQUETE DE EVIDENCIA ESTRUCTURADA
${JSON.stringify(evidenceBundle || {}, null, 2).slice(0, 18000)}
### REGLAS DEL AUDITOR:
1. Basa el dictamen solamente en datos del paquete, historial y capturas adjuntas. No supongas contenido que no esté visible o registrado.
2. **PASSED**: el resultado esperado está demostrado por una validación concluyente, texto/URL/DOM o una captura identificada.
3. **FAILED**: existe evidencia concreta y referenciable de que un resultado esperado no se cumplió.
4. **BLOCKED**: falta evidencia suficiente, hay contradicciones o no puedes determinar el resultado con seguridad.
5. Una acción ejecutada sin error no demuestra por sí sola que el resultado funcional se haya cumplido.
6. Si contradices el estado técnico, identifica la evidencia exacta en evidence_refs y explica la contradicción.
7. No declares FAILED por una captura ambigua. En ese caso usa BLOCKED y completa missing_evidence.
8. Si el objetivo esperado es logout, cierre de sesión o finalizar sesión, quedar en login después de cerrar sesión es evidencia de éxito.
9. **SÓLO JSON** con exactamente estas claves: status, reason, confidence, evidence_refs, failed_expectations, missing_evidence, contradictions.
Ejemplo de respuesta obligatoria:
{ "status": "BLOCKED", "reason": "La captura no permite confirmar el mensaje esperado", "confidence": 60, "evidence_refs": ["step-4-attempt-1-screenshot"], "failed_expectations": [], "missing_evidence": ["Texto visible del mensaje final"], "contradictions": [] }
`;
    const images = this.supportsVision
      ? (evidenceImages.length ? evidenceImages : [{ evidence_ref: 'final-screenshot', base64: screenshotBase64 }])
      : [];
    const content: any[] = [{ type: 'text', text: prompt }];
    for (const image of images.slice(-6)) {
      content.push({ type: 'text', text: `EVIDENCIA VISUAL: ${image.evidence_ref}` });
      content.push({ type: 'image_url', image_url: { url: `data:image/png;base64,${image.base64}` } });
    }
    const messages = [{ role: 'user', content }];
    try {
      return await this.sendWithRetry<AuditDecision>(messages, 0);
    } catch (error: any) {
      return {
        data: {
          status: 'BLOCKED',
          reason: 'Error de validación: ' + error.message,
          confidence: 0,
          evidence_refs: [],
          failed_expectations: [],
          missing_evidence: ['El auditor no pudo procesar la evidencia'],
          contradictions: [],
        },
        metrics: { latencyMs: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCost: 0 },
        prompt: messages,
        rawResponse: error.message
      };
    }
  }
  async validateAction(goal: string, action: AIAction, pageState: string, screenshotBase64?: string): Promise<AIResult<{ approved: boolean, reason: string }>> {
    const agentPrompt = this.getAgentPrompt('QA_GUARD');
    const prompt = `${agentPrompt ? `${agentPrompt}\n\n` : ''}
### ROL: AGENTE QA GUARD (SEGURIDAD DE EJECUCIÓN)
Tu misión es evitar que la automatización se desvíe del objetivo por "alucinaciones" o clics accidentales.
Analiza tanto el DOM como la CAPTURA DE PANTALLA adjunta.
### OBJETIVO DE LA PRUEBA
"${goal}"
### ACCIÓN PROPUESTA POR LA IA
Acción: ${action.action}
Elemento: ${action.elementId || 'N/A'}
Motivo de la IA: ${action.reason}
Resultado Esperado: ${action.expected_result || 'N/A'}
### ESTADO ACTUAL DEL DOM (RESUMEN)
${pageState.substring(0, 2000)}
### REGLAS DE VALIDACIÓN:
1. **RELEVANCIA**: ¿Esta acción acerca al usuario al objetivo final?
2. **NAVEGACIÓN EXTERNA**: VETA (approved: false) cualquier clic en "Privacy Policy", "Terms of Use", "Logout", "Home" o redes sociales, A MENOS que el objetivo lo pida explícitamente.
3. **INTELIGENCIA TÉCNICA**: Si el elemento carece de una etiqueta clara (label), analiza sus atributos técnicos ("htmlId", "htmlName", "placeholder"). Si estos atributos tienen una semántica que coincide con la tarea (ej: id="number1" para ingresar un número), AUTORIZA la acción. No vetes por falta de diseño estético si la evidencia técnica es clara.
4. **COHERENCIA**: Si la IA quiere hacer "type", ¿el elemento es realmente un input/textarea? Si quiere hacer "click" en "Remove", ¿el elemento parece un botón o enlace de borrado?
5. **ESTADO VISUAL**: Si la IA propone 'wait' pero en la pantalla no hay nada cargando y el elemento objetivo ya es visible, VETA la acción y exige interactuar.
Responde JSON: { "approved": true/false, "reason": "Breve explicación en ESPAÑOL" }
`;
    const messages: any[] = [{
        role: 'user',
        content: this.supportsVision && screenshotBase64 ? [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${screenshotBase64}` } }
        ] : prompt
    }];
    try {
      return await this.sendWithRetry<{ approved: boolean, reason: string }>(messages, 0);
    } catch (error: any) {
      return {
        data: { approved: true, reason: 'Error en QA Guard, permitiendo por defecto: ' + error.message },
        metrics: { latencyMs: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCost: 0 },
        prompt: messages,
        rawResponse: error.message
      };
    }
  }
}
function resolveProviderApiKey(provider: string): string | undefined {
  const envByProvider: Record<string, string[]> = {
    openai: ['OPENAI_API_KEY'],
    gemini: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
    anthropic: ['ANTHROPIC_API_KEY'],
    openrouter: ['OPENROUTER_API_KEY'],
    groq: ['GROQ_API_KEY'],
    deepseek: ['DEEPSEEK_API_KEY'],
    mistral: ['MISTRAL_API_KEY'],
    together: ['TOGETHER_API_KEY'],
    cohere: ['COHERE_API_KEY'],
    fireworks: ['FIREWORKS_API_KEY'],
    perplexity: ['PERPLEXITY_API_KEY'],
    xai: ['XAI_API_KEY'],
    'azure-openai': ['AZURE_OPENAI_API_KEY'],
    'openai-compatible': ['AI_API_KEY', 'OPENAI_API_KEY'],
  };
  const envNames = envByProvider[provider] || [];
  for (const envName of envNames) {
    const value = process.env[envName];
    if (value) return value;
  }
  return undefined;
}
