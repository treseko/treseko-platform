import { Badge, Button, Card, Col, Row } from 'react-bootstrap'
import { Edit, Plus, Server, Trash2 } from 'lucide-react'

export function InventoryAssetGrid({ options }: { options: any }) {
  const { filteredAssets, assetsByParent, assets, getAssetIcon, statusVariant, criticalityVariant, endpointLabel, t, canEditInventory, openAddModal, openEditModal, deleteAsset } = options
  return (
<Row className="g-3">
  {filteredAssets.map(asset => {
    const Icon = getAssetIcon(asset.tipo, asset.naturaleza)
    const children = assetsByParent[asset.id] || []
    const mainEndpoints = asset.endpoints.filter(endpoint => endpoint.activo !== false).slice(0, 3)
    const parent = asset.parent_id ? assets.find(item => item.id === asset.parent_id) : null
    return (
      <Col xxl={3} xl={4} lg={6} key={asset.id}>
        <Card className="border-0 shadow-sm rounded-3 h-100 inventory-asset-card">
          <Card.Body className="p-3 d-flex flex-column">
            <div className="d-flex justify-content-between gap-2 mb-3">
              <div className="d-flex gap-2 min-w-0">
                <span className="d-inline-flex align-items-center justify-content-center bg-primary bg-opacity-10 text-primary rounded-3 flex-shrink-0" style={{ width: 38, height: 38 }}>
                  <Icon size={20} />
                </span>
                <div className="min-w-0">
                  <div className="fw-bold text-dark text-truncate">{asset.nombre}</div>
                  <div className="small text-muted text-truncate">{asset.tipo} · {asset.naturaleza}</div>
                </div>
              </div>
              <div className="d-flex flex-column align-items-end gap-1">
                <Badge bg={statusVariant(asset.estado)}>{asset.estado}</Badge>
                <Badge bg={criticalityVariant(asset.criticidad)}>{asset.criticidad}</Badge>
              </div>
            </div>

            <div className="d-flex flex-wrap gap-1 mb-3">
              {mainEndpoints.length ? mainEndpoints.map((endpoint, index) => (
                <Badge key={`${endpoint.id || index}-${endpoint.valor}`} bg="light" text="dark" className="border fw-normal font-monospace">
                  {endpoint.tipo}: {endpointLabel(endpoint)}
                </Badge>
              )) : <span className="small text-muted">{t('inventario.noChildren')}</span>}
            </div>

            <div className="small text-muted flex-grow-1">
              {parent && <div className="mb-1"><Server size={13} className="me-1" />Alojado en {parent.nombre}</div>}
              {asset.ubicacion && <div className="mb-1">{t('inventario.location')}: {asset.ubicacion}</div>}
              {asset.responsable && <div className="mb-1">Responsable: {asset.responsable}</div>}
              {asset.sistema_operativo && <div className="mb-1">SO: {asset.sistema_operativo}</div>}
              {children.length > 0 && (
                <div className="mt-2">
                  <div className="x-small fw-bold text-secondary mb-1">{t('inventario.children')}</div>
                  <div className="d-flex flex-wrap gap-1">
                    {children.slice(0, 4).map(child => <Badge key={child.id} bg="info" className="fw-normal">{child.nombre}</Badge>)}
                    {children.length > 4 && <Badge bg="secondary">+{children.length - 4}</Badge>}
                  </div>
                </div>
              )}
            </div>

            <div className="d-flex justify-content-between align-items-center mt-3 pt-2 border-top">
              {canEditInventory && (asset.tipo === 'Servidor' || asset.naturaleza !== 'digital') ? (
                <Button size="sm" variant="outline-primary" className="rounded-pill fw-bold x-small" onClick={() => openAddModal({ tipo: 'Servicio', naturaleza: 'digital', parent_id: asset.id })}>
                  <Plus size={12} className="me-1" /> Servicio
                </Button>
              ) : <span />}
              <div className="d-flex gap-1">
                {canEditInventory && <Button size="sm" variant="white" className="border text-secondary p-1" title={t('inventario.editAsset')} onClick={() => openEditModal(asset)}><Edit size={15} /></Button>}
                {canEditInventory && <Button size="sm" variant="white" className="border text-danger p-1" title={t('inventario.delete')} onClick={() => deleteAsset(asset)}><Trash2 size={15} /></Button>}
              </div>
            </div>
          </Card.Body>
        </Card>
      </Col>
    )
  })}
</Row>

  )
}
