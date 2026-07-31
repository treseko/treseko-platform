import { PremiumGate } from '../premium/PremiumGate'

export function SharedReportPremiumNotice({ enabled, reportSnapshotsEnabled, isSectionVisible, hasSystemFeature, t }: any) {
  return (
    <>
{enabled && !reportSnapshotsEnabled && isSectionVisible('sharedHistory') && (
    <PremiumGate
      feature="reports.snapshots"
      hasFeature={hasSystemFeature}
          title={t('reportes.sharedHistoryTitle')}
      description={t('reportes.sharedHistoryPremiumDescription')}
      mode="card"
      className="mb-4"
    />
  )}
    </>
  )
}
