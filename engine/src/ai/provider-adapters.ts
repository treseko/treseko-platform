import axios from 'axios';

export type ProviderMessage = { role: string; content: any };

export type ProviderGenerateRequest = {
  model: string;
  messages: ProviderMessage[];
  temperature: number;
  maxTokens: number;
  disableThinking?: boolean;
};

export type NormalizedProviderResult = {
  content: string;
  raw: any;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cachedTokens: number;
    reasoningTokens: number;
  };
  model?: string;
  finishReason?: string;
  requestId?: string;
};

export type ProviderAdapterConfig = {
  provider: string;
  endpoint: string;
  apiKey?: string;
  timeoutMs: number;
};

export class ProviderRequestError extends Error {
  constructor(
    message: string,
    public readonly category: string,
    public readonly status?: number,
    public readonly retryAfterMs?: number,
    public readonly raw?: any,
  ) {
    super(message);
    this.name = 'ProviderRequestError';
  }
}

function trimSlash(value: string): string {
  return String(value || '').replace(/\/+$/, '');
}

function textContent(content: any): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return String(content ?? '');
  return content
    .filter((item) => item?.type === 'text' || item?.type === 'input_text')
    .map((item) => String(item.text || ''))
    .join('\n');
}

function anthropicContent(content: any): any {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return String(content ?? '');
  return content.map((item) => {
    if (item?.type === 'text' || item?.type === 'input_text') return { type: 'text', text: String(item.text || '') };
    if (item?.type === 'image_url' && String(item.image_url?.url || '').startsWith('data:')) {
      const [header, data] = String(item.image_url.url).split(',', 2);
      return { type: 'image', source: { type: 'base64', media_type: header.slice(5).split(';')[0], data } };
    }
    return { type: 'text', text: '' };
  });
}

function geminiParts(content: any): any[] {
  if (typeof content === 'string') return [{ text: content }];
  if (!Array.isArray(content)) return [{ text: String(content ?? '') }];
  return content.map((item) => {
    if (item?.type === 'text' || item?.type === 'input_text') return { text: String(item.text || '') };
    if (item?.type === 'image_url' && String(item.image_url?.url || '').startsWith('data:')) {
      const [header, data] = String(item.image_url.url).split(',', 2);
      return { inlineData: { mimeType: header.slice(5).split(';')[0], data } };
    }
    return { text: '' };
  });
}

export function normalizeProvider(provider: string): string {
  const value = String(provider || 'openai-compatible').toLowerCase().replace(/_/g, '-');
  if (value === 'lmstudio') return 'lm-studio';
  if (value === 'google') return 'gemini';
  if (value === 'custom-http') return 'openai-compatible';
  return value;
}

export function providerRequest(config: ProviderAdapterConfig, request: ProviderGenerateRequest): { url: string; headers: Record<string, string>; body: any; kind: string } {
  const provider = normalizeProvider(config.provider);
  const endpoint = trimSlash(config.endpoint);
  if (provider === 'anthropic') {
    const system = request.messages.filter((item) => item.role === 'system').map((item) => textContent(item.content)).filter(Boolean).join('\n\n');
    return {
      kind: 'anthropic-messages',
      url: `${endpoint}/messages`,
      headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01', ...(config.apiKey ? { 'x-api-key': config.apiKey } : {}) },
      body: {
        model: request.model,
        max_tokens: request.maxTokens,
        temperature: request.temperature,
        ...(system ? { system } : {}),
        messages: request.messages.filter((item) => item.role !== 'system').map((item) => ({ role: item.role === 'assistant' ? 'assistant' : 'user', content: anthropicContent(item.content) })),
      },
    };
  }
  if (provider === 'gemini') {
    const system = request.messages.filter((item) => item.role === 'system').map((item) => textContent(item.content)).filter(Boolean).join('\n\n');
    const model = encodeURIComponent(request.model);
    return {
      kind: 'gemini-generate-content',
      url: `${endpoint}/models/${model}:generateContent${config.apiKey ? `?key=${encodeURIComponent(config.apiKey)}` : ''}`,
      headers: { 'content-type': 'application/json' },
      body: {
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        contents: request.messages.filter((item) => item.role !== 'system').map((item) => ({ role: item.role === 'assistant' ? 'model' : 'user', parts: geminiParts(item.content) })),
        generationConfig: { temperature: request.temperature, maxOutputTokens: request.maxTokens, responseMimeType: 'application/json' },
      },
    };
  }
  if (provider === 'openai') {
    return {
      kind: 'openai-responses',
      url: `${endpoint}/responses`,
      headers: { 'content-type': 'application/json', ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}) },
      body: {
        model: request.model,
        input: request.messages,
        temperature: request.temperature,
        max_output_tokens: request.maxTokens,
        text: { format: { type: 'json_object' } },
      },
    };
  }
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (config.apiKey) {
    if (provider === 'azure-openai') headers['api-key'] = config.apiKey;
    else headers.Authorization = `Bearer ${config.apiKey}`;
  }
  return {
    kind: provider === 'azure-openai' ? 'azure-openai-chat' : 'openai-chat',
    url: `${endpoint}/chat/completions`,
    headers,
    body: {
      model: request.model,
      messages: request.messages,
      temperature: request.temperature,
      max_tokens: request.maxTokens,
      response_format: { type: 'json_object' },
      ...(request.disableThinking ? { reasoning_effort: 'none', chat_template_kwargs: { enable_thinking: false } } : {}),
    },
  };
}

