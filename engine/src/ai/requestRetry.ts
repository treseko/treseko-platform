import { traceEntry, traceRequestId } from '../test-trace.ts'
import { generateWithProvider, ProviderRequestError } from './provider-adapters.ts'

export async function sendWithRetry<T>(context: any, messages: any[], temperature?: number, maxCompletionTokens?: number): Promise<any> {
  let attempts = 0
  let fallbackIndex = 0
  const start = Date.now()

  while (attempts < context.maxRetries) {
    try {
      const requestId = traceRequestId('engine-ai')
      const aiPayload = {
        model: context.model,
        messages,
        temperature: temperature ?? (attempts > 0 ? context.retryTemperature : context.temperature),
        max_tokens: Math.max(32, Math.min(context.maxCompletionTokens, Number(maxCompletionTokens || context.maxCompletionTokens))),
        ...(context.disableThinking ? {
          reasoning_effort: 'none',
          chat_template_kwargs: { enable_thinking: false },
        } : {}),
      }
      const attemptStarted = Date.now()
      const providerEndpoint = `${context.endpoint}/${context.provider === 'anthropic' ? 'messages' : context.provider === 'gemini' ? 'models/:model:generateContent' : context.provider === 'openai' ? 'responses' : 'chat/completions'}`
      traceEntry('ai_request', {
        request_id: requestId,
        endpoint: providerEndpoint,
        attempt: attempts + 1,
        body: aiPayload,
        provider: context.provider,
      })
      const response = await generateWithProvider({
        provider: context.provider,
        endpoint: context.endpoint,
        apiKey: context.apiKey,
        timeoutMs: context.requestTimeoutMs,
      }, {
        model: context.model,
        messages,
        temperature: aiPayload.temperature,
        maxTokens: aiPayload.max_tokens,
        disableThinking: context.disableThinking,
      })
      traceEntry('ai_response', {
        request_id: requestId,
        endpoint: providerEndpoint,
        attempt: attempts + 1,
        status: 200,
        response_body: response.raw,
        duration_ms: Date.now() - attemptStarted,
      })

      const usage = response.usage
      const cost = context.promptTokenCostPer1K || context.completionTokenCostPer1K
        ? (usage.promptTokens / 1000) * context.promptTokenCostPer1K + (usage.completionTokens / 1000) * context.completionTokenCostPer1K
        : (usage.totalTokens / 1000) * context.tokenCostPer1K

      try {
        let parsed = context.safeJsonParse(response.content)
        if (Array.isArray(parsed)) parsed = parsed[0]
        return {
          data: parsed as T,
          metrics: {
            latencyMs: Date.now() - start,
            promptTokens: usage.promptTokens,
            completionTokens: usage.completionTokens,
            totalTokens: usage.totalTokens,
            estimatedCost: cost,
          },
          prompt: messages,
          rawResponse: response.raw,
        }
      } catch (jsonError: any) {
        attempts++
        if (attempts >= context.maxRetries) throw jsonError
        messages.push({ role: 'assistant', content: response.content })
        messages.push({
          role: 'user',
          content: `ERROR TÉCNICO: Tu respuesta anterior no fue un JSON válido (Error: ${jsonError.message}).
Por favor, RE-GENERA el objeto JSON completo desde cero, asegurándote de:
1. Abrir y cerrar todas las llaves {}.
2. No incluir comentarios o texto fuera del JSON.
3. Usar el formato exacto solicitado.`,
        })
      }
    } catch (error: any) {
      traceEntry('error', {
        event_detail: 'ai_request_failed',
        endpoint: `${context.endpoint}/chat/completions`,
        attempt: attempts + 1,
        error: {
          message: error?.message || String(error),
          code: error?.code,
          timeout_ms: context.requestTimeoutMs,
          status: error?.response?.status,
          response_body: error?.response?.data,
          stack: error?.stack,
        },
      })
      if ((error instanceof ProviderRequestError && ['provider_unavailable', 'rate_limited', 'timeout', 'network_error'].includes(error.category)) || error.response?.status === 500 || error.code === 'ECONNRESET') {
        messages = messages.map((message: any) => {
          if (Array.isArray(message.content)) {
            const textPart = message.content.find((part: any) => part.type === 'text')
            return { ...message, content: (textPart?.text || 'Analizando estado del DOM...') + '\n(NOTA: Hubo un fallo visual, confía solo en el DOM)' }
          }
          return message
        })
        attempts++
        if (attempts >= context.maxRetries && fallbackIndex < context.fallbackConfigs.length) {
          const fallback = context.fallbackConfigs[fallbackIndex++]
          traceEntry('workflow_event', { event_detail: 'ai_provider_fallback', from_provider: context.provider, to_provider: fallback.provider, to_model: fallback.model, reason: error instanceof ProviderRequestError ? error.category : 'provider_unavailable' })
          context.provider = fallback.provider
          context.endpoint = fallback.endpoint
          context.model = fallback.model
          context.apiKey = fallback.apiKey || context.resolveProviderApiKey(fallback.provider)
          attempts = 0
        }
        continue
      }
      throw error
    }
  }
  throw new Error('No se pudo obtener un JSON válido tras varios intentos.')
}
