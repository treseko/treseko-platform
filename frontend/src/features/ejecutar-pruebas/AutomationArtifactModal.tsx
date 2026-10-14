import { EvidenceViewerModal } from '../../shared/components/EvidenceViewerModal'

export function AutomationArtifactModal({ options }: { options: any }) {
  const { show, selectedArtifact, setSelectedArtifact } = options
  return <EvidenceViewerModal evidence={show && selectedArtifact ? { url: selectedArtifact.href, filename: selectedArtifact.filename, contentType: selectedArtifact.contentType } : null} onHide={() => setSelectedArtifact(null)} />
}
