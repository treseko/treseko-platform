import { Alert, Button } from 'react-bootstrap'

type ScriptFailureDetails = {
  testTitle: string
  message: string
  location: { file: string; line: number; column: number | null; context?: string; workerLocation?: { file: string; line: number; column: number | null; context?: string } } | null
} | null

export function ScriptFailureSummary({ failure, video, onViewVideo, t }: {
  failure: ScriptFailureDetails
  video?: { href: string; filename?: string; contentType?: string } | null
  onViewVideo: (video: { href: string; filename?: string; contentType?: string }) => void
  t: (key: any) => string
}) {
  if (!failure) return null
  return (
    <Alert variant="danger" className="mb-2">
      <div className="fw-bold mb-1">{t('ejecutarPruebas.scriptFailureTitle')}</div>
      {failure.testTitle && <div className="small mb-1">{failure.testTitle}</div>}
      {failure.message && <div className="small font-monospace text-break mb-1">{failure.message}</div>}
      {failure.location && <>
        <div className="small">{t('ejecutarPruebas.scriptLine')}: <span className="font-monospace">{failure.location.line}</span>{failure.location.context ? ` · ${failure.location.context}` : ''}</div>
        {failure.location.workerLocation && <div className="small text-muted font-monospace">{t('ejecutarPruebas.workerLocation')}: {failure.location.workerLocation.file}:{failure.location.workerLocation.line}{failure.location.workerLocation.column ? `:${failure.location.workerLocation.column}` : ''}</div>}
        {!failure.location.workerLocation && <div className="small text-muted font-monospace">{failure.location.file}:{failure.location.line}{failure.location.column ? `:${failure.location.column}` : ''}</div>}
      </>}
      {video?.href && <Button variant="outline-danger" size="sm" className="mt-2" onClick={() => onViewVideo(video)}>{t('ejecutarPruebas.viewExecutionVideo')}</Button>}
    </Alert>
  )
}
