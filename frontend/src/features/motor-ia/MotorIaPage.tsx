import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Row, Col, Card, Badge, Button, ListGroup, Alert, Spinner } from 'react-bootstrap'
import { Cpu, LayoutList, PlugZap, Settings, X } from 'lucide-react'
import { API_BASE } from '../../app/constants'
import { AiExecutionReportModal } from './AiExecutionReportModal'
import { WorkspaceContextEmptyState } from '../../shared/components/WorkspaceContextEmptyState'
import { useI18n } from '../../i18n'
import { MotorIaView } from './MotorIaView'
import { useMotorIaMonitorState } from './useMotorIaMonitorState'
import { getStatusMeta } from './motorIaUtils'
export type { AiEngineHealthState, IaExecutionStream, IaLogEntry, IaQueueItem, IaRunStatus, MotorIaTranslator } from './motorIaTypes'
import type { IaExecutionStream, IaLogEntry } from './motorIaTypes'

type MotorIaPageProps = {
  currentProjectId?: string | null
  iaStatus: 'idle' | 'running' | string
  iaLogs: Array<IaLogEntry | string>
  setIaLogs: (updater: any) => void
  currentProjectIaQueue: string[]
  iaExecutionStreams: IaExecutionStream[]
  setIaExecutionStreams: (updater: any) => void
  setIaQueue: (updater: any) => void
  currentProjectCases: any[]
  fetchWithAuth: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  showFeedback: (title: string, message: string, variant?: 'success' | 'danger' | 'warning' | 'info') => void
  setActiveTab: (tab: any) => void
  setConfigTab: (tab: any) => void
  canAccessCapability?: (capabilityId: any, level?: any) => boolean
  hasSystemFeature?: (featureId: string) => boolean
}


export function MotorIaPage({
  currentProjectId,
  iaStatus,
  iaLogs,
  setIaLogs,
  currentProjectIaQueue,
  iaExecutionStreams,
  setIaExecutionStreams,
  setIaQueue,
  currentProjectCases,
  fetchWithAuth,
  showFeedback,
  setActiveTab,
  setConfigTab,
  canAccessCapability,
  hasSystemFeature,
}: MotorIaPageProps) {
  const { t } = useI18n()
  const statusMeta = getStatusMeta(t)
  const canUseCapability = canAccessCapability || (() => true)
  const featureEnabled = hasSystemFeature || (() => true)
  const canViewStatus = canUseCapability('motor_ia.ver', 'read')
  const canEditConfig = canUseCapability('motor_ia.configuracion', 'edit')
  const canViewLogs = canUseCapability('motor_ia.logs', 'read')
  const canViewWorkflows = canUseCapability('motor_ia.workflows', 'read')
  const hasAiEngine = featureEnabled('ai.engine') || featureEnabled('ai.basic_execution')

  const monitor = useMotorIaMonitorState({
    options: {
      currentProjectId,
      t,
      fetchWithAuth,
      showFeedback,
      canViewStatus,
      iaStatus,
      iaLogs,
      setIaLogs,
      currentProjectIaQueue,
      iaExecutionStreams,
      setIaExecutionStreams,
      setIaQueue,
      currentProjectCases,
    },
  })

  if (!currentProjectId) {
    return (
      <WorkspaceContextEmptyState
        message={t('motorIa.noProjectSelected')}
        detail={t('motorIa.noProjectDetail')}
      />
    )
  }

  return <MotorIaView options={{
    ...monitor,
    t, canEditConfig, canViewLogs, canViewStatus, canViewWorkflows,
    setActiveTab, setConfigTab, setIaQueue, setIaExecutionStreams, setIaLogs,
    iaStatus, iaExecutionStreams, currentProjectIaQueue, hasAiEngine,
  }} />
}
