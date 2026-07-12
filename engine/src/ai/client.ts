import axios from 'axios';
import dotenv from 'dotenv';
import { traceEntry, traceRequestId } from '../test-trace.ts';
import type { QAEngineStep, StrictAIAction, StructuredHistoryItem } from '../automation/action-types.ts';

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
  private readonly endpoint: string;
  public readonly model: string;
  private readonly maxContext: number;
  private readonly temperature: number;
  private readonly maxRetries: number;
  private readonly retryTemperature: number;
  private readonly tokenCostPer1K: number;
  private readonly promptTokenCostPer1K: number;
  private readonly completionTokenCostPer1K: number;
  private readonly agentWorkflow: any[];
  private messageHistory: any[] = [];

  constructor(config: { endpoint?: string; model?: string; temperature?: number; agentWorkflow?: any[]; tokenCostPer1K?: number; promptTokenCostPer1K?: number; completionTokenCostPer1K?: number } = {}) {
    this.endpoint = config.endpoint || process.env.AI_API_ENDPOINT || 'http://172.16.10.4:1234/v1';
    this.model = config.model || process.env.AI_MODEL || 'google/gemma-4-e4b';
    this.maxContext = parseInt(process.env.AI_MAX_CONTEXT || '32768');
    this.temperature = Number.isFinite(config.temperature) ? Number(config.temperature) : parseFloat(process.env.AI_TEMPERATURE || '0.1');
    this.maxRetries = parseInt(process.env.AI_MAX_RETRIES || '5');
    this.retryTemperature = parseFloat(process.env.AI_RETRY_TEMPERATURE || '0.3');
    this.tokenCostPer1K = Number.isFinite(config.tokenCostPer1K) ? Number(config.tokenCostPer1K) : parseFloat(process.env.AI_TOKEN_COST_PER_1K || '0.01');
    this.promptTokenCostPer1K = Number.isFinite(config.promptTokenCostPer1K) ? Number(config.promptTokenCostPer1K) : parseFloat(process.env.AI_PROMPT_TOKEN_COST_PER_1K || '0');
    this.completionTokenCostPer1K = Number.isFinite(config.completionTokenCostPer1K) ? Number(config.completionTokenCostPer1K) : parseFloat(process.env.AI_COMPLETION_TOKEN_COST_PER_1K || '0');
    this.agentWorkflow = Array.isArray(config.agentWorkflow) ? config.agentWorkflow : [];
    
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
      content: screenshotBase64 ? [
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
      const result = await this.sendWithRetry(payloadMessages);
      
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
                        status: statusMatch ? statusMatch[1] : 'FAILED',
                        reason: reasonMatch ? reasonMatch[1] : 'Error de parseo parcial',
                        confidence: confMatch ? parseInt(confMatch[1]) : 0,
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

  private async sendWithRetry<T>(messages: any[], temperature?: number): Promise<AIResult<T>> {
    let attempts = 0;
    const start = Date.now();

    while (attempts < this.maxRetries) {
      try {
        const requestId = traceRequestId('engine-ai');
        const aiPayload = {
          model: this.model,
          messages,
          temperature: temperature ?? (attempts > 0 ? this.retryTemperature : this.temperature)
        };
        const attemptStarted = Date.now();
        traceEntry('ai_request', {
          request_id: requestId,
          endpoint: `${this.endpoint}/chat/completions`,
          attempt: attempts + 1,
          body: aiPayload,
        });
        const response = await axios.post(`${this.endpoint}/chat/completions`, aiPayload);
        traceEntry('ai_response', {
          request_id: requestId,
          endpoint: `${this.endpoint}/chat/completions`,
          attempt: attempts + 1,
          status: response.status,
          headers: response.headers,
          response_body: response.data,
          duration_ms: Date.now() - attemptStarted,
        });

        const latency = Date.now() - start;
        const usage = response.data.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
        const rawContent = response.data.choices[0].message.content.trim();
        
        const cost = this.promptTokenCostPer1K || this.completionTokenCostPer1K
          ? (usage.prompt_tokens / 1000) * this.promptTokenCostPer1K + (usage.completion_tokens / 1000) * this.completionTokenCostPer1K
          : (usage.total_tokens / 1000) * this.tokenCostPer1K;

        try {
            let parsed = this.safeJsonParse(rawContent);
            if (Array.isArray(parsed)) parsed = parsed[0];
            return {
                data: parsed as T,
                metrics: {
                    latencyMs: latency,
                    promptTokens: usage.prompt_tokens,
                    completionTokens: usage.completion_tokens,
                    totalTokens: usage.total_tokens,
                    estimatedCost: cost
                },
                prompt: messages,
                rawResponse: response.data
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
            status: error?.response?.status,
            response_body: error?.response?.data,
            stack: error?.stack,
          },
        });
        if (error.response?.status === 500 || error.code === 'ECONNRESET') {
          const textOnlyMessages = messages.map(m => {
            if (Array.isArray(m.content)) {
              const textPart = m.content.find((c: any) => c.type === 'text');
              return { ...m, content: (textPart?.text || 'Analizando estado del DOM...') + '\n(NOTA: Hubo un fallo visual, confía solo en el DOM)' };
            }
            return m;
          });
          messages = textOnlyMessages;
          attempts++; 
          continue;
        }
        throw error;
      }
    }
    throw new Error("No se pudo obtener un JSON válido tras varios intentos.");
  }

  async checkLoadingState(screenshotBase64: string): Promise<AIResult<{ loading: boolean, reason: string }>> {
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
    const agentPrompt = this.getAgentPrompt('AI_AGENT');
    const prompt = `${agentPrompt ? `${agentPrompt}\n\n` : ''}
### ROL
Sos un agente QA que controla un navegador real. Tenes que ejecutar SOLO el paso actual.

### PASO ACTUAL
Numero: ${args.step.number}
Accion esperada: ${args.step.action || '-'}
Datos disponibles: ${args.step.data || '-'}
Resultado esperado: ${args.step.expected || '-'}

### OBJETIVO
${args.goal}

### SNAPSHOT ESTRUCTURADO DEL NAVEGADOR
${args.observationText}

### HISTORIAL RECIENTE
${args.historyText}

### REGLAS
1. Responde SOLO JSON, sin Markdown ni texto extra.
2. Usa siempre uno de estos action: navigate, click, click_at, type, select, press, wait, assert_visible, assert_text, finish, fail, blocked.
3. Si interactuas con un elemento del snapshot, usa target_ref exacto, por ejemplo "el-3".
4. Si la captura muestra un control o desplegable complejo que no aparece bien en el snapshot, puedes usar click_at con coordenadas x/y absolutas del viewport.
5. Para type/select/press/navigate/assert_text usa value. Para click_at usa x/y y deja target_ref vacio.
6. No inventes target_ref. Si usas click_at, las coordenadas deben caer dentro del elemento visible que quieres accionar.
7. Si el paso ya esta cumplido visualmente, usa assert_visible o finish.
8. step_number debe ser exactamente ${args.step.number}.
9. Si faltan datos imprescindibles, usa blocked y explica que dato falta.
10. No copies textos de ejemplo. El campo reason debe describir lo que ves o el dato tecnico que falta.
11. No uses frases genericas como "Motivo breve en espanol", "N/A", "TODO" o "reason".

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

Si devuelves reason o expected iguales al ejemplo, la accion sera rechazada y reintentada.
`;

    const currentMessage: any = {
      role: 'user',
      content: args.screenshotBase64 ? [
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
  }): Promise<AIResult<any>> {
    const prompt = `${args.promptTemplate || 'Analiza el input del workflow y responde AgentOutput JSON.'}

### NODO
${args.nodeName}

### INPUT JSON
${JSON.stringify(args.input, null, 2).slice(0, 12000)}

### OUTPUT_SCHEMA
${JSON.stringify(args.outputSchema || { required: ['status', 'reason'] }, null, 2)}

Responde SOLO JSON con esta forma minima:
{
  "status": "SUCCESS|FAILED|BLOCKED|SKIPPED",
  "reason": "motivo breve",
  "confidence": 90,
  "decision": {},
  "events": [],
  "sharedMemoryPatch": {}
}`;
    return await this.sendWithRetry<any>([{ role: 'user', content: prompt }], args.temperature ?? this.temperature);
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
    try {
      const requestId = traceRequestId('engine-ai-health');
      const payload = {
        model: this.model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 5
      };
      const started = Date.now();
      traceEntry('ai_request', {
        request_id: requestId,
        endpoint: `${this.endpoint}/chat/completions`,
        body: payload,
        health_check: true,
      });
      const response = await axios.post(`${this.endpoint}/chat/completions`, payload);
      traceEntry('ai_response', {
        request_id: requestId,
        endpoint: `${this.endpoint}/chat/completions`,
        status: response.status,
        headers: response.headers,
        response_body: response.data,
        duration_ms: Date.now() - started,
        health_check: true,
      });
      return true;
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
      return false;
    }
  }

  async validateGoal(goal: string, pageState: string, screenshotBase64: string, history: string[]): Promise<AIResult<{ status: 'PASSED' | 'FAILED' | 'BLOCKED' | 'SKIPPED', reason: string, confidence: number }>> {
    const agentPrompt = this.getAgentPrompt('AUDITOR');
    const prompt = `${agentPrompt ? `${agentPrompt}\n\n` : ''}
### AUDITORÍA DE QA SENIOR - EVALUACIÓN FINAL
Objetivo: "${goal}"

### HISTORIAL DE PASOS EXITOSOS
${history.join('\n') || 'No se registraron pasos exitosos.'}

### ESTADO FINAL
${pageState.substring(0, 3000)}

### REGLAS DEL AUDITOR:
1. **PASSED**: El objetivo se cumplió. Confía en el HISTORIAL si dice "Success" en los pasos clave.
2. **FAILED**: El objetivo NO se cumplió, hubo errores visuales o el historial está vacío/incoherente.
3. **SÓLO JSON**: Responde ÚNICAMENTE con el objeto JSON usando exactamente estas claves en inglés: "status", "reason", "confidence".

Ejemplo de respuesta obligatoria:
{ "status": "FAILED", "reason": "La suma no coincide con 42", "confidence": 95 }
`;
    const messages = [
      { role: 'user', content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${screenshotBase64}` } }
      ]}
    ];

    try {
      return await this.sendWithRetry<{ status: 'PASSED' | 'FAILED' | 'BLOCKED' | 'SKIPPED', reason: string, confidence: number }>(messages, 0);
    } catch (error: any) {
      return {
        data: { status: 'FAILED', reason: 'Error de validación: ' + error.message, confidence: 0 },
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
        content: screenshotBase64 ? [
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
