import type { Dispatch, FormEvent, SetStateAction } from 'react'
import { Button, Col, Form, Modal, Row } from 'react-bootstrap'
import { Save, Settings } from 'lucide-react'

type InventoryModalConfig = {
  show: boolean
  type: string
  mode: 'add' | 'edit'
  itemData: any
}

type InventoryItemModalProps = {
  invModalConfig: InventoryModalConfig
  setInvModalConfig: Dispatch<SetStateAction<InventoryModalConfig>>
  currentProjectId: string
  environments: any[]
  setEnvironments: Dispatch<SetStateAction<any[]>>
  devices: any[]
  setDevices: Dispatch<SetStateAction<any[]>>
  agents: any[]
  setAgents: Dispatch<SetStateAction<any[]>>
  customInventoryItems: any[]
  setCustomInventoryItems: Dispatch<SetStateAction<any[]>>
}

const getInventoryTypeLabel = (type: string) => {
  if (type === 'env') return 'Entorno'
  if (type === 'device') return 'Dispositivo'
  if (type === 'node') return 'Nodo de cómputo'
  return 'Registro'
}

export function InventoryItemModal({
  invModalConfig,
  setInvModalConfig,
  currentProjectId,
  environments,
  setEnvironments,
  devices,
  setDevices,
  agents,
  setAgents,
  customInventoryItems,
  setCustomInventoryItems
}: InventoryItemModalProps) {
  const hideModal = () => setInvModalConfig({ ...invModalConfig, show: false })

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const dataObj = Object.fromEntries(formData.entries())

    if (invModalConfig.type === 'env') {
      const newEnv = {
        id: invModalConfig.mode === 'edit' ? invModalConfig.itemData.id : `e${Date.now()}`,
        projectId: invModalConfig.itemData?.projectId || currentProjectId,
        name: dataObj.name as string,
        url: dataObj.url as string,
        status: dataObj.status as string,
        version: dataObj.version as string,
        lastPing: invModalConfig.mode === 'edit' ? invModalConfig.itemData.lastPing : 'Justo ahora'
      }
      setEnvironments(invModalConfig.mode === 'edit' ? environments.map(env => env.id === newEnv.id ? newEnv : env) : [...environments, newEnv])
    } else if (invModalConfig.type === 'device') {
      const newDevice = {
        id: invModalConfig.mode === 'edit' ? invModalConfig.itemData.id : `d${Date.now()}`,
        projectId: invModalConfig.itemData?.projectId || currentProjectId,
        name: dataObj.name as string,
        type: dataObj.type as string,
        status: dataObj.status as string,
        browser: dataObj.browser as string,
        resolution: dataObj.resolution as string
      }
      setDevices(invModalConfig.mode === 'edit' ? devices.map(device => device.id === newDevice.id ? newDevice : device) : [...devices, newDevice])
    } else if (invModalConfig.type === 'node') {
      const newNode = {
        id: invModalConfig.mode === 'edit' ? invModalConfig.itemData.id : `a${Date.now()}`,
        projectId: invModalConfig.itemData?.projectId || currentProjectId,
        name: dataObj.name as string,
        ip: dataObj.ip as string,
        status: dataObj.status as string,
        runs: invModalConfig.mode === 'edit' ? invModalConfig.itemData.runs : 0,
        cpu: invModalConfig.mode === 'edit' ? invModalConfig.itemData.cpu : 0,
        ram: invModalConfig.mode === 'edit' ? invModalConfig.itemData.ram : 0
      }
      setAgents(invModalConfig.mode === 'edit' ? agents.map(agent => agent.id === newNode.id ? newNode : agent) : [...agents, newNode])
    } else {
      const newCustomItem = {
        id: invModalConfig.mode === 'edit' ? invModalConfig.itemData.id : `ci${Date.now()}`,
        projectId: invModalConfig.itemData?.projectId || currentProjectId,
        categoryId: invModalConfig.type,
        name: dataObj.name as string,
        detail1: dataObj.detail1 as string,
        detail2: dataObj.detail2 as string,
        status: dataObj.status as string
      }
      setCustomInventoryItems(invModalConfig.mode === 'edit' ? customInventoryItems.map(item => item.id === newCustomItem.id ? newCustomItem : item) : [...customInventoryItems, newCustomItem])
    }

    hideModal()
  }

  return (
    <Modal show={invModalConfig.show} onHide={hideModal} centered backdrop="static">
      <Modal.Header closeButton className="bg-light border-bottom text-dark">
        <Modal.Title className="fw-bold fs-5 text-dark d-flex align-items-center gap-2">
          <Settings size={20} className="text-primary" />
          {invModalConfig.mode === 'add' ? 'Registrar nuevo' : 'Editar'} {getInventoryTypeLabel(invModalConfig.type)}
        </Modal.Title>
      </Modal.Header>
      <Form onSubmit={handleSubmit}>
        <Modal.Body className="p-4 text-start">
          <Form.Group className="mb-3">
            <Form.Label className="x-small fw-bold text-muted">Nombre / Identificador</Form.Label>
            <Form.Control name="name" defaultValue={invModalConfig.itemData?.name} required className="bg-light shadow-sm" />
          </Form.Group>

          {invModalConfig.type === 'env' && (
            <>
              <Form.Group className="mb-3">
                <Form.Label className="x-small fw-bold text-muted">URL / Endpoint</Form.Label>
                <Form.Control name="url" type="url" defaultValue={invModalConfig.itemData?.url} required className="bg-light shadow-sm font-monospace x-small" />
              </Form.Group>
              <Form.Group className="mb-3">
                <Form.Label className="x-small fw-bold text-muted">Versión desplegada</Form.Label>
                <Form.Control name="version" defaultValue={invModalConfig.itemData?.version} required className="bg-light shadow-sm" placeholder="Ej: v1.0.0" />
              </Form.Group>
            </>
          )}

          {invModalConfig.type === 'device' && (
            <Row className="g-2 mb-3">
              <Col md={6}>
                <Form.Group>
                  <Form.Label className="x-small fw-bold text-muted">Resolución de pantalla</Form.Label>
                  <Form.Control name="resolution" defaultValue={invModalConfig.itemData?.resolution} required className="bg-light shadow-sm" placeholder="1920x1080" />
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group>
                  <Form.Label className="x-small fw-bold text-muted">Tipo de dispositivo</Form.Label>
                  <Form.Select name="type" defaultValue={invModalConfig.itemData?.type || 'Desktop'} className="bg-light shadow-sm">
                    <option value="Desktop">Desktop</option>
                    <option value="Mobile">Mobile</option>
                  </Form.Select>
                </Form.Group>
              </Col>
              <Col md={12}>
                <Form.Group className="mt-2">
                  <Form.Label className="x-small fw-bold text-muted">Sistema operativo / navegador</Form.Label>
                  <Form.Control name="browser" defaultValue={invModalConfig.itemData?.browser} required className="bg-light shadow-sm" placeholder="Chrome v126 / iOS 17" />
                </Form.Group>
              </Col>
            </Row>
          )}

          {invModalConfig.type === 'node' && (
            <Form.Group className="mb-3">
              <Form.Label className="x-small fw-bold text-muted">Dirección IP / hostname</Form.Label>
              <Form.Control name="ip" defaultValue={invModalConfig.itemData?.ip} required className="bg-light shadow-sm font-monospace x-small" placeholder="192.168.1.X" />
            </Form.Group>
          )}

          <Form.Group className="mb-2">
            <Form.Label className="x-small fw-bold text-muted">Estado inicial</Form.Label>
            <Form.Select name="status" defaultValue={invModalConfig.itemData?.status || 'Online'} className="bg-light shadow-sm fw-bold text-secondary">
              <option value="Online">Online / Activo</option>
              <option value="Offline">Offline / Inactivo</option>
            </Form.Select>
          </Form.Group>
        </Modal.Body>
        <Modal.Footer className="bg-light border-top-0 pt-0 px-4 pb-4">
          <Button variant="outline-secondary" onClick={hideModal} className="fw-bold shadow-none rounded-pill px-4">Cancelar</Button>
          <Button variant="primary" type="submit" className="fw-bold shadow-sm rounded-pill px-4">
            <Save size={16} className="me-2" /> Guardar registro
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  )
}
