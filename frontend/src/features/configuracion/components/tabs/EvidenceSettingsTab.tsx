import { useEffect, useState } from 'react'
import { Card } from 'react-bootstrap'
import { useI18n } from '../../../../i18n'
import { fetchEvidenceSanitizationPolicy, updateEvidenceSanitizationPolicy } from '../../api/configuracionApi'
import { AttachmentSettings } from './AttachmentSettings'
import type { AttachmentMimeGroup, AttachmentMimeOption } from '../../hooks/useAttachmentMimeOptions'

type Props = {
  attachmentConfig: any
  setAttachmentConfig: (config: any) => void
  attachmentConfigLoading: boolean
  saveAttachmentConfig: (config: any) => void
  attachmentMimeGroups: AttachmentMimeGroup[]
  toggleAttachmentMime: (option: AttachmentMimeOption, checked: boolean) => void
  canAccessCapability: (capabilityId: any, level?: any) => boolean
  fetchWithAuth: (url: string, options?: any) => Promise<Response>
}

export function EvidenceSettingsTab({ canAccessCapability, fetchWithAuth, ...props }: Props) {
  const { t } = useI18n()
  const [evidencePolicy, setEvidencePolicy] = useState({ sanitization_enabled: true, traceability_complete_enabled: false })
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let mounted = true
    setLoading(true)
    void fetchEvidenceSanitizationPolicy(fetchWithAuth)
      .then(data => {
        if (mounted) {
          setEvidencePolicy({
            sanitization_enabled: Boolean(data?.sanitization_enabled ?? true),
            traceability_complete_enabled: Boolean(data?.traceability_complete_enabled ?? !data?.sanitization_enabled),
          })
        }
      })
      .catch(() => undefined)
      .finally(() => { if (mounted) setLoading(false) })
    return () => { mounted = false }
  }, [fetchWithAuth])

  const saveEvidencePolicy = async (traceabilityEnabled: boolean) => {
    const nextPolicy = { sanitization_enabled: !traceabilityEnabled, traceability_complete_enabled: traceabilityEnabled }
    setSaving(true)
    try {
      const data = await updateEvidenceSanitizationPolicy(fetchWithAuth, nextPolicy)
      setEvidencePolicy({
        sanitization_enabled: Boolean(data?.sanitization_enabled ?? nextPolicy.sanitization_enabled),
        traceability_complete_enabled: Boolean(data?.traceability_complete_enabled ?? nextPolicy.traceability_complete_enabled),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="animate__animated animate__fadeIn">
      <Card className="border-0 shadow-sm rounded-4 bg-white p-4">
        <h5 className="fw-bold text-dark mb-1">{t('configuracion.evidenceSectionTitle')}</h5>
        <p className="small text-muted mb-0">{t('configuracion.evidenceSectionDesc')}</p>
      </Card>
      <AttachmentSettings
        t={t}
        {...props}
        canEditAttachments={canAccessCapability('configuracion.adjuntos', 'edit')}
        canManageEvidenceSanitization={canAccessCapability('settings.evidence_sanitization.manage', 'edit')}
        evidencePolicy={evidencePolicy}
        evidencePolicyLoading={loading}
        evidencePolicySaving={saving}
        saveEvidencePolicy={saveEvidencePolicy}
      />
    </div>
  )
}
