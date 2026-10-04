export type ReleaseNoteGroup = {
  title: string
  items: string[]
}

const stripMarkdown = (value: string) => value
  .replace(/\*\*/g, '')
  .replace(/`/g, '')
  .trim()

export function parseLatestReleaseNotes(changelog: unknown, version: string | undefined): ReleaseNoteGroup[] {
  if (typeof changelog !== 'string' || !version?.trim()) return []

  const lines = changelog.replace(/\r\n?/g, '\n').split('\n')
  const versionHeading = new RegExp(`^#\\s+.*${version.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\b`, 'i')
  const start = lines.findIndex(line => versionHeading.test(line.trim()))
  if (start < 0) return []

  const groups: ReleaseNoteGroup[] = []
  let current: ReleaseNoteGroup | null = null
  for (const rawLine of lines.slice(start + 1)) {
    const line = rawLine.trim()
    if (/^#\s+/.test(line)) break
    if (!line) continue

    const category = line.match(/^##\s+(.+)$/)
    if (category) {
      current = { title: stripMarkdown(category[1]), items: [] }
      groups.push(current)
      continue
    }

    const bullet = line.match(/^[-*]\s+(.+)$/)
    if (bullet) {
      if (!current) {
        current = { title: 'Cambios', items: [] }
        groups.push(current)
      }
      current.items.push(stripMarkdown(bullet[1]))
      continue
    }

    if (current?.items.length) {
      current.items[current.items.length - 1] = `${current.items[current.items.length - 1]} ${stripMarkdown(line)}`
    }
  }

  return groups.filter(group => group.items.length > 0)
}
