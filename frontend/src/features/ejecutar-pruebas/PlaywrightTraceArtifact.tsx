import { useState } from 'react'
import { Button, Spinner } from 'react-bootstrap'
import { Download } from 'lucide-react'

type Props = {
  artifact: any
  href: string
  t: (key: string) => string
  fetchWithAuth: (url: string) => Promise<Response>
  onOpen: (trace: { blob: Blob; filename: string }) => void
  onError: (message: string) => void
}

export function PlaywrightTraceArtifact({ artifact, href, t, fetchWithAuth, onOpen, onError }: Props) {
  const [loading, setLoading] = useState(false)
  const filename = artifact.filename || 'trace.zip'

  return <>
    <div className="small text-muted mb-2">{t('ejecutarPruebas.traceViewerHelp')}</div>
    <div className="d-grid gap-1">
      <Button variant="outline-primary" size="sm" className="x-small" disabled={loading} onClick={async () => {
        setLoading(true)
        try {
          const response = await fetchWithAuth(href)
          if (!response.ok) throw new Error('trace')
          onOpen({ blob: await response.blob(), filename })
        } catch {
          onError(t('ejecutarPruebas.traceLoadFailed'))
        } finally {
          setLoading(false)
        }
      }}>
        {loading ? <><Spinner size="sm" className="me-1" />{t('ejecutarPruebas.traceLoading')}</> : t('ejecutarPruebas.openTraceViewer')}
      </Button>
      <a href={href} download={filename} className="btn btn-outline-secondary btn-sm x-small">
        <Download size={13} className="me-1" aria-hidden="true" />{t('ejecutarPruebas.downloadTrace')}
      </a>
    </div>
  </>
}
