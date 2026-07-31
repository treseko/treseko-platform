import { useState } from 'react'
import { Button, Modal, Spinner } from 'react-bootstrap'
import { RotateCcw, Terminal } from 'lucide-react'
import { BuildCaseSelector } from '../../BuildCaseSelector'
import { useI18n } from '../../i18n'
import { isBuildReadOnly } from '../../app/buildState'

type BuildCasesModalProps = {
  show: boolean
  onHide: () => void
  buildsList: any[]
  editingBuildCasesId: string | null
  currentAuthoringCases: any[]
  lockedBuildCaseIds: Record<string, string[]>
  buildCaseDraftIds: string[]
  setBuildCaseDraftIds: (ids: string[]) => void
  suitesTree: any[]
  buildCaseSearch: string
  setBuildCaseSearch: (query: string) => void
  saveBuildCases: () => void
  assignPreviousFailedCases: (buildId?: string | null) => Promise<void> | void
}

export function BuildCasesModal({
  show,
  onHide,
  buildsList,
  editingBuildCasesId,
  currentAuthoringCases,
  lockedBuildCaseIds,
  buildCaseDraftIds,
  setBuildCaseDraftIds,
  suitesTree,
  buildCaseSearch,
  setBuildCaseSearch,
  saveBuildCases,
  assignPreviousFailedCases
}: BuildCasesModalProps) {
  const { t } = useI18n()
  const [loadingPreviousFailures, setLoadingPreviousFailures] = useState(false)
  const build = buildsList.find(item => item.id === editingBuildCasesId)
  const readOnlyBuild = isBuildReadOnly(build)
  const availableCases = currentAuthoringCases.filter(test => !build?.componentId || test.componentId === build.componentId)
  const lockedIds = editingBuildCasesId ? lockedBuildCaseIds[editingBuildCasesId] || [] : []

  const handleAssignPreviousFailedCases = async () => {
    if (!editingBuildCasesId || loadingPreviousFailures) return
    setLoadingPreviousFailures(true)
    try {
      await assignPreviousFailedCases(editingBuildCasesId)
    } finally {
      setLoadingPreviousFailures(false)
    }
  }

  return (
    <Modal show={show} onHide={onHide} centered size="lg">
      <Modal.Header closeButton className="bg-light border-bottom text-dark">
        <Modal.Title className="fw-bold fs-5 text-dark d-flex align-items-center gap-2">
          <Terminal size={20} className="text-primary" /> {t('proyectos.relatedCases')}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body className="p-4 text-start">
        <div className="d-flex justify-content-between align-items-start gap-3 mb-3 flex-wrap">
          <div>
            <div className="fw-bold text-dark">{build?.name || 'Build'}</div>
            <div className="small text-muted">{t('proyectos.casesHint')}</div>
          </div>
          <div className="d-flex gap-2 flex-wrap justify-content-end">
            {availableCases.length > 0 && (
              <Button
                variant="outline-primary"
                size="sm"
                className="rounded-pill fw-bold shadow-none"
                onClick={() => setBuildCaseDraftIds(availableCases.map(test => test.id))}
                disabled={readOnlyBuild}
              >
                {t('proyectos.assignAll')}
              </Button>
            )}
            <Button
              variant="outline-danger"
              size="sm"
              className="rounded-pill fw-bold shadow-none d-inline-flex align-items-center gap-2"
              onClick={handleAssignPreviousFailedCases}
              disabled={!editingBuildCasesId || loadingPreviousFailures || readOnlyBuild}
              title={t('proyectos.previousFailuresTitle')}
            >
              {loadingPreviousFailures ? <Spinner animation="border" size="sm" /> : <RotateCcw size={14} />}
              {t('proyectos.previousFailures')}
            </Button>
          </div>
        </div>
        {readOnlyBuild && (
          <div className="alert alert-info border-0 small mb-3">
            Esta build histórica está en modo consulta. El alcance y sus casos no se pueden modificar.
          </div>
        )}
        {buildCaseDraftIds.length === 0 && availableCases.length > 0 && (
          <div className="alert alert-warning border-0 small mb-3">
            {t('proyectos.noCasesAdded')}
          </div>
        )}
        {lockedIds.length > 0 && (
          <div className="alert alert-info border-0 small mb-3">
            {t('proyectos.lockedCases', { count: lockedIds.length })}
          </div>
        )}
        <BuildCaseSelector
          suitesTree={suitesTree}
          casosList={currentAuthoringCases}
          componentId={build?.componentId || null}
          selectedCaseIds={buildCaseDraftIds}
          onSelectionChange={setBuildCaseDraftIds}
          readOnly={readOnlyBuild}
          lockedCaseIds={lockedIds}
          searchQuery={buildCaseSearch}
          onSearchChange={setBuildCaseSearch}
        />
      </Modal.Body>
      <Modal.Footer className="bg-light border-top-0 px-4 pb-4">
        <Button variant="outline-secondary" className="fw-bold shadow-none rounded-pill px-4" onClick={onHide}>{t('proyectos.cancel')}</Button>
        <Button variant="primary" className="fw-bold shadow-sm rounded-pill px-4" onClick={saveBuildCases} disabled={readOnlyBuild}>{t('proyectos.saveScope')}</Button>
      </Modal.Footer>
    </Modal>
  )
}
