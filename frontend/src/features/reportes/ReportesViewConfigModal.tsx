import { Badge, Button, Card, Col, Form, Modal, Row, Tab, Tabs } from 'react-bootstrap'
import { RotateCcw, Save, SlidersHorizontal } from 'lucide-react'
import type { TranslationKey } from '../../i18n'
import type { ReportesViewConfig } from './reportesViewConfig'
import {
  REPORTES_HISTORICAL_SECTIONS,
  REPORTES_STANDARD_SECTIONS,
  REPORTES_VIEW_AI_BLOCKS,
  REPORTES_VIEW_COLUMNS,
  REPORTES_VIEW_KPIS,
} from './reportesViewConfig'

type ToggleGroup = 'sections' | 'kpis' | 'aiBlocks'
type ToggleItem = { id: string; label?: string }

type ReportesViewConfigModalProps = {
  show: boolean
  onHide: () => void
  viewDraft: ReportesViewConfig
  saving: boolean
  t: (key: TranslationKey) => string
  applyViewPreset: (preset: 'all' | 'summary' | 'default') => void
  countDraftEnabled: (items: ToggleItem[], group: ToggleGroup) => number
  setDraftGroupValues: (items: ToggleItem[], group: ToggleGroup, value: boolean) => void
  setDraftGroupValue: (group: ToggleGroup, id: string, value: boolean) => void
  countDraftColumnsEnabled: (table: string, columns: ToggleItem[]) => number
  setDraftColumnTableValues: (table: string, columns: ToggleItem[], value: boolean) => void
  setDraftColumnValue: (table: string, column: string, value: boolean) => void
  resetLayout: () => void
  saveLayout: () => void
  saveView: () => void
}

