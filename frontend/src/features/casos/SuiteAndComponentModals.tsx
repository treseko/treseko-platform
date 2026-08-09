import type { Dispatch, FormEvent, SetStateAction } from 'react'
import { Button, Form, Modal } from 'react-bootstrap'
import { Bug, Database, FileCheck2, FolderCheck, FolderPlus, Folders, Globe2, Layers, LockKeyhole, Save, Search, Settings, ShieldCheck, Smartphone, Zap } from 'lucide-react'
import { useI18n } from '../../i18n'
import { SUITE_COLORS, SUITE_ICONS } from '../../app/constants'
import { RequiredLabel } from '../../shared/ui/RequiredLabel'
import { findSuiteById, flattenSuites } from '../../testRepositoryUtils'

const emptySuiteForm = { nombre: '', descripcion: '', parentId: '', color: '#F1F5F9', icono: 'folder' }

const suiteIconMap: Record<string, any> = {
  folder: Folders,
  'folder-check': FolderCheck,
  'file-check': FileCheck2,
  shield: ShieldCheck,
  bug: Bug,
  search: Search,
  globe: Globe2,
  smartphone: Smartphone,
  database: Database,
  lock: LockKeyhole,
  zap: Zap,
  settings: Settings,
}

type SuiteAndComponentModalsProps = {
  showAddFolderModal: boolean
  setShowAddFolderModal: (show: boolean) => void
  folderConfig: { parentId: string | null }
  suitesTree: any[]
  setSuiteForm: Dispatch<SetStateAction<any>>
  handleCreateSuite: (event: any) => void
  showSuiteModal: boolean
  setShowSuiteModal: (show: boolean) => void
  editingSuiteId: string | null
  setEditingSuiteId: (id: string | null) => void
  suiteForm: any
  handleUpdateSuite: (event: FormEvent<HTMLFormElement>) => void
  showMoveSuiteModal: boolean
  setShowMoveSuiteModal: (show: boolean) => void
  movingSuiteId: string | null
  setMovingSuiteId: (id: string | null) => void
  moveSuiteParentId: string
  setMoveSuiteParentId: (id: string) => void
  handleMoveSuite: () => void
  showComponentModal: boolean
  setShowComponentModal: (show: boolean) => void
  componentForm: any
  setComponentForm: Dispatch<SetStateAction<any>>
  handleSaveComponentForm: (event: FormEvent<HTMLFormElement>) => void
}