export function normalizeProviderResponse(kind: string, data: any, headers: any = {}): NormalizedProviderResult {
  if (kind === 'anthropic-messages') {
    const input = Number(data?.usage?.input_tokens || 0);
    const output = Number(data?.usage?.output_tokens || 0);
    return { content: (data?.content || []).filter((item: any) => item?.type === 'text').map((item: any) => item.text).join('\n').trim(), raw: data, usage: { promptTokens: input, completionTokens: output, totalTokens: input + output, cachedTokens: Number(data?.usage?.cache_read_input_tokens || 0), reasoningTokens: 0 }, model: data?.model, finishReason: data?.stop_reason, requestId: headers?.['request-id'] };
  }
  if (kind === 'gemini-generate-content') {
    const usage = data?.usageMetadata || {};
    const input = Number(usage.promptTokenCount || 0);
    const output = Number(usage.candidatesTokenCount || 0);
    return { content: (data?.candidates?.[0]?.content?.parts || []).map((item: any) => item?.text || '').join('\n').trim(), raw: data, usage: { promptTokens: input, completionTokens: output, totalTokens: Number(usage.totalTokenCount || input + output), cachedTokens: Number(usage.cachedContentTokenCount || 0), reasoningTokens: Number(usage.thoughtsTokenCount || 0) }, model: data?.modelVersion, finishReason: data?.candidates?.[0]?.finishReason, requestId: headers?.['x-request-id'] };
  }
  if (kind === 'openai-responses') {
    const usage = data?.usage || {};
    const content = data?.output_text || (data?.output || []).flatMap((item: any) => item?.content || []).filter((item: any) => item?.type === 'output_text').map((item: any) => item.text).join('\n');
    const input = Number(usage.input_tokens || 0);
    const output = Number(usage.output_tokens || 0);
    return { content: String(content || '').trim(), raw: data, usage: { promptTokens: input, completionTokens: output, totalTokens: Number(usage.total_tokens || input + output), cachedTokens: Number(usage.input_tokens_details?.cached_tokens || 0), reasoningTokens: Number(usage.output_tokens_details?.reasoning_tokens || 0) }, model: data?.model, finishReason: data?.status, requestId: data?.id || headers?.['x-request-id'] };
  }
  const usage = data?.usage || {};
  const input = Number(usage.prompt_tokens || 0);
  const output = Number(usage.completion_tokens || 0);
  return { content: String(data?.choices?.[0]?.message?.content || '').trim(), raw: data, usage: { promptTokens: input, completionTokens: output, totalTokens: Number(usage.total_tokens || input + output), cachedTokens: Number(usage.prompt_tokens_details?.cached_tokens || 0), reasoningTokens: Number(usage.completion_tokens_details?.reasoning_tokens || 0) }, model: data?.model, finishReason: data?.choices?.[0]?.finish_reason, requestId: data?.id || headers?.['x-request-id'] };
}

export function normalizeProviderError(error: any): ProviderRequestError {
  const status = Number(error?.response?.status || 0) || undefined;
  const category = status === 401 ? 'authentication_failed' : status === 403 ? 'permission_denied' : status === 402 ? 'payment_required' : status === 429 ? 'rate_limited' : status && status >= 500 ? 'provider_unavailable' : error?.code === 'ECONNABORTED' ? 'timeout' : error?.code ? 'network_error' : 'invalid_response';
  const retryAfter = Number(error?.response?.headers?.['retry-after'] || 0);
  return new ProviderRequestError(`Proveedor IA: ${category}`, category, status, retryAfter > 0 ? retryAfter * 1000 : undefined, error?.response?.data);
}

export async function generateWithProvider(config: ProviderAdapterConfig, request: ProviderGenerateRequest): Promise<NormalizedProviderResult> {
  const prepared = providerRequest(config, request);
  try {
    const response = await axios.post(prepared.url, prepared.body, { headers: prepared.headers, timeout: config.timeoutMs, maxRedirects: 0 });
    return normalizeProviderResponse(prepared.kind, response.data, response.headers);
  } catch (error: any) {
    throw normalizeProviderError(error);
  }
}
