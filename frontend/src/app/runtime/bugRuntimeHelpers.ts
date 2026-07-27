import type { AttachmentMeta } from '../../EvidenceUpload'
import { normalizeExecutionHistory } from '../../features/ejecucion/executionUtils'

export function isFailureStatus(status?: string) {
  return ['FALLO', 'FALLIDO', 'BLOQUEADO'].includes(String(status || '').toUpperCase())
}

export function isExecutionHistoryItemFromBuild(item: any, buildId?: string | null) {
  if (!buildId) return false
  const itemBuildId = item?.buildId || item?.build_id || null
  return Boolean(itemBuildId) && String(itemBuildId) === String(buildId)
}

export function getLatestFailureExecutionContext(test: any, buildId?: string | null, currentBuildOnly = false) {
  const latest = normalizeExecutionHistory(test)[0]
  const failure = latest && isFailureStatus(latest.status) ? latest : null
  const scopedFailure = failure && (!currentBuildOnly || isExecutionHistoryItemFromBuild(failure, buildId)) ? failure : null
  return {
    executionId: scopedFailure?.executionId || scopedFailure?.execution_id || scopedFailure?.id || null,
    snapshotId: scopedFailure?.snapshotId || scopedFailure?.snapshot_id || null,
    note: scopedFailure?.observation || null,
    historyItem: scopedFailure || null,
  }
}

export function uniqueAttachmentList(attachments: AttachmentMeta[] = []) {
  const seen = new Set<string>()
  return attachments.filter((attachment) => {
    const id = String(attachment?.id || '')
    if (!id || seen.has(id)) return false
    seen.add(id)
    return true
  })
}

export function attachmentIds(attachments: AttachmentMeta[] = []) {
  return uniqueAttachmentList(attachments).map((item) => String(item.id))
}
