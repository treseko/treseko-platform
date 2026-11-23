import { Button, Spinner } from 'react-bootstrap'
import { DownloadCloud } from 'lucide-react'

export function NativeWorkerBootstrapDownloadNotice({ t, latestUpdate, availableVersion, preparePackageDownload, requestingPackageDownload, packageDownload }: { t: any, latestUpdate: any, availableVersion: string, preparePackageDownload: () => void, requestingPackageDownload: boolean, packageDownload: any }) {
  return (
    <div className="mt-3">
      <div className="mb-2">{t('configuracion.updatePackageBootstrapHelp')}</div>
      <Button variant="outline-primary" size="sm" className="fw-bold" onClick={preparePackageDownload} disabled={requestingPackageDownload || !latestUpdate?.manifest}>
        {requestingPackageDownload ? <Spinner size="sm" className="me-2" /> : <DownloadCloud size={14} className="me-2" />}
        {t('configuracion.updatePackageDownloadButton')}
      </Button>
      {packageDownload?.download_url && packageDownload?.version === availableVersion && (
        <div className="border rounded-3 bg-white p-3 mt-3">
          <a href={packageDownload.download_url} target="_blank" rel="noreferrer" className="fw-bold">
            {t('configuracion.updatePackageDownloadLink', { artifact: packageDownload.artifact || `treseko-update-v${packageDownload.version}.tar.gz` })}
          </a>
          {packageDownload.expires_at && <div className="x-small text-muted mt-2">{t('configuracion.updatePackageGrantExpires', { date: new Date(packageDownload.expires_at).toLocaleString() })}</div>}
          <div className="x-small text-muted mt-2 text-break">SHA-256: {packageDownload.checksum_sha256}</div>
        </div>
      )}
    </div>
  )
}
