import { useState } from 'react'
import { ReportesPage } from '../features/reportes/ReportesPage'
import { EvidenceViewerModal, type EvidenceViewerItem } from '../shared/components/EvidenceViewerModal'

type ReportesRouteProps = any

export function ReportesRoute(props: ReportesRouteProps) {
  const [viewerEvidence, setViewerEvidence] = useState<EvidenceViewerItem | null>(null)
  if (props.activeTab !== 'reportes') return null

  const openEvidence = (attachmentOrUrl: any) => {
    if (typeof attachmentOrUrl === 'string') {
      setViewerEvidence({ url: attachmentOrUrl, filename: 'Evidencia adjunta', contentType: null })
      return
    }
    if (!attachmentOrUrl?.public_url) return
    setViewerEvidence({
      url: attachmentOrUrl.public_url,
      filename: attachmentOrUrl.filename_original,
      contentType: attachmentOrUrl.content_type,
      available: attachmentOrUrl.available,
      missing_reason: attachmentOrUrl.missing_reason,
    })
  }

  return (
    <>
    <ReportesPage
      metricsLoading={props.metricsLoading}
      projectMetrics={props.projectMetrics}
      expandedMetricSuites={props.expandedMetricSuites}
      setExpandedMetricSuites={props.setExpandedMetricSuites}
      loadProjectMetrics={props.loadProjectMetrics}
      showFeedback={props.showFeedback}
      fetchWithAuth={props.fetchWithAuth}
      currentProjectId={props.currentProjectId}
      currentBuildId={props.currentBuildId}
      onOpenHistorial={props.openHistorialRuns}
      onOpenBugTracker={props.onOpenBugTracker}
      onOpenEvidence={openEvidence}
      canAccessCapability={props.canAccessCapability}
      hasSystemFeature={props.hasSystemFeature}
      loggedUser={props.loggedUser}
      onPreferencesUpdated={props.onPreferencesUpdated}
    />
    <EvidenceViewerModal evidence={viewerEvidence} onHide={() => setViewerEvidence(null)} />
    </>
  )
}
