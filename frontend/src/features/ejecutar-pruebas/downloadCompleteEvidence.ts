type DownloadOptions = {
  jobId: string
  url: string
  apiBase: string
  fetchWithAuth: (url: string) => Promise<Response>
  document?: Document
  urlApi?: Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'>
  defer?: (task: () => void) => unknown
}

export async function downloadCompleteEvidence(options: DownloadOptions) {
  const match = /^\/automation-jobs\/([a-f0-9-]{36})\/complete-evidence\/[a-f0-9-]{36}$/i.exec(options.url)
  if (!match || match[1].toLowerCase() !== options.jobId.toLowerCase()) {
    throw new Error('Invalid evidence download route')
  }
  const response = await options.fetchWithAuth(`${options.apiBase.replace(/\/$/, '')}${options.url}`)
  if (!response.ok) throw new Error('Evidence download failed')
  const blob = await response.blob()
  const dom = options.document ?? document
  const urlApi = options.urlApi ?? URL
  const objectUrl = urlApi.createObjectURL(blob)
  const anchor = dom.createElement('a')
  anchor.href = objectUrl
  anchor.download = `automation-${options.jobId}.json`
  dom.body.appendChild(anchor)
  try { anchor.click() } finally {
    anchor.remove()
    ;(options.defer ?? ((task) => setTimeout(task, 1000)))(() => urlApi.revokeObjectURL(objectUrl))
  }
}