export function SuiteAndComponentModals({
  showAddFolderModal,
  setShowAddFolderModal,
  folderConfig,
  suitesTree,
  setSuiteForm,
  handleCreateSuite,
  showSuiteModal,
  setShowSuiteModal,
  editingSuiteId,
  setEditingSuiteId,
  suiteForm,
  handleUpdateSuite,
  showMoveSuiteModal,
  setShowMoveSuiteModal,
  movingSuiteId,
  setMovingSuiteId,
  moveSuiteParentId,
  setMoveSuiteParentId,
  handleMoveSuite,
  showComponentModal,
  setShowComponentModal,
  componentForm,
  setComponentForm,
  handleSaveComponentForm
}: SuiteAndComponentModalsProps) {
  const { t } = useI18n()
  const resetSuiteModal = () => {
    setShowSuiteModal(false)
    setEditingSuiteId(null)
    setSuiteForm(emptySuiteForm)
  }

  const resetMoveSuiteModal = () => {
    setShowMoveSuiteModal(false)
    setMovingSuiteId(null)
    setMoveSuiteParentId('')
  }

  const movingSuite = movingSuiteId ? findSuiteById(suitesTree, movingSuiteId) : null
  const movingDescendantIds = new Set(flattenSuites(movingSuite?.children || []).map((suite: any) => suite.id))
  const moveSuiteOptions = flattenSuites(suitesTree).filter((suite: any) => {
    if (!movingSuiteId || suite.id === movingSuiteId || movingDescendantIds.has(suite.id)) return false
    const movingComponentId = movingSuite?.componente_id || movingSuite?.componentId || ''
    const suiteComponentId = suite.componente_id || suite.componentId || ''
    return movingComponentId === suiteComponentId
  })

  const handleCreateFolder = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const name = (form.elements.namedItem('folderName') as HTMLInputElement | null)?.value
    const color = (form.elements.namedItem('color') as HTMLInputElement | null)?.value || '#F1F5F9'
    const icono = (form.elements.namedItem('icono') as HTMLSelectElement | null)?.value || 'folder'
    if (!name) return

    setSuiteForm({ nombre: name, descripcion: '', parentId: folderConfig.parentId || '', color, icono })
    handleCreateSuite(event)
    setShowAddFolderModal(false)
  }

  return (
    <>
      <Modal show={showAddFolderModal} onHide={() => setShowAddFolderModal(false)} centered backdrop="static" size="sm">
        <Modal.Header closeButton className="border-0 pb-0">
          <Modal.Title className="fw-bold fs-5 text-dark d-flex align-items-center gap-2">
            <FolderPlus size={20} className="text-primary" />
            {folderConfig.parentId ? t('casos.newSubsuite') : t('casos.newRootSuiteBtn')}
          </Modal.Title>
        </Modal.Header>
        <Form onSubmit={handleCreateFolder}>
          <Modal.Body className="pt-2">
            <input type="hidden" name="parentId" value={folderConfig.parentId || ''} />
            <input type="hidden" name="descripcion" value="" />
            {folderConfig.parentId && (
              <div className="text-muted x-small mb-3">
                {t('casos.createdWithin')} <strong className="text-dark">{findSuiteById(suitesTree, folderConfig.parentId)?.nombre}</strong>
              </div>
            )}
            <Form.Group>
              <Form.Label className="x-small fw-bold text-muted"><RequiredLabel required>{t('casos.folderName')}</RequiredLabel></Form.Label>
              <Form.Control name="folderName" autoFocus required placeholder={t('casos.folderNamePlaceholder')} className="bg-light shadow-none" />
            </Form.Group>
            <div className="row g-2 mt-2">
              <Form.Group className="col-5">
                <Form.Label className="x-small fw-bold text-muted">{t('casos.color')}</Form.Label>
                <Form.Control
                  name="color"
                  type="color"
                  defaultValue="#F1F5F9"
                  title={t('casos.folderColor')}
                  aria-label={t('casos.folderColor')}
                  style={{ height: 34, padding: 4 }}
                />
              </Form.Group>
              <Form.Group className="col-7">
                <Form.Label className="x-small fw-bold text-muted">{t('casos.icon')}</Form.Label>
                <Form.Select name="icono" defaultValue="folder" size="sm">
                  {SUITE_ICONS.map(item => (
                    <option key={item.id} value={item.id}>{item.label}</option>
                  ))}
                </Form.Select>
              </Form.Group>
            </div>
          </Modal.Body>
          <Modal.Footer className="border-0 pt-0">
            <Button variant="light" size="sm" className="fw-bold text-muted" onClick={() => setShowAddFolderModal(false)}>{t('common.cancel')}</Button>
            <Button variant="primary" size="sm" type="submit" className="fw-bold px-3 shadow-sm">{t('casos.createFolder')}</Button>
          </Modal.Footer>
        </Form>
      </Modal>

      <Modal show={showSuiteModal} onHide={resetSuiteModal} centered scrollable size="lg">
        <Modal.Header closeButton className="border-0 pb-2">
          <Modal.Title className="fw-bold fs-5 d-flex align-items-center gap-2">
            <FolderPlus size={20} className="text-primary" />
            {editingSuiteId ? t('casos.editSuite') : t('casos.newSuite')}
          </Modal.Title>
        </Modal.Header>
        <Form onSubmit={editingSuiteId ? handleUpdateSuite : handleCreateSuite}>
          <Modal.Body className="pt-0">
            <Form.Group className="mb-3">
              <Form.Label><RequiredLabel required>{t('casos.name')}</RequiredLabel></Form.Label>
              <Form.Control
                name="nombre"
                value={suiteForm.nombre}
                onChange={(e) => setSuiteForm({ ...suiteForm, nombre: e.target.value })}
                required
                placeholder={t('casos.suiteNamePlaceholder')}
              />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>{t('casos.suiteDescription')}</Form.Label>
              <Form.Control
                as="textarea"
                name="descripcion"
                value={suiteForm.descripcion}
                onChange={(e) => setSuiteForm({ ...suiteForm, descripcion: e.target.value })}
                rows={3}
                placeholder={t('casos.suiteDescriptionPlaceholder')}
              />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>{t('casos.mutedColor')}</Form.Label>
              <div className="d-flex gap-2 flex-wrap">
                {SUITE_COLORS.map(color => (
                  <button
                    key={color}
                    type="button"
                    className={`border rounded-2 shadow-none ${suiteForm.color === color ? 'border-primary border-2' : 'border-light-subtle'}`}
                    title={color}
                    onClick={() => setSuiteForm({ ...suiteForm, color })}
                    style={{ width: 34, height: 28, background: color }}
                  />
                ))}
              </div>
              <div className="d-flex align-items-center gap-2 mt-2">
                <Form.Control
                  type="color"
                  value={suiteForm.color || '#F1F5F9'}
                  onChange={(e) => setSuiteForm({ ...suiteForm, color: e.target.value })}
                  title={t('casos.customColor')}
                  aria-label={t('casos.customFolderColor')}
                  style={{ width: 46, height: 34, padding: 4 }}
                />
                <Form.Control name="a11y-suiteandcomponentmodalstsx-218" aria-label="Campo de formulario"
                  value={suiteForm.color || '#F1F5F9'}
                  onChange={(e) => setSuiteForm({ ...suiteForm, color: e.target.value })}
                  placeholder="#F1F5F9"
                  className="font-monospace"
                  maxLength={20}
                />
              </div>
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>{t('casos.folderIcon')}</Form.Label>
              <div className="d-flex gap-2 flex-wrap">
                {SUITE_ICONS.map(item => {
                  const Icon = suiteIconMap[item.id] || Folders
                  const selected = (suiteForm.icono || 'folder') === item.id
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={`btn btn-sm d-inline-flex align-items-center gap-2 ${selected ? 'btn-primary' : 'btn-outline-secondary'}`}
                      title={item.label}
                      aria-label={t('casos.useIcon', { label: item.label })}
                      onClick={() => setSuiteForm({ ...suiteForm, icono: item.id })}
                    >
                      <Icon size={14} />
                      <span className="x-small fw-bold">{item.label}</span>
                    </button>
                  )
                })}
              </div>
            </Form.Group>
            {!editingSuiteId && (
              <Form.Group>
                <Form.Label>{t('casos.parentSuite')}</Form.Label>
                <Form.Select
                  name="parentId"
                  value={suiteForm.parentId}
                  onChange={(e) => setSuiteForm({ ...suiteForm, parentId: e.target.value })}
                >
                  <option value="">{t('casos.rootSuiteOption')}</option>
                  {flattenSuites(suitesTree).map(suite => (
                    <option key={suite.id} value={suite.id}>{suite.nombre}</option>
                  ))}
                </Form.Select>
              </Form.Group>
            )}
          </Modal.Body>
          <Modal.Footer className="border-0 pt-0">
            <Button variant="secondary" onClick={resetSuiteModal}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" type="submit">
              {editingSuiteId ? t('common.update') : t('common.create')}
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>

      <Modal show={showMoveSuiteModal} onHide={resetMoveSuiteModal} centered>
        <Modal.Header closeButton className="border-0 pb-2">
          <Modal.Title className="fw-bold fs-5 d-flex align-items-center gap-2">
            <FolderCheck size={20} className="text-primary" />
            {t('casos.moveSuite')}
          </Modal.Title>
        </Modal.Header>
        <Form onSubmit={(event) => { event.preventDefault(); handleMoveSuite() }}>
          <Modal.Body className="pt-0">
            <Form.Group>
              <Form.Label>{t('casos.newParentSuite')}</Form.Label>
              <Form.Select name="a11y-suiteandcomponentmodalstsx-287" aria-label="Campo de formulario"
                value={moveSuiteParentId}
                onChange={(e) => setMoveSuiteParentId(e.target.value)}
              >
                <option value="">{t('casos.rootSuiteWithoutParentOption')}</option>
                {moveSuiteOptions.map(suite => (
                  <option key={suite.id} value={suite.id}>{suite.nombre}</option>
                ))}
              </Form.Select>
            </Form.Group>
          </Modal.Body>
          <Modal.Footer className="border-0 pt-0">
            <Button variant="secondary" onClick={resetMoveSuiteModal}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" type="submit">
              {t('common.move')}
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>

      <Modal show={showComponentModal} onHide={() => setShowComponentModal(false)} centered backdrop="static" dialogClassName="component-edit-modal">
        <Modal.Header closeButton className="bg-light border-bottom text-dark">
          <Modal.Title className="fw-bold fs-5 text-dark d-flex align-items-center gap-2">
            <Layers size={20} className="text-primary" />
            {componentForm.id ? t('casos.editComponent') : t('casos.newComponent')}
          </Modal.Title>
        </Modal.Header>
        <Form onSubmit={handleSaveComponentForm}>
          <Modal.Body className="p-4 text-start">
            <Form.Group className="mb-3">
              <Form.Label className="x-small fw-bold text-muted"><RequiredLabel required>{t('casos.componentName')}</RequiredLabel></Form.Label>
              <Form.Control name="a11y-suiteandcomponentmodalstsx-320" aria-label="Campo de formulario"
                value={componentForm.name}
                onChange={e => setComponentForm({ ...componentForm, name: e.target.value })}
                required
                className="bg-light shadow-sm fw-bold text-dark"
                placeholder={t('casos.componentNamePlaceholder')}
              />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label className="x-small fw-bold text-muted">{t('casos.techStack')}</Form.Label>
              <Form.Control name="a11y-suiteandcomponentmodalstsx-330" aria-label="Campo de formulario"
                value={componentForm.techStack}
                onChange={e => setComponentForm({ ...componentForm, techStack: e.target.value })}
                className="bg-light shadow-sm font-monospace x-small"
                placeholder={t('casos.techStackPlaceholder')}
              />
            </Form.Group>
            <Form.Group className="mb-2">
              <Form.Label className="x-small fw-bold text-muted">{t('casos.descriptionAndScope')}</Form.Label>
              <Form.Control name="a11y-suiteandcomponentmodalstsx-339" aria-label="Campo de formulario"
                as="textarea"
                rows={3}
                value={componentForm.description}
                onChange={e => setComponentForm({ ...componentForm, description: e.target.value })}
                className="bg-light shadow-sm text-dark"
                placeholder={t('casos.descriptionAndScopePlaceholder')}
              />
            </Form.Group>
            <Form.Group className="mb-2">
              <Form.Label className="x-small fw-bold text-muted">{t('casos.technicalVariables')}</Form.Label>
              <Form.Control name="a11y-suiteandcomponentmodalstsx-350" aria-label="Campo de formulario"
                as="textarea"
                rows={4}
                value={componentForm.variablesText || ''}
                onChange={e => setComponentForm({ ...componentForm, variablesText: e.target.value })}
                className="bg-light shadow-sm font-monospace x-small"
                placeholder={t('casos.technicalVariablesPlaceholder')}
              />
              <Form.Text className="text-muted">{t('casos.technicalVariablesHelp')}</Form.Text>
            </Form.Group>
          </Modal.Body>
          <Modal.Footer className="bg-light border-top-0 pt-0 px-4 pb-4 component-edit-modal-footer">
            <Button variant="outline-secondary" onClick={() => setShowComponentModal(false)} className="fw-bold shadow-none rounded-pill px-4">{t('common.cancel')}</Button>
            <Button variant="primary" type="submit" className="fw-bold shadow-sm rounded-pill px-4">
              <Save size={16} className="me-2" /> {t('casos.saveComponent')}
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>
    </>
  )
}
