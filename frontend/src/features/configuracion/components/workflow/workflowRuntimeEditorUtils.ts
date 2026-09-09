type AnyRecord = Record<string, any>
type PortValue = string | { id?: string; name?: string; key?: string }

function asRecord(value: unknown): AnyRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as AnyRecord : {}
}

export function effectiveNodePrompt(node: AnyRecord): string {
  const instructions = asRecord(node.universal_agent?.contract?.instructions ?? node.universalAgent?.contract?.instructions)
  return String(
    node.prompt_template
      ?? node.prompt
      ?? node.system_prompt
      ?? node.config_json?.prompt
      ?? instructions.user_instructions
      ?? instructions.objective
      ?? '',
  )
}

export function nodeTimeoutSeconds(node: AnyRecord): number {
  const seconds = Number(node.timeout_sec ?? node.timeoutSec)
  if (Number.isFinite(seconds) && seconds > 0) return seconds
  const milliseconds = Number(node.timeout_ms ?? node.timeoutMs ?? node.config_json?.timeout_ms)
  if (Number.isFinite(milliseconds) && milliseconds > 0) return Math.max(1, Math.ceil(milliseconds / 1000))
  return 30
}

function portName(port: PortValue): string {
  if (typeof port === 'string') return port.trim()
  return String(port?.id ?? port?.name ?? port?.key ?? '').trim()
}

export function mergeControlPorts(...sources: unknown[]): string[] {
  const values = sources.flatMap(source => Array.isArray(source) ? source : []) as PortValue[]
  return Array.from(new Set(values.map(portName).filter(Boolean)))
}

export function controlOutputPorts(node: AnyRecord | null | undefined, immutableContractOnly = false): string[] {
  if (!node) return []
  const contractPorts = mergeControlPorts(
    node.universal_agent?.contract?.ports?.control_outputs,
    node.universalAgent?.contract?.ports?.controlOutputs,
  )
  return immutableContractOnly ? contractPorts : mergeControlPorts(
    contractPorts,
    node.output_ports,
    node.config_json?.output_ports,
  )
}

export function controlInputPorts(node: AnyRecord | null | undefined, immutableContractOnly = false): string[] {
  if (!node) return []
  const contractPorts = mergeControlPorts(
    node.universal_agent?.contract?.ports?.control_inputs,
    node.universalAgent?.contract?.ports?.controlInputs,
  )
  return immutableContractOnly ? contractPorts : mergeControlPorts(
    contractPorts,
    node.input_ports,
    node.config_json?.input_ports,
  )
}
