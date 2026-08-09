import { Button, Card, Col, Form, Row } from 'react-bootstrap'
import { Filter, RotateCcw } from 'lucide-react'
import { useI18n } from '../../../i18n'
import type { HistorialFilters as HistorialFiltersState } from '../types/historial'

type Props = {
  filters: HistorialFiltersState
  buildsList: any[]
  componentsList: any[]
  environments: any[]
  appUsers: any[]
  datasets: any[]
  onUpdateFilter: (key: string, value: any) => void
  onResetFilters: () => void
}

export function HistorialFilters({
  filters,
  buildsList,
  componentsList,
  environments,
  appUsers,
  datasets,
  onUpdateFilter,
  onResetFilters,
}: Props) {
  const { t } = useI18n()
  return (
    <Card className="border-0 shadow-sm rounded-3 bg-white p-3 mb-3">
      <div className="d-flex align-items-center gap-2 fw-bold text-muted small mb-3">
        <Filter size={16} /> {t('historial.advancedFilters')}
      </div>
      <Row className="g-2">
        <Col md={3}>
          <Form.Control name="a11y-historialfilterstsx-35" aria-label="Campo de formulario" size="sm" placeholder={t('historial.searchCase')} value={filters.case_query} onChange={event => onUpdateFilter('case_query', event.target.value)} />
        </Col>
        <Col md={2}>
          <Form.Control name="a11y-historialfilterstsx-38" aria-label="Campo de formulario" size="sm" placeholder={t('historial.exactCode')} value={filters.case_code} onChange={event => onUpdateFilter('case_code', event.target.value)} />
        </Col>
        <Col md={3}>
          <Form.Select name="a11y-historialfilterstsx-41" aria-label="Campo de formulario" size="sm" value={filters.build_id} onChange={event => onUpdateFilter('build_id', event.target.value)}>
            <option value="">{t('historial.allBuilds')}</option>
            {buildsList.map((build: any) => <option key={build.id} value={build.id}>{build.name || build.nombre}</option>)}
          </Form.Select>
        </Col>
        <Col md={2}>
          <Form.Select name="a11y-historialfilterstsx-47" aria-label="Campo de formulario" size="sm" value={filters.component_id} onChange={event => onUpdateFilter('component_id', event.target.value)}>
            <option value="">{t('historial.components')}</option>
            {componentsList.map((component: any) => <option key={component.id} value={component.id}>{component.name || component.nombre}</option>)}
          </Form.Select>
        </Col>
        <Col md={2}>
          <Form.Select name="a11y-historialfilterstsx-53" aria-label="Campo de formulario" size="sm" value={filters.status} onChange={event => onUpdateFilter('status', event.target.value)}>
            <option value="">{t('historial.statuses')}</option>
            <option value="PASO">{t('historial.pass')}</option>
            <option value="FALLO">{t('historial.fail')}</option>
            <option value="BLOQUEADO">{t('historial.blocked')}</option>
            <option value="SIN_CORRER">{t('historial.notRun')}</option>
          </Form.Select>
        </Col>
        <Col md={2}>
          <Form.Select name="a11y-historialfilterstsx-62" aria-label="Campo de formulario" size="sm" value={filters.origin} onChange={event => onUpdateFilter('origin', event.target.value)}>
            <option value="">{t('historial.runOrigin')}</option>
            <option value="MANUAL">{t('historial.manual')}</option>
            <option value="AUTOMATIZADA">{t('historial.automated')}</option>
            <option value="IA">{t('historial.ia')}</option>
          </Form.Select>
        </Col>
        <Col md={2}>
          <Form.Select name="a11y-historialfilterstsx-70" aria-label="Campo de formulario" size="sm" value={filters.runner_id} onChange={event => onUpdateFilter('runner_id', event.target.value)}>
            <option value="">{t('historial.executor')}</option>
            {appUsers.map((user: any) => <option key={user.id} value={user.id}>{user.name || user.nombre_completo || user.email}</option>)}
          </Form.Select>
        </Col>
        <Col md={2}>
          <Form.Select name="a11y-historialfilterstsx-76" aria-label="Campo de formulario" size="sm" value={filters.environment_id} onChange={event => onUpdateFilter('environment_id', event.target.value)}>
            <option value="">{t('historial.environmentFilter')}</option>
            {environments.map((env: any) => <option key={env.id} value={env.id}>{env.name || env.nombre}</option>)}
          </Form.Select>
        </Col>
        <Col md={2}>
          <Form.Select name="a11y-historialfilterstsx-82" aria-label="Campo de formulario" size="sm" value={filters.dataset_id} onChange={event => onUpdateFilter('dataset_id', event.target.value)}>
            <option value="">{t('historial.datasetFilter')}</option>
            {datasets.map((dataset: any) => <option key={dataset.id} value={dataset.id}>{dataset.name || dataset.nombre} ({dataset.environmentName})</option>)}
          </Form.Select>
        </Col>
        <Col md={2}>
          <Form.Control name="a11y-historialfilterstsx-88" aria-label="Campo de formulario" size="sm" type="number" min={1} placeholder={t('historial.executedVersion')} value={filters.version_executed} onChange={event => onUpdateFilter('version_executed', event.target.value)} />
        </Col>
        <Col md={3}>
          <fieldset className="history-date-range border-0 p-0 m-0">
            <div className="row g-1">
              <Col>
                <Form.Label htmlFor="historial-date-from" className="app-label text-muted mb-1">{t('historial.from')}</Form.Label>
                <Form.Control id="historial-date-from" size="sm" type="date" aria-label={t('historial.dateFromAria')} value={filters.date_from} onChange={event => onUpdateFilter('date_from', event.target.value)} />
              </Col>
              <Col>
                <Form.Label htmlFor="historial-date-to" className="app-label text-muted mb-1">{t('historial.to')}</Form.Label>
                <Form.Control id="historial-date-to" size="sm" type="date" aria-label={t('historial.dateToAria')} value={filters.date_to} onChange={event => onUpdateFilter('date_to', event.target.value)} />
              </Col>
            </div>
          </fieldset>
        </Col>
        <Col md={2}>
          <Form.Select name="a11y-historialfilterstsx-105" aria-label="Campo de formulario" size="sm" value={filters.has_evidence} onChange={event => onUpdateFilter('has_evidence', event.target.value)}>
            <option value="">{t('historial.evidence')}</option>
            <option value="true">{t('historial.withEvidence')}</option>
            <option value="false">{t('historial.withoutEvidence')}</option>
          </Form.Select>
        </Col>
        <Col md={2}>
          <Form.Select name="a11y-historialfilterstsx-112" aria-label="Campo de formulario" size="sm" value={filters.ai_review_status} onChange={event => onUpdateFilter('ai_review_status', event.target.value)}>
            <option value="">{t('historial.iaReview')}</option>
            <option value="REQUIERE_REVISION">{t('historial.pendingReview')}</option>
            <option value="REVISADA">{t('historial.reviewed')}</option>
            <option value="NO_REQUIERE_REVISION">{t('historial.noReview')}</option>
          </Form.Select>
        </Col>
        <Col md={2}>
          <Button variant="outline-secondary" size="sm" className="w-100 d-flex align-items-center justify-content-center gap-2" onClick={onResetFilters}>
            <RotateCcw size={14} /> {t('historial.clearFilters')}
          </Button>
        </Col>
      </Row>
    </Card>
  )
}
