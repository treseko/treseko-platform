export type EvidenceAvailability = {
  available?: boolean
  missing_reason?: string | null
  missingReason?: string | null
}

export const isEvidenceAvailable = (item?: EvidenceAvailability | null) => item?.available !== false

export const getEvidenceMissingReason = (item?: EvidenceAvailability | null) =>
  item?.missing_reason || item?.missingReason || 'Archivo no disponible en storage'
