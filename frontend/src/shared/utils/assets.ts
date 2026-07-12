export const resolveAssetUrl = (url?: string | null) => {
  if (!url) return ''
  const value = url.trim()
  if (!value || value.startsWith('//') || /[\x00-\x1f\x7f]/.test(value)) return ''
  if (/^(https?:|blob:)/i.test(value)) return value
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return ''
  if (value.startsWith('/api/static/')) return value
  if (value.startsWith('/api/')) return ''
  if (value.startsWith('/static/')) {
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('qa_access_token') : ''
    const separator = value.includes('?') ? '&' : '?'
    return `/api${value}${token ? `${separator}asset_token=${encodeURIComponent(token)}` : ''}`
  }
  return value
}

export const isImageAsset = (item: { content_type?: string; public_url?: string } | string | null | undefined) => {
  if (!item) return false
  if (typeof item === 'string') return /\.(png|jpe?g|webp|gif)$/i.test(item)
  return item.content_type?.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(item.public_url || '')
}
