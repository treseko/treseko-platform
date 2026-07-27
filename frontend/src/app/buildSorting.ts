import { dateTimeMs } from '../shared/utils/dateTime'

const buildVersion = (value: unknown) => {
  const match = String(value || '').trim().match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+](.*))?$/i)
  if (!match) return null
  const prerelease = (match[4] || '').toLowerCase()
  const rank = prerelease ? (prerelease.startsWith('alpha') ? 1 : prerelease.startsWith('beta') ? 2 : prerelease.startsWith('rc') ? 3 : 4) : 5
  return { major: Number(match[1]), minor: Number(match[2] || 0), patch: Number(match[3] || 0), rank, prerelease, prereleaseParts: prerelease ? prerelease.split(/[.-]|(?<=\D)(?=\d)|(?<=\d)(?=\D)/) : [] }
}

export const sortBuildsNewestFirst = (builds: any[]) => builds.slice().sort((a, b) => {
  const versionA = buildVersion(a.name || a.code)
  const versionB = buildVersion(b.name || b.code)
  if (versionA && versionB) {
    for (const key of ['major', 'minor', 'patch', 'rank'] as const) {
      if (versionA[key] !== versionB[key]) return versionB[key] - versionA[key]
    }
    if (versionA.prerelease !== versionB.prerelease) {
      const partsA = versionA.prereleaseParts
      const partsB = versionB.prereleaseParts
      for (let index = 0; index < Math.max(partsA.length, partsB.length); index += 1) {
        if (index >= partsA.length) return -1
        if (index >= partsB.length) return 1
        const numericA = /^\d+$/.test(partsA[index])
        const numericB = /^\d+$/.test(partsB[index])
        if (numericA && numericB && Number(partsA[index]) !== Number(partsB[index])) return Number(partsB[index]) - Number(partsA[index])
        if (numericA !== numericB) return numericA ? -1 : 1
        if (partsA[index] !== partsB[index]) return partsB[index].localeCompare(partsA[index])
      }
    }
  } else if (versionA || versionB) return versionA ? -1 : 1
  const dateA = dateTimeMs(a.createdAt) || 0
  const dateB = dateTimeMs(b.createdAt) || 0
  if (dateA !== dateB) return dateB - dateA
  return String(b.id || '').localeCompare(String(a.id || ''))
})
