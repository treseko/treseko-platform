import dotenv from 'dotenv';
import { traceEntry, traceRequestId } from '../test-trace.ts';
import type { QAEngineStep, StrictAIAction, StructuredHistoryItem } from '../automation/action-types.ts';
import type { AuditDecision, AuditEvidenceBundle, AuditImage } from '../audit/consensus.ts';
import { generateWithProvider, normalizeProvider, ProviderRequestError } from './provider-adapters.ts';
import type { AgentDriver } from './agent-driver.ts';

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
    try {
        // Limpieza agresiva de bloques de código markdown y texto extra
        const cleanRaw = raw.replace(/```json/g, '').replace(/```/g, '').trim();
        
        const firstBrace = cleanRaw.indexOf('{');
        const lastBrace = cleanRaw.lastIndexOf('}');
        
        if (firstBrace !== -1 && lastBrace !== -1) {
            let jsonPart = cleanRaw.substring(firstBrace, lastBrace + 1);
            
            // Reparar comillas en campos de texto (reason)
            jsonPart = jsonPart.replace(/"reason":\s*"(.*?)"/gs, (match, p1) => {
                return `"reason": "${p1.replace(/\n/g, '\\n').replace(/"/g, '\\"')}"`;
            });

            try {
                return JSON.parse(jsonPart);
            } catch (e) {
                // Intento final: extraer solo campos clave con regex si JSON.parse falla
                const statusMatch = jsonPart.match(/"status":\s*"(.*?)"/);
                const reasonMatch = jsonPart.match(/"reason":\s*"(.*?)"/);
                const confMatch = jsonPart.match(/"confidence":\s*(\d+)/);
                
                if (statusMatch || reasonMatch) {
                    return {
                        status: statusMatch?.[1] || 'FAILED',
                        reason: reasonMatch?.[1] || 'Error de parseo parcial',
                        confidence: parseInt(confMatch?.[1] || '0'),
                        approved: jsonPart.includes('"approved": true'),
                        action: 'error'
                    };
                }
                throw e;
            }
        }
        return JSON.parse(cleanRaw);
    } catch (e) {
        // Fallback for truncated JSON: try to close it
        const trimmed = raw.trim();
        if (trimmed.startsWith('{') && !trimmed.endsWith('}')) {
            try { return JSON.parse(trimmed + '"}'); } catch {}
            try { return JSON.parse(trimmed + '}'); } catch {}
        }
        const jsonMatch = raw.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
        if (jsonMatch) return JSON.parse(jsonMatch[0]);
        throw e;
    }
  }

  private async sendWithRetry<T>(messages: any[], temperature?: number, maxCompletionTokens?: number): Promise<AIResult<T>> {
    let attempts = 0;
    let fallbackIndex = 0;
    const start = Date.now();

    while (attempts < this.maxRetries) {
      try {
        const requestId = traceRequestId('engine-ai');
        const aiPayload = {
          model: this.model,
          messages,
          temperature: temperature ?? (attempts > 0 ? this.retryTemperature : this.temperature),
          max_tokens: Math.max(32, Math.min(this.maxCompletionTokens, Number(maxCompletionTokens || this.maxCompletionTokens))),
          // Do not force OpenAI JSON mode here. Some local servers advertise
          // it but reject `response_format` at runtime. The governed prompt
          // and parser preserve compatibility with those servers.
          ...(this.disableThinking ? {
            reasoning_effort: 'none',
            chat_template_kwargs: { enable_thinking: false },
          } : {}),
        };
        const attemptStarted = Date.now();
        const providerEndpoint = `${this.endpoint}/${this.provider === 'anthropic' ? 'messages' : this.provider === 'gemini' ? 'models/:model:generateContent' : this.provider === 'openai' ? 'responses' : 'chat/completions'}`;
        traceEntry('ai_request', {
          request_id: requestId,
          endpoint: providerEndpoint,
          attempt: attempts + 1,
          body: aiPayload,
          provider: this.provider,
        });
        const response = await generateWithProvider({
          provider: this.provider,
          endpoint: this.endpoint,
          apiKey: this.apiKey,
          timeoutMs: this.requestTimeoutMs,
        }, {
          model: this.model,
          messages,
          temperature: aiPayload.temperature,
          maxTokens: aiPayload.max_tokens,
          disableThinking: this.disableThinking,
        });
        traceEntry('ai_response', {
          request_id: requestId,
          endpoint: providerEndpoint,
          attempt: attempts + 1,
          status: 200,
          response_body: response.raw,
          duration_ms: Date.now() - attemptStarted,
        });

        const latency = Date.now() - start;
        const usage = response.usage;
        const rawContent = response.content;
        
        const cost = this.promptTokenCostPer1K || this.completionTokenCostPer1K
          ? (usage.promptTokens / 1000) * this.promptTokenCostPer1K + (usage.completionTokens / 1000) * this.completionTokenCostPer1K
          : (usage.totalTokens / 1000) * this.tokenCostPer1K;

        try {
            let parsed = this.safeJsonParse(rawContent);
            if (Array.isArray(parsed)) parsed = parsed[0];
            return {
                data: parsed as T,
                metrics: {
                    latencyMs: latency,
                    promptTokens: usage.promptTokens,
                    completionTokens: usage.completionTokens,
                    totalTokens: usage.totalTokens,
                    estimatedCost: cost
                },
                prompt: messages,
                rawResponse: response.raw
            };
        } catch (jsonError: any) {
            attempts++;
            if (attempts >= this.maxRetries) throw jsonError;
            
            messages.push({ role: 'assistant', content: rawContent });
            messages.push({ 
                role: 'user', 
                content: `ERROR TÉCNICO: Tu respuesta anterior no fue un JSON válido (Error: ${jsonError.message}). 
Por favor, RE-GENERA el objeto JSON completo desde cero, asegurándote de:
1. Abrir y cerrar todas las llaves {}.
2. No incluir comentarios o texto fuera del JSON.
3. Usar el formato exacto solicitado.` 
            });
        }
      } catch (error: any) {
        traceEntry('error', {
          event_detail: 'ai_request_failed',
          endpoint: `${this.endpoint}/chat/completions`,
          attempt: attempts + 1,
          error: {
            message: error?.message || String(error),
            code: error?.code,
            timeout_ms: this.requestTimeoutMs,
            status: error?.response?.status,
            response_body: error?.response?.data,
            stack: error?.stack,
          },
        });
        if ((error instanceof ProviderRequestError && ['provider_unavailable', 'rate_limited', 'timeout', 'network_error'].includes(error.category)) || error.response?.status === 500 || error.code === 'ECONNRESET') {
          const textOnlyMessages = messages.map(m => {
            if (Array.isArray(m.content)) {
              const textPart = m.content.find((c: any) => c.type === 'text');
              return { ...m, content: (textPart?.text || 'Analizando estado del DOM...') + '\n(NOTA: Hubo un fallo visual, confía solo en el DOM)' };
            }
            return m;
          });
          messages = textOnlyMessages;
          attempts++;
          if (attempts >= this.maxRetries && fallbackIndex < this.fallbackConfigs.length) {
            const fallback = this.fallbackConfigs[fallbackIndex++];
            traceEntry('workflow_event', { event_detail: 'ai_provider_fallback', from_provider: this.provider, to_provider: fallback.provider, to_model: fallback.model, reason: error instanceof ProviderRequestError ? error.category : 'provider_unavailable' });
            this.provider = fallback.provider;
            this.endpoint = fallback.endpoint;
            this.model = fallback.model;
            this.apiKey = fallback.apiKey || resolveProviderApiKey(fallback.provider);
            attempts = 0;
          }
          continue;
        }
        throw error;
      }
    }
    throw new Error("No se pudo obtener un JSON válido tras varios intentos.");
  }

  async checkLoadingState(screenshotBase64: string): Promise<AIResult<{ loading: boolean, reason: string }>> {
    if (!this.supportsVision) {
      return {
        data: { loading: false, reason: 'Modelo sin capacidad visual configurada; se usa la observacion estructurada del navegador.' },
        metrics: { latencyMs: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCost: 0 },
        prompt: { skipped: 'vision_not_supported' },
        rawResponse: { skipped: 'vision_not_supported' },
      };
    }
    const agentPrompt = this.getAgentPrompt('SENTINEL');
    const prompt = `${agentPrompt ? `${agentPrompt}\n\n` : ''}
### ROL: AGENTE SENTINELA DE CARGA (LOADING SENTINEL)
Analiza la captura de pantalla adjunta. Tu misión es detectar si la página web está en un estado transitorio o de carga.

**Busca evidencias de:**
1. **Spinners/Ruedas**: Iconos circulares que giran.
2. **Skeleton Screens**: Marcadores de posición grises donde debería haber contenido.
3. **Overlays**: Capas que bloquean la interacción (pantalla oscurecida).
4. **Textos de Proceso**: "Saving...", "Loading...", "Enviando...", "Un momento...".
5. **Barras de Progreso**: Líneas de carga en la parte superior o en botones.

Responde JSON: { "loading": true/false, "reason": "Descripción técnica en ESPAÑOL de lo detectado" }
`;

    const messages = [{
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${screenshotBase64}` } }
      ]
    }];

    try {
      return await this.sendWithRetry<{ loading: boolean, reason: string }>(messages, 0);
    } catch (error: any) {
      return {
        data: { loading: false, reason: 'Error en centinela: ' + error.message },
        metrics: { latencyMs: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCost: 0 },
        prompt: messages,
        rawResponse: error.message
      };
    }
  }

  async planStepAction(args: {
    step: QAEngineStep;
    goal: string;
    observationText: string;
    historyText: string;
    screenshotBase64?: string;
    attempt: number;
  }): Promise<AIResult<StrictAIAction>> {
    if (this.agentDriver && this.agentRunId) {
      const started = Date.now();
      try {
        const data = await this.agentDriver.nextAction({ runId: this.agentRunId, stepNumber: args.step.number, prompt: `${args.goal}\n\nOBSERVACIÓN:\n${args.observationText}\n\nHISTORIAL:\n${args.historyText}` });
        return { data: { ...data, step_number: args.step.number, reason: data.reason || 'Decisión OpenCode', confidence: Number(data.confidence ?? 0) }, metrics: { latencyMs: Date.now() - started, promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCost: 0 }, prompt: { driver: 'opencode' }, rawResponse: data };
      } catch (error: any) {
        return { data: { action: 'blocked', reason: `OpenCode no pudo decidir la acción: ${error?.message || error}`, confidence: 0, step_number: args.step.number }, metrics: { latencyMs: Date.now() - started, promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCost: 0 }, prompt: { driver: 'opencode' }, rawResponse: error?.message || String(error) };
      }
    }
    const agentPrompt = this.getAgentPrompt('AI_AGENT');
    const prompt = `${agentPrompt ? `${agentPrompt}\n\n` : ''}
### ROL
Sos un agente QA que controla un navegador real. Tenes que ejecutar SOLO el paso actual.

### PASO ACTUAL
Numero: ${args.step.number}
Accion esperada: ${args.step.action || '-'}
Datos normalizados disponibles: ${args.step.data || '-'}
Resultado esperado: ${args.step.expected || '-'}

### OBJETIVO
${args.goal}

### SNAPSHOT ESTRUCTURADO DEL NAVEGADOR
${args.observationText}

### HISTORIAL RECIENTE
${args.historyText}

### REGLAS
1. Responde SOLO JSON, sin Markdown ni texto extra.
2. Usa siempre uno de estos action: navigate, click, click_at, type, fill_form, check, select, press, wait, assert_visible, assert_text, finish, fail, blocked.
3. Si interactuas con un elemento del snapshot, usa target_ref exacto, por ejemplo "el-3".
4. Si la captura muestra un control o desplegable complejo que no aparece bien en el snapshot, puedes usar click_at con coordenadas x/y absolutas del viewport.
5. Para type/select/press/navigate/assert_text usa value. Para click_at usa x/y y deja target_ref vacio.
6. No inventes target_ref. Si usas click_at, las coordenadas deben caer dentro del elemento visible que quieres accionar.
7. Si el paso ya esta cumplido visualmente, usa assert_visible o finish.
8. step_number es informativo: el engine siempre lo fija en ${args.step.number}.
9. Si faltan datos imprescindibles, usa blocked y explica que dato falta.
10. No uses blocked para describir una accion que podes ejecutar. Si el paso dice "ingresar", "completar", "buscar", "abrir", "presionar" o "validar" y hay un elemento visible compatible en el snapshot, debes elegir una accion ejecutable.
11. Si hay usuario, password, email, search_term, query, url o base_url en los datos normalizados, usa exactamente esos valores. Identifica el campo por sus labels y atributos visibles; no dependas de un selector fijo.
12. El campo reason es una explicacion breve de la decision; no es la accion. La accion real debe estar en action.
13. No copies textos de ejemplo. El campo reason debe describir lo que ves o el dato tecnico que falta.
14. No uses frases genericas como "Motivo breve en espanol", "N/A", "TODO" o "reason".
15. No inventes URLs, credenciales, valores ni resultados. Si un dato obligatorio no aparece en Datos disponibles ni en el snapshot, usa blocked e identifica exactamente el dato faltante.

### JSON OBLIGATORIO
{
  "action": "click",
  "target_ref": "el-0",
  "x": 0,
  "y": 0,
  "value": "",
  "reason": "Motivo breve en español",
  "expected": "Resultado esperado breve",
  "confidence": 90,
  "step_number": ${args.step.number}
}

Para navegar, usa navigate solamente con una URL absoluta que provenga de los datos reales del caso, del ambiente/inventario o del snapshot actual. Si no existe una URL real, usa blocked e indica que falta la URL inicial.

Si devuelves reason o expected iguales al ejemplo, la accion sera rechazada y reintentada.
`;

    const currentMessage: any = {
      role: 'user',
      content: this.supportsVision && args.screenshotBase64 ? [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${args.screenshotBase64}` } }
      ] : prompt
    };

    const messages = [
      ...this.messageHistory.slice(-8),
      currentMessage,
    ];

    try {
      const result = await this.sendWithRetry<StrictAIAction>(messages, args.attempt > 1 ? this.retryTemperature : this.temperature);
      this.messageHistory.push({
        role: 'assistant',
        content: JSON.stringify({
          step_number: args.step.number,
          action: result.data.action,
          target_ref: result.data.target_ref,
          reason: result.data.reason,
        }),
      });
      return result;
    } catch (error: any) {
      return {
        data: {
          action: 'blocked',
          reason: `No se pudo planificar el paso: ${error.message}`,
          confidence: 0,
          step_number: args.step.number,
        },
        metrics: { latencyMs: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCost: 0 },
        prompt: messages,
        rawResponse: error.response?.data || error.message,
      };
    }
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
