import type { AttachmentMeta } from "../EvidenceUpload";
import { CaseReferenceList } from "../features/ejecutar-pruebas/CaseReferenceList";

export function renderInternalBugCaseReferences(
  title: string,
  references: AttachmentMeta[] = [],
  onZoomImage: (src: string) => void,
) {
  return (
    <CaseReferenceList
      title={title}
      references={references}
      onZoomImage={onZoomImage}
    />
  );
}
