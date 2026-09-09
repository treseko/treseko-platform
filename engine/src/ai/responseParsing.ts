function cleanProviderMarkers(raw: string): string {
  return String(raw || '')
    .replace(/```(?:json)?/gi, '')
    // Gemma/LMS often wraps the answer in channel markers and puts an
    // example object inside its thought channel before the real answer.
    .replace(/<\|(channel|message|thought|analysis|assistant|user|end|eos)(?:\|)?>/gi, '\n')
    .trim()
}

function balancedJsonCandidates(value: string): string[] {
  const candidates: Array<{ start: number; end: number; text: string }> = []
  for (let start = 0; start < value.length; start++) {
    if (value[start] !== '{' && value[start] !== '[') continue
    const stack: string[] = []
    let inString = false
    let escaped = false
    for (let index = start; index < value.length; index++) {
      const character = value[index]
      if (inString) {
        if (escaped) escaped = false
        else if (character === '\\') escaped = true
        else if (character === '"') inString = false
        continue
      }
      if (character === '"') {
        inString = true
        continue
      }
      if (character === '{' || character === '[') stack.push(character)
      else if (character === '}' || character === ']') {
        const expected = character === '}' ? '{' : '['
        if (stack[stack.length - 1] !== expected) break
        stack.pop()
        if (stack.length === 0) {
          candidates.push({ start, end: index + 1, text: value.slice(start, index + 1) })
          break
        }
      }
    }
  }
  return candidates
    .filter((candidate) => !candidates.some((other) => (
      other !== candidate && other.start <= candidate.start && other.end >= candidate.end
    )))
    .sort((left, right) => left.start - right.start)
    .map((candidate) => candidate.text)
}

function parsePartialDecision(jsonPart: string): any | undefined {
  const statusMatch = jsonPart.match(/"status"\s*:\s*"(.*?)"/s)
  const reasonMatch = jsonPart.match(/"reason"\s*:\s*"(.*?)"/s)
  const confidenceMatch = jsonPart.match(/"confidence"\s*:\s*(\d+)/)
  if (!statusMatch && !reasonMatch) return undefined
  return {
    status: statusMatch?.[1] || 'FAILED',
    reason: reasonMatch?.[1] || 'Error de parseo parcial',
    confidence: parseInt(confidenceMatch?.[1] || '0'),
    approved: jsonPart.includes('"approved": true'),
    action: 'error',
  }
}

export function parseAIJson(raw: string): any {
  const cleanRaw = cleanProviderMarkers(raw)
  const candidates = balancedJsonCandidates(cleanRaw).reverse()
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate)
    } catch {
      const partial = parsePartialDecision(candidate)
      if (partial) return partial
    }
  }

  try {
    return JSON.parse(cleanRaw)
  } catch (error) {
    const trimmed = cleanRaw.trim()
    if (trimmed.startsWith('{') && !trimmed.endsWith('}')) {
      try { return JSON.parse(trimmed + '"}') } catch {}
      try { return JSON.parse(trimmed + '}') } catch {}
    }
    throw error
  }
}
