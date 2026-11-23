import { Button, Spinner } from 'react-bootstrap'
import { DownloadCloud } from 'lucide-react'

export function LegacyMigrationBundleDownloadNotice({ t, downloadMigrationBundle, requestingPackageDownload }: {
  t: (key: string) => string
  downloadMigrationBundle: () => void
  requestingPackageDownload: boolean
}) {
  return (
    <div className="mt-3">
      <div className="mb-2">{t('configuracion.updateMigrationBundleHelp')}</div>
      <Button variant="outline-primary" size="sm" onClick={downloadMigrationBundle} disabled={requestingPackageDownload}>
        {requestingPackageDownload ? <Spinner size="sm" className="me-2" /> : <DownloadCloud size={14} className="me-2" />}
        {t('configuracion.updateMigrationBundleDownload')}
      </Button>
    </div>
  )
}
