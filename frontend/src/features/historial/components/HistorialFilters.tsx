import { Button, Card, Col, Form, Row } from 'react-bootstrap'
import { Filter, RotateCcw } from 'lucide-react'
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
  return (
    <Card className="border-0 shadow-sm rounded-3 bg-white p-3 mb-3">
      <div className="d-flex align-items-center gap-2 fw-bold text-muted small mb-3">
        <Filter size={16} /> Filtros avanzados
      </div>
      <Row className="g-2">
        <Col md={3}>
          <Form.Control size="sm" placeholder="Caso, codigo o titulo" value={filters.case_query} onChange={event => onUpdateFilter('case_query', event.target.value)} />
        </Col>
        <Col md={2}>
          <Form.Control size="sm" placeholder="Codigo exacto" value={filters.case_code} onChange={event => onUpdateFilter('case_code', event.target.value)} />
        </Col>
        <Col md={3}>
          <Form.Select size="sm" value={filters.build_id} onChange={event => onUpdateFilter('build_id', event.target.value)}>
            <option value="">Todas las builds</option>
            {buildsList.map((build: any) => <option key={build.id} value={build.id}>{build.name || build.nombre}</option>)}
          </Form.Select>
        </Col>
        <Col md={2}>
          <Form.Select size="sm" value={filters.component_id} onChange={event => onUpdateFilter('component_id', event.target.value)}>
            <option value="">Componentes</option>
            {componentsList.map((component: any) => <option key={component.id} value={component.id}>{component.name || component.nombre}</option>)}
          </Form.Select>
        </Col>
        <Col md={2}>
          <Form.Select size="sm" value={filters.status} onChange={event => onUpdateFilter('status', event.target.value)}>
            <option value="">Estados</option>
            <option value="PASO">PASO</option>
            <option value="FALLO">FALLO</option>
            <option value="BLOQUEADO">BLOQUEADO</option>
            <option value="SIN_CORRER">SIN CORRER</option>
          </Form.Select>
        </Col>
        <Col md={2}>
          <Form.Select size="sm" value={filters.origin} onChange={event => onUpdateFilter('origin', event.target.value)}>
            <option value="">Origen del run</option>
            <option value="MANUAL">Manual</option>
            <option value="AUTOMATIZADA">Automatizada</option>
            <option value="IA">IA</option>
          </Form.Select>
        </Col>
        <Col md={2}>
          <Form.Select size="sm" value={filters.runner_id} onChange={event => onUpdateFilter('runner_id', event.target.value)}>
            <option value="">Ejecutor</option>
            {appUsers.map((user: any) => <option key={user.id} value={user.id}>{user.name || user.nombre_completo || user.email}</option>)}
          </Form.Select>
        </Col>
        <Col md={2}>
          <Form.Select size="sm" value={filters.environment_id} onChange={event => onUpdateFilter('environment_id', event.target.value)}>
            <option value="">Ambiente</option>
            {environments.map((env: any) => <option key={env.id} value={env.id}>{env.name || env.nombre}</option>)}
          </Form.Select>
        </Col>
        <Col md={2}>
          <Form.Select size="sm" value={filters.dataset_id} onChange={event => onUpdateFilter('dataset_id', event.target.value)}>
            <option value="">Dataset</option>
            {datasets.map((dataset: any) => <option key={dataset.id} value={dataset.id}>{dataset.name || dataset.nombre} ({dataset.environmentName})</option>)}
          </Form.Select>
        </Col>
        <Col md={2}>
          <Form.Control size="sm" type="number" min={1} placeholder="Version ejecutada" value={filters.version_executed} onChange={event => onUpdateFilter('version_executed', event.target.value)} />
        </Col>
        <Col md={2}>
          <Form.Control size="sm" type="date" value={filters.date_from} onChange={event => onUpdateFilter('date_from', event.target.value)} />
        </Col>
        <Col md={2}>
          <Form.Control size="sm" type="date" value={filters.date_to} onChange={event => onUpdateFilter('date_to', event.target.value)} />
        </Col>
        <Col md={2}>
          <Form.Select size="sm" value={filters.has_evidence} onChange={event => onUpdateFilter('has_evidence', event.target.value)}>
            <option value="">Evidencias</option>
            <option value="true">Solo con evidencia</option>
            <option value="false">Sin evidencia</option>
          </Form.Select>
        </Col>
        <Col md={2}>
          <Form.Select size="sm" value={filters.ai_review_status} onChange={event => onUpdateFilter('ai_review_status', event.target.value)}>
            <option value="">Revision IA</option>
            <option value="REQUIERE_REVISION">Pendiente</option>
            <option value="REVISADA">Revisada</option>
            <option value="NO_REQUIERE_REVISION">Sin revision</option>
          </Form.Select>
        </Col>
        <Col md={2}>
          <Button variant="outline-secondary" size="sm" className="w-100 d-flex align-items-center justify-content-center gap-2" onClick={onResetFilters}>
            <RotateCcw size={14} /> Limpiar filtros
          </Button>
        </Col>
      </Row>
    </Card>
  )
}
