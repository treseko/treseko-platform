export function parseAIJson(raw: string): any {
  try {
    const cleanRaw = raw.replace(/```json/g, '').replace(/```/g, '').trim()
    const firstBrace = cleanRaw.indexOf('{')
    const lastBrace = cleanRaw.lastIndexOf('}')

    if (firstBrace !== -1 && lastBrace !== -1) {
      let jsonPart = cleanRaw.substring(firstBrace, lastBrace + 1)
      jsonPart = jsonPart.replace(/"reason":\s*"(.*?)"/gs, (match, p1) => (
        `"reason": "${p1.replace(/\n/g, '\\n').replace(/"/g, '\\"')}"`
      ))

      try {
        return JSON.parse(jsonPart)
      } catch (error) {
        const statusMatch = jsonPart.match(/"status":\s*"(.*?)"/)
        const reasonMatch = jsonPart.match(/"reason":\s*"(.*?)"/)
        const confidenceMatch = jsonPart.match(/"confidence":\s*(\d+)/)
        if (statusMatch || reasonMatch) {
          return {
            status: statusMatch?.[1] || 'FAILED',
            reason: reasonMatch?.[1] || 'Error de parseo parcial',
            confidence: parseInt(confidenceMatch?.[1] || '0'),
            approved: jsonPart.includes('"approved": true'),
            action: 'error',
          }
        }
        throw error
      }
    }
    return JSON.parse(cleanRaw)
  } catch (error) {
    const trimmed = raw.trim()
    if (trimmed.startsWith('{') && !trimmed.endsWith('}')) {
      try { return JSON.parse(trimmed + '"}') } catch {}
      try { return JSON.parse(trimmed + '}') } catch {}
    }
    const jsonMatch = raw.match(/\{[\s\S]*\}|\[[\s\S]*\]/)
    if (jsonMatch) return JSON.parse(jsonMatch[0])
    throw error
  }
}
