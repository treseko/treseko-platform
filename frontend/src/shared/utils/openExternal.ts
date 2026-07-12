const SAFE_DATA_IMAGE_RE = /^data:image\/(?:png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i

export const normalizeExternalUrl = (url?: string | null) => {
  const target = (url || '').trim()
  if (!target) return ''
  if (target.startsWith('//')) return ''
  if (SAFE_DATA_IMAGE_RE.test(target)) return target
  try {
    const parsed = new URL(target, window.location.origin)
    const sameOriginRelative = target.startsWith('/') && !target.startsWith('//')
    if (sameOriginRelative) return parsed.href
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'blob:') {
      return parsed.href
    }
  } catch (error) {
    return ''
  }
  return ''
}

export const openInNewTab = (url?: string | null) => {
  const target = normalizeExternalUrl(url)
  if (!target) return null

  const opened = window.open(target, '_blank', 'noopener,noreferrer')
  if (opened) {
    opened.opener = null
  }
  return opened
}
