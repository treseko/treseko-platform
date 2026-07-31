import type { QAEngineStep, StrictAIAction } from '../automation/action-types.ts'

export async function checkLoadingState(context: any, screenshotBase64: string): Promise<any> {
  if (!context.supportsVision) {
    return {
      data: { loading: false, reason: 'Modelo sin capacidad visual configurada; se usa la observacion estructurada del navegador.' },
      metrics: { latencyMs: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCost: 0 },
      prompt: { skipped: 'vision_not_supported' },
      rawResponse: { skipped: 'vision_not_supported' },
    }
  }
  const agentPrompt = context.getAgentPrompt('SENTINEL')
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
`
  const messages = [{ role: 'user', content: [
    { type: 'text', text: prompt },
    { type: 'image_url', image_url: { url: `data:image/png;base64,${screenshotBase64}` } },
  ] }]
  try {
    return await context.sendWithRetry(messages, 0)
  } catch (error: any) {
    return {
      data: { loading: false, reason: 'Error en centinela: ' + error.message },
      metrics: { latencyMs: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCost: 0 },
      prompt: messages,
      rawResponse: error.message,
    }
  }
}

export async function planStepAction(context: any, args: {
  step: QAEngineStep
  goal: string
  observationText: string
  historyText: string
  screenshotBase64?: string
  attempt: number
}): Promise<any> {
  if (context.agentDriver && context.agentRunId) {
    const started = Date.now()
    try {
      const data = await context.agentDriver.nextAction({ runId: context.agentRunId, stepNumber: args.step.number, prompt: `${args.goal}\n\nOBSERVACIÓN:\n${args.observationText}\n\nHISTORIAL:\n${args.historyText}` })
      return { data: { ...data, step_number: args.step.number, reason: data.reason || 'Decisión OpenCode', confidence: Number(data.confidence ?? 0) }, metrics: { latencyMs: Date.now() - started, promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCost: 0 }, prompt: { driver: 'opencode' }, rawResponse: data }
    } catch (error: any) {
      return { data: { action: 'blocked', reason: `OpenCode no pudo decidir la acción: ${error?.message || error}`, confidence: 0, step_number: args.step.number }, metrics: { latencyMs: Date.now() - started, promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCost: 0 }, prompt: { driver: 'opencode' }, rawResponse: error?.message || String(error) }
    }
  }

  const agentPrompt = context.getAgentPrompt('AI_AGENT')
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
11. Si hay usuario, password, email, search_term, query, url o base_url en los datos normalizados, usa exactamente esos valores.
12. El campo reason es una explicacion breve de la decision; no es la accion. La accion real debe estar en action.
13. No copies textos de ejemplo ni inventes URLs, credenciales, valores o resultados.

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
`
  const currentMessage: any = {
    role: 'user',
    content: context.supportsVision && args.screenshotBase64 ? [
      { type: 'text', text: prompt },
      { type: 'image_url', image_url: { url: `data:image/png;base64,${args.screenshotBase64}` } },
    ] : prompt,
  }
  const messages = [...context.messageHistory.slice(-8), currentMessage]
  try {
    const result = await context.sendWithRetry(messages, args.attempt > 1 ? context.retryTemperature : context.temperature)
    context.messageHistory.push({ role: 'assistant', content: JSON.stringify({ step_number: args.step.number, action: result.data.action, target_ref: result.data.target_ref, reason: result.data.reason }) })
    return result
  } catch (error: any) {
    return {
      data: { action: 'blocked', reason: `No se pudo planificar el paso: ${error.message}`, confidence: 0, step_number: args.step.number },
      metrics: { latencyMs: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCost: 0 },
      prompt: messages,
      rawResponse: error.response?.data || error.message,
    }
  }
}
