import { Badge, Button, Card, Col, Form, Modal, Row, Tab, Tabs } from 'react-bootstrap'
import { SlidersHorizontal } from 'lucide-react'
import {
  PROJECT_REPORT_SECTION_GROUPS,
  PROJECT_REPORT_SETTING_GROUPS,
  PROJECT_REPORT_TYPE_META,
  type ProjectReportType,
} from './reportesViewConfig'

type ProjectReportSettingsModalProps = {
  show: boolean
  saving: boolean
  draft: any
  t: (key: string) => string
  countEnabled: (reportType: ProjectReportType) => number
  setAllSections: (reportType: ProjectReportType, value: boolean) => void
  setSection: (reportType: ProjectReportType, sectionId: string, value: boolean) => void
  onHide: () => void
  onSave: () => void
}

export function ProjectReportSettingsModal({
  show,
  saving,
  draft,
  t,
  countEnabled,
  setAllSections,
  setSection,
  onHide,
  onSave,
}: ProjectReportSettingsModalProps) {
  return (
    <Modal show={show} onHide={onHide} centered size="lg" scrollable>
      <Modal.Header closeButton>
        <Modal.Title className="fw-bold d-flex align-items-center gap-2">
          <SlidersHorizontal size={20} /> {t('reportes.configureProjectReports')}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body className="pt-0">
        <div className="border rounded-3 bg-light p-3 mb-3 small text-muted">{t('reportes.projectSettingsDescription')}</div>
        <Tabs defaultActiveKey="executive" className="mb-3">
          {(Object.keys(PROJECT_REPORT_SETTING_GROUPS) as ProjectReportType[]).map((reportType) => (
            <Tab key={reportType} eventKey={reportType} title={<span className="d-inline-flex align-items-center gap-2">{t(`reportes.${PROJECT_REPORT_TYPE_META[reportType].label}`)}<Badge bg="light" text="dark" className="border">{countEnabled(reportType)}</Badge></span>}>
              <div className="d-flex justify-content-between align-items-center mb-3">
                <div><h6 className="fw-bold mb-1">{t(`reportes.${PROJECT_REPORT_TYPE_META[reportType].title}`)}</h6><div className="small text-muted">{t(`reportes.${PROJECT_REPORT_TYPE_META[reportType].description}`)}</div></div>
                <div className="d-flex gap-2"><Button variant="outline-secondary" size="sm" onClick={() => setAllSections(reportType, true)}>{t('reportes.enableAll')}</Button><Button variant="outline-secondary" size="sm" onClick={() => setAllSections(reportType, false)}>{t('reportes.disableAll')}</Button></div>
              </div>
              <Row className="g-3">{PROJECT_REPORT_SECTION_GROUPS.map((group) => {
                const sections = PROJECT_REPORT_SETTING_GROUPS[reportType].filter((section) => section.group === group.id)
                if (!sections.length) return null
                const enabledCount = sections.filter((section) => draft?.[reportType]?.sections?.[section.id] !== false).length
                return <Col lg={4} md={6} key={group.id}><Card className="border shadow-none h-100"><Card.Body>
                  <div className="d-flex justify-content-between align-items-start gap-2 mb-3"><h6 className="fw-bold text-secondary mb-0">{t(`reportes.${group.label}`)}</h6><Badge bg="light" text="dark" className="border flex-shrink-0">{enabledCount} / {sections.length}</Badge></div>
                  <div className="d-flex flex-column gap-2">{sections.map((section) => <div className="border rounded-3 px-3 py-2 bg-light" key={section.id}><Form.Check type="switch" id={`project-report-${reportType}-${section.id}`} label={t(`reportes.${section.label}`)} checked={draft?.[reportType]?.sections?.[section.id] !== false} onChange={(event) => setSection(reportType, section.id, event.target.checked)} /></div>)}</div>
                </Card.Body></Card></Col>
              })}</Row>
            </Tab>
          ))}
        </Tabs>
        <div className="small text-muted">{t('reportes.developmentReportDescription')}</div>
      </Modal.Body>
      <Modal.Footer className="border-0 pt-0">
        <Button variant="outline-secondary" onClick={onHide} disabled={saving}>{t('reportes.cancel')}</Button>
        <Button variant="primary" onClick={onSave} disabled={saving}>{saving ? t('reportes.saving') : t('reportes.saveSettings')}</Button>
      </Modal.Footer>
    </Modal>
  )
}