export function ReportesViewConfigModal({
  show,
  onHide,
  viewDraft,
  saving,
  t,
  applyViewPreset,
  countDraftEnabled,
  setDraftGroupValues,
  setDraftGroupValue,
  countDraftColumnsEnabled,
  setDraftColumnTableValues,
  setDraftColumnValue,
  resetLayout,
  saveLayout,
  saveView,
}: ReportesViewConfigModalProps) {
  return (
    <Modal show={show} onHide={onHide} centered size="xl" scrollable>
      <Modal.Header closeButton className="border-0 pb-2">
        <Modal.Title className="fw-bold d-flex align-items-center gap-2">
          <SlidersHorizontal size={20} /> {t('reportes.viewConfigTitle')}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body className="pt-0">
        <div className="d-flex flex-wrap gap-2 mb-4">
          <Button variant="outline-primary" size="sm" onClick={() => applyViewPreset('all')}>Mostrar todo</Button>
          <Button variant="outline-secondary" size="sm" onClick={() => applyViewPreset('summary')}>Vista resumida</Button>
          <Button variant="outline-success" size="sm" onClick={() => applyViewPreset('all')}>Vista QA completa</Button>
          <Button variant="outline-dark" size="sm" onClick={() => applyViewPreset('default')}>Restaurar predeterminado</Button>
        </div>
        <Tabs defaultActiveKey="sections" className="report-view-config-tabs mb-3">
          <Tab eventKey="sections" title={<span className="d-inline-flex align-items-center gap-2">Vista <Badge bg="light" text="dark" className="border">{countDraftEnabled(REPORTES_STANDARD_SECTIONS, 'sections') + countDraftEnabled(REPORTES_HISTORICAL_SECTIONS, 'sections')}</Badge></span>}>
            <Row className="g-3">
              <Col lg={7}>
                <Card className="border shadow-none h-100"><Card.Body>
                  <div className="d-flex justify-content-between align-items-start gap-3 mb-3"><div><h6 className="fw-bold text-secondary mb-1">{t('reportes.mainSections')}</h6><div className="small text-muted">{t('reportes.mainSectionsDescription')}</div></div><Badge bg="light" text="dark" className="border flex-shrink-0">{countDraftEnabled(REPORTES_STANDARD_SECTIONS, 'sections')} / {REPORTES_STANDARD_SECTIONS.length}</Badge></div>
                  <div className="d-flex gap-2 mb-3"><Button variant="outline-secondary" size="sm" onClick={() => setDraftGroupValues(REPORTES_STANDARD_SECTIONS, 'sections', true)}>{t('reportes.enableAll')}</Button><Button variant="outline-secondary" size="sm" onClick={() => setDraftGroupValues(REPORTES_STANDARD_SECTIONS, 'sections', false)}>{t('reportes.disableAll')}</Button></div>
                  <Row className="g-2">{REPORTES_STANDARD_SECTIONS.map((section) => <Col md={6} key={section.id}><div className="border rounded-3 px-3 py-2 h-100 bg-light"><Form.Check type="switch" id={`report-view-section-${section.id}`} label={t(`reportes.${section.label}`)} checked={viewDraft.sections[section.id] !== false} onChange={(event) => setDraftGroupValue('sections', section.id, event.target.checked)} /></div></Col>)}</Row>
                </Card.Body></Card>
              </Col>
              <Col lg={5}>
                <Card className="border shadow-none h-100"><Card.Body>
                  <div className="d-flex justify-content-between align-items-start gap-3 mb-3"><div><h6 className="fw-bold text-secondary mb-1">{t('reportes.historicalTrends')}</h6><div className="small text-muted">{t('reportes.historicalTrendsDescription')}</div></div><Badge bg="light" text="dark" className="border flex-shrink-0">{countDraftEnabled(REPORTES_HISTORICAL_SECTIONS, 'sections')} / {REPORTES_HISTORICAL_SECTIONS.length}</Badge></div>
                  <div className="d-flex flex-column gap-2">{REPORTES_HISTORICAL_SECTIONS.map((section) => <div className="border rounded-3 px-3 py-2 bg-light" key={section.id}><Form.Check type="switch" id={`report-view-historical-${section.id}`} label={t(`reportes.${section.label}`)} checked={viewDraft.sections[section.id] !== false} onChange={(event) => setDraftGroupValue('sections', section.id, event.target.checked)} /></div>)}</div>
                </Card.Body></Card>
              </Col>
            </Row>
          </Tab>
          <Tab eventKey="kpis" title={<span className="d-inline-flex align-items-center gap-2">KPIs <Badge bg="light" text="dark" className="border">{countDraftEnabled(REPORTES_VIEW_KPIS, 'kpis')}</Badge></span>}>
            <Card className="border shadow-none"><Card.Body>
              <div className="d-flex justify-content-between align-items-start gap-3 mb-3"><div><h6 className="fw-bold text-secondary mb-1">{t('reportes.kpis')}</h6><div className="small text-muted">{t('reportes.kpisDescription')}</div></div><Badge bg="light" text="dark" className="border flex-shrink-0">{countDraftEnabled(REPORTES_VIEW_KPIS, 'kpis')} / {REPORTES_VIEW_KPIS.length}</Badge></div>
              <div className="d-flex gap-2 mb-3"><Button variant="outline-secondary" size="sm" onClick={() => setDraftGroupValues(REPORTES_VIEW_KPIS, 'kpis', true)}>{t('reportes.enableAll')}</Button><Button variant="outline-secondary" size="sm" onClick={() => setDraftGroupValues(REPORTES_VIEW_KPIS, 'kpis', false)}>{t('reportes.disableAll')}</Button></div>
              <Row className="g-2">{REPORTES_VIEW_KPIS.map((kpi) => <Col md={4} key={kpi.id}><div className="border rounded-3 px-3 py-2 h-100 bg-light"><Form.Check type="switch" id={`report-view-kpi-${kpi.id}`} label={t(`reportes.${kpi.label}`)} checked={viewDraft.kpis[kpi.id] !== false} onChange={(event) => setDraftGroupValue('kpis', kpi.id, event.target.checked)} /></div></Col>)}</Row>
            </Card.Body></Card>
          </Tab>
          <Tab eventKey="ai" title={<span className="d-inline-flex align-items-center gap-2">IA <Badge bg="light" text="dark" className="border">{countDraftEnabled(REPORTES_VIEW_AI_BLOCKS, 'aiBlocks')}</Badge></span>}>
            <Card className="border shadow-none"><Card.Body>
              <div className="d-flex justify-content-between align-items-start gap-3 mb-3"><div><h6 className="fw-bold text-secondary mb-1">{t('reportes.aiBlocks')}</h6><div className="small text-muted">{t('reportes.aiBlocksDescription')}</div></div><Badge bg="light" text="dark" className="border flex-shrink-0">{countDraftEnabled(REPORTES_VIEW_AI_BLOCKS, 'aiBlocks')} / {REPORTES_VIEW_AI_BLOCKS.length}</Badge></div>
              <Row className="g-2">{REPORTES_VIEW_AI_BLOCKS.map((block) => <Col md={6} key={block.id}><div className="border rounded-3 px-3 py-2 h-100 bg-light"><Form.Check type="switch" id={`report-view-ai-${block.id}`} label={t(`reportes.${block.label}`)} checked={viewDraft.aiBlocks[block.id] !== false} onChange={(event) => setDraftGroupValue('aiBlocks', block.id, event.target.checked)} /></div></Col>)}</Row>
            </Card.Body></Card>
          </Tab>
          <Tab eventKey="columns" title={t('reportes.columns')}>
            <Row className="g-3">{Object.entries(REPORTES_VIEW_COLUMNS).map(([table, config]) => <Col md={6} xl={4} key={table}><Card className="border shadow-none h-100"><Card.Body>
              <div className="d-flex justify-content-between align-items-start gap-2 mb-3"><div><h6 className="fw-bold mb-1">{t(`reportes.${config.label}`)}</h6><div className="x-small text-muted">{t('reportes.columnsDescription')}</div></div><Badge bg="light" text="dark" className="border flex-shrink-0">{countDraftColumnsEnabled(table, config.columns)} / {config.columns.length}</Badge></div>
              <div className="d-flex gap-2 mb-3"><Button variant="outline-secondary" size="sm" onClick={() => setDraftColumnTableValues(table, config.columns, true)}>{t('reportes.enableAll')}</Button><Button variant="outline-secondary" size="sm" onClick={() => setDraftColumnTableValues(table, config.columns, false)}>{t('reportes.disableAll')}</Button></div>
              <div className="d-flex flex-column gap-2">{config.columns.map((column) => <div className="border rounded-3 px-3 py-2 bg-light" key={column.id}><Form.Check type="switch" id={`report-view-column-${table}-${column.id}`} label={t(`reportes.${column.label}`)} checked={viewDraft.columns?.[table]?.[column.id] !== false} onChange={(event) => setDraftColumnValue(table, column.id, event.target.checked)} /></div>)}</div>
            </Card.Body></Card></Col>)}</Row>
          </Tab>
        </Tabs>
      </Modal.Body>
      <Modal.Footer className="border-0 pt-0">
        <Button variant="outline-secondary" onClick={resetLayout} disabled={saving}><RotateCcw size={14} className="me-1" /> {t('reportes.restoreLayout')}</Button>
        <Button variant="outline-success" onClick={saveLayout} disabled={saving}><Save size={14} className="me-1" /> {t('reportes.saveLayout')}</Button>
        <Button variant="outline-secondary" onClick={onHide} disabled={saving}>{t('reportes.cancel')}</Button>
        <Button variant="primary" onClick={saveView} disabled={saving}>{saving ? t('reportes.saving') : t('reportes.saveView')}</Button>
      </Modal.Footer>
    </Modal>
  )
}
