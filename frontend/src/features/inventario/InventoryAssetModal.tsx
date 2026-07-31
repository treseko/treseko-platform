import { Button, Col, Form, Modal, Row, Spinner } from 'react-bootstrap'
import { Plus, Trash2, Wrench } from 'lucide-react'
import { RequiredLabel } from '../../shared/ui/RequiredLabel'

const ASSET_TYPES = ['Servidor', 'Computadora', 'Laptop', 'Dispositivo movil', 'Tablet', 'Router/Switch', 'Impresora', 'Dispositivo IoT', 'Nodo de ejecucion', 'Maquina virtual', 'Contenedor', 'Herramienta digital', 'Servicio', 'API', 'Base de datos', 'Otro']
const NATURES = ['fisico', 'virtual', 'digital']
const STATUSES = ['Activo', 'Online', 'Offline', 'Mantenimiento', 'En Pausa', 'Retirado', 'Desconocido']
const CRITICALITIES = ['Baja', 'Media', 'Alta', 'Critica']
const ENDPOINT_TYPES = ['ip', 'url', 'hostname', 'dns', 'puerto', 'otro']

export function InventoryAssetModal({ options }: { options: any }) {
  const { t } = options
  const { modalState, formAsset, hideModal, submitAsset, currentProjectInventoryCategories, parentOptions, updateFormAsset, addEndpoint, updateEndpoint, removeEndpoint, metadataText, setMetadataText, saving } = options
  return (
<Modal show={modalState.show && !!formAsset} onHide={hideModal} size="lg" centered backdrop="static">
  <Form onSubmit={submitAsset}>
    <Modal.Header closeButton className="bg-light border-bottom">
      <Modal.Title className="fs-5 fw-bold d-flex align-items-center gap-2">
        <Wrench size={20} className="text-primary" />
        {modalState.mode === 'add' ? 'Registrar activo' : 'Editar activo'}
      </Modal.Title>
    </Modal.Header>
    {formAsset && (
      <Modal.Body className="p-4">
        <h6 className="fw-bold text-primary mb-3">{t('inventario.generalData')}</h6>
        <Row className="g-3">
          <Col md={6}>
            <Form.Label className="x-small fw-bold text-muted"><RequiredLabel required>{t('inventario.name')}</RequiredLabel></Form.Label>
            <Form.Control required value={formAsset.nombre} onChange={event => updateFormAsset({ nombre: event.target.value })} placeholder={t('inventario.namePlaceholder')} />
          </Col>
          <Col md={3}>
            <Form.Label className="x-small fw-bold text-muted"><RequiredLabel required>{t('inventario.typeLabel')}</RequiredLabel></Form.Label>
            <Form.Select required value={formAsset.tipo} onChange={event => updateFormAsset({ tipo: event.target.value })}>
              {ASSET_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
            </Form.Select>
          </Col>
          <Col md={3}>
            <Form.Label className="x-small fw-bold text-muted"><RequiredLabel required>{t('inventario.natureLabel')}</RequiredLabel></Form.Label>
            <Form.Select required value={formAsset.naturaleza} onChange={event => updateFormAsset({ naturaleza: event.target.value })}>
              {NATURES.map(nature => <option key={nature} value={nature}>{nature}</option>)}
            </Form.Select>
          </Col>
          <Col md={3}>
            <Form.Label className="x-small fw-bold text-muted">{t('inventario.statusLabel')}</Form.Label>
            <Form.Select value={formAsset.estado} onChange={event => updateFormAsset({ estado: event.target.value })}>
              {STATUSES.map(status => <option key={status} value={status}>{status}</option>)}
            </Form.Select>
          </Col>
          <Col md={3}>
            <Form.Label className="x-small fw-bold text-muted">{t('inventario.criticalityLabel')}</Form.Label>
            <Form.Select value={formAsset.criticidad} onChange={event => updateFormAsset({ criticidad: event.target.value })}>
              {CRITICALITIES.map(criticality => <option key={criticality} value={criticality}>{criticality}</option>)}
            </Form.Select>
          </Col>
          <Col md={3}>
            <Form.Label className="x-small fw-bold text-muted">{t('inventario.categoryName')}</Form.Label>
            <Form.Select value={formAsset.categoria_id || ''} onChange={event => updateFormAsset({ categoria_id: event.target.value })}>
              <option value="">{t('inventario.noCategory')}</option>
              {currentProjectInventoryCategories.map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
            </Form.Select>
          </Col>
          <Col md={3}>
            <Form.Label className="x-small fw-bold text-muted">{t('inventario.parentLabel')}</Form.Label>
            <Form.Select value={formAsset.parent_id || ''} onChange={event => updateFormAsset({ parent_id: event.target.value || null })}>
              <option value="">{t('inventario.noParent')}</option>
              {parentOptions.filter(asset => asset.id !== formAsset.id).map(asset => <option key={asset.id} value={asset.id}>{asset.nombre}</option>)}
            </Form.Select>
          </Col>
          <Col md={12}>
            <Form.Label className="x-small fw-bold text-muted">{t('common.description')}</Form.Label>
            <Form.Control as="textarea" rows={2} value={formAsset.descripcion || ''} onChange={event => updateFormAsset({ descripcion: event.target.value })} />
          </Col>
        </Row>

          <h6 className="fw-bold text-primary mt-4 mb-3">{t('inventario.hardwareSystem')}</h6>
        <Row className="g-3">
          <Col md={4}><Form.Label className="x-small fw-bold text-muted">{t('inventario.location')}</Form.Label><Form.Control value={formAsset.ubicacion || ''} onChange={event => updateFormAsset({ ubicacion: event.target.value })} /></Col>
          <Col md={4}><Form.Label className="x-small fw-bold text-muted">{t('inventario.responsible')}</Form.Label><Form.Control value={formAsset.responsable || ''} onChange={event => updateFormAsset({ responsable: event.target.value })} /></Col>
          <Col md={4}><Form.Label className="x-small fw-bold text-muted">{t('inventario.os')}</Form.Label><Form.Control value={formAsset.sistema_operativo || ''} onChange={event => updateFormAsset({ sistema_operativo: event.target.value })} /></Col>
          <Col md={3}><Form.Label className="x-small fw-bold text-muted">Fabricante</Form.Label><Form.Control value={formAsset.fabricante || ''} onChange={event => updateFormAsset({ fabricante: event.target.value })} /></Col>
          <Col md={3}><Form.Label className="x-small fw-bold text-muted">Modelo</Form.Label><Form.Control value={formAsset.modelo || ''} onChange={event => updateFormAsset({ modelo: event.target.value })} /></Col>
          <Col md={3}><Form.Label className="x-small fw-bold text-muted">Serial</Form.Label><Form.Control value={formAsset.serial || ''} onChange={event => updateFormAsset({ serial: event.target.value })} /></Col>
          <Col md={3}><Form.Label className="x-small fw-bold text-muted">Asset tag</Form.Label><Form.Control value={formAsset.asset_tag || ''} onChange={event => updateFormAsset({ asset_tag: event.target.value })} /></Col>
        </Row>

        <div className="d-flex justify-content-between align-items-center mt-4 mb-3">
          <h6 className="fw-bold text-primary m-0">{t('inventario.networkEndpoints')}</h6>
          <Button type="button" size="sm" variant="outline-primary" className="rounded-pill fw-bold" onClick={addEndpoint}>
            <Plus size={14} className="me-1" /> Endpoint
          </Button>
        </div>
        <div className="d-flex flex-column gap-2">
          {formAsset.endpoints.map((endpoint, index) => (
            <Row className="g-2 align-items-end" key={endpoint.id || index}>
              <Col md={2}>
                <Form.Label className="x-small fw-bold text-muted">{t('inventario.type')}</Form.Label>
                <Form.Select value={endpoint.tipo} onChange={event => updateEndpoint(index, { tipo: event.target.value })}>
                  {ENDPOINT_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
                </Form.Select>
              </Col>
              <Col md={4}>
                <Form.Label className="x-small fw-bold text-muted"><RequiredLabel required>{t('inventario.endpointDescription')}</RequiredLabel></Form.Label>
                <Form.Control required value={endpoint.valor} onChange={event => updateEndpoint(index, { valor: event.target.value })} placeholder={t('inventario.ipHostname')} />
              </Col>
              <Col md={2}>
                <Form.Label className="x-small fw-bold text-muted">{t('inventario.endpointPort')}</Form.Label>
                <Form.Control type="number" min={1} max={65535} value={endpoint.puerto || ''} onChange={event => updateEndpoint(index, { puerto: event.target.value ? Number(event.target.value) : '' })} />
              </Col>
              <Col md={2}>
                <Form.Label className="x-small fw-bold text-muted">{t('inventario.endpointProtocol')}</Form.Label>
                <Form.Control value={endpoint.protocolo || ''} onChange={event => updateEndpoint(index, { protocolo: event.target.value })} placeholder="https" />
              </Col>
              <Col md={1} className="pb-2">
                <Form.Check checked={Boolean(endpoint.principal)} onChange={event => updateEndpoint(index, { principal: event.target.checked })} label="Ppal." className="x-small" />
              </Col>
              <Col md={1} className="pb-1">
                <Button type="button" variant="white" className="border text-danger p-2" onClick={() => removeEndpoint(index)} title={t('inventario.remove')}>
                  <Trash2 size={14} />
                </Button>
              </Col>
            </Row>
          ))}
        </div>

        <h6 className="fw-bold text-primary mt-4 mb-3">{t('inventario.customMetadata')}</h6>
        <Form.Control
          as="textarea"
          rows={3}
          value={metadataText}
          onChange={event => setMetadataText(event.target.value)}
          placeholder={'owner_team=QA\nrack=R1\ncontrato_soporte=Gold'}
          className="font-monospace small"
        />
      </Modal.Body>
    )}
    <Modal.Footer className="bg-light border-top">
      <Button variant="outline-secondary" onClick={hideModal} className="rounded-pill px-4">{t('inventario.cancel')}</Button>
      <Button variant="primary" type="submit" disabled={saving || !formAsset?.nombre} className="rounded-pill px-4 fw-bold">
        {saving && <Spinner size="sm" className="me-2" />} {t('inventario.saveAsset')}
      </Button>
    </Modal.Footer>
  </Form>
</Modal>
  )
}
