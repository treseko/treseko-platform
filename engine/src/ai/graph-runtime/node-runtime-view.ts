type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

function firstRecord(...values: unknown[]): UnknownRecord | undefined {
  for (const value of values) {
    const candidate = record(value);
    if (candidate) return candidate;
  }
  return undefined;
}

/**
 * Builds aliases consumed by legacy handlers without changing the canonical
 * persisted contract. Canonical top-level persisted values always win.
 */
export function hydratePersistedNodeRuntimeView<T extends UnknownRecord>(node: T): T {
  const universal = record(node.universal_agent ?? node.universalAgent);
  const contract = record(universal?.contract);
  const implementation = record(contract?.implementation);
  const instructions = record(contract?.instructions ?? contract?.prompt);
  const execution = record(contract?.execution ?? contract?.runtime);
  const nodeConfig = record(node.config_json ?? node.config);

  const prompt = firstString(
    node.prompt_template,
    node.prompt,
    node.system_prompt,
    node.systemPrompt,
    nodeConfig?.prompt_template,
    nodeConfig?.prompt,
    instructions?.prompt_template,
    instructions?.prompt,
    instructions?.system_prompt,
  );

  const config = firstRecord(
    node.config_json,
    node.config,
    execution?.config,
    implementation?.config,
  ) ?? {};

  const mutable = node as UnknownRecord;
  if (prompt) {
    if (mutable.prompt_template === undefined) mutable.prompt_template = prompt;
    if (mutable.prompt === undefined) mutable.prompt = prompt;
    if (mutable.system_prompt === undefined) mutable.system_prompt = prompt;
  }
  if (mutable.config_json === undefined) mutable.config_json = config;
  if (mutable.config === undefined) mutable.config = config;

  mutable.runtime_effective = {
    ...(record(mutable.runtime_effective) ?? {}),
    native_adapter: firstString(
      implementation?.native_adapter,
      implementation?.nativeAdapter,
    ),
    prompt,
    config,
    input_mapping: node.input_mapping ?? node.inputMapping ?? contract?.input_mapping,
    output_mapping: node.output_mapping ?? node.outputMapping ?? contract?.output_mapping,
    output_schema: node.output_schema ?? node.outputSchema ?? contract?.output_schema,
    retry_policy: node.retry_policy ?? node.retryPolicy ?? execution?.retry_policy,
    timeout_ms: node.timeout_ms ?? node.timeoutMs ?? execution?.timeout_ms,
  };
  return node;
}
