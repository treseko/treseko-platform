import { useState } from 'react'
import { HistorialRunsPage } from '../features/historial/HistorialRunsPage'
import { EvidenceViewerModal, type EvidenceViewerItem } from '../shared/components/EvidenceViewerModal'

type HistorialRouteProps = any

export function HistorialRoute(props: HistorialRouteProps) {
  const [viewerEvidence, setViewerEvidence] = useState<EvidenceViewerItem | null>(null)
  if (props.activeTab !== 'historial') return null
  const canAccessCapability = props.canAccessCapability || (() => true)
  const canViewDetail = canAccessCapability('historial.detalle', 'read')
  const canViewEvidence = canAccessCapability('historial.evidencias', 'read')
  const canReviewIa = canAccessCapability('ejecutar.ia', 'edit')

  const openEvidence = (attachment: any) => {
    if (!canViewEvidence) return
    if (!attachment?.public_url) return
    setViewerEvidence({
      url: attachment.public_url,
      filename: attachment.filename_original,
      contentType: attachment.content_type,
      available: attachment.available,
      missing_reason: attachment.missing_reason,
    })
  }

  return (
    <>
    <HistorialRunsPage
      currentProjectRunHistory={props.currentProjectRunHistory}
      getStatusColor={props.getStatusColor}
      buildsList={props.buildsList}
      componentsList={props.componentsList}
      environments={props.currentProjectEnvironments}
      appUsers={props.appUsers}
      initialFilters={props.historialInitialFilters}
      pendingRunDetailId={props.pendingHistorialRunDetailId}
      onPendingRunDetailConsumed={() => props.setPendingHistorialRunDetailId('')}
      onLoadHistory={props.loadProjectRunHistory}
      onLoadRunDetail={props.loadTestRunDetail}
      onMarkAiReviewed={canReviewIa ? props.markHistorialAiReviewed : undefined}
      onOpenEvidence={openEvidence}
      canViewDetail={canViewDetail}
      canViewEvidence={canViewEvidence}
      fetchWithAuth={props.fetchWithAuth}
      showFeedback={props.showFeedback}
      canAccessCapability={props.canAccessCapability}
      setActiveTab={props.setActiveTab}
    />
    <EvidenceViewerModal evidence={viewerEvidence} onHide={() => setViewerEvidence(null)} />
    </>
  )
}
