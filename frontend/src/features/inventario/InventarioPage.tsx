import { FormEvent, useEffect, useMemo, useState } from 'react'
import { Alert, Badge, Button, Card, Col, Form, InputGroup, Modal, Row, Spinner } from 'react-bootstrap'
import {
  Boxes,
  Cpu,
  Database,
  Edit,
  Globe,
  HardDrive,
  Info,
  Laptop,
  Network,
  Plus,
  Router,
  Search,
  Server,
  Smartphone,
  Trash2,
  Wrench
} from 'lucide-react'
import { API_BASE } from '../../app/constants'
import { useI18n } from '../../i18n'
import { RequiredLabel } from '../../shared/ui/RequiredLabel'
import { WorkspaceContextEmptyState } from '../../shared/components/WorkspaceContextEmptyState'
import { InventoryAssetModal } from './InventoryAssetModal'
import { InventoryAssetGrid } from './InventoryAssetGrid'
import { InventoryToolbar } from './InventoryToolbar'

type InventoryEndpoint = {
  id?: string
  asset_id?: string
  tipo: string
  valor: string
  puerto?: number | ''
  protocolo?: string
  descripcion?: string
  principal?: boolean
  activo?: boolean
}

type InventoryAsset = {
  id: string
  proyecto_id: string
  categoria_id?: string
  parent_id?: string | null
  nombre: string
  tipo: string
  naturaleza: string
  estado: string
  criticidad: string
  descripcion?: string
  ubicacion?: string
  responsable?: string
  fabricante?: string
  modelo?: string
  serial?: string
  asset_tag?: string
  sistema_operativo?: string
  metadata?: Record<string, any>
  activo?: boolean
  endpoints: InventoryEndpoint[]
  children_count?: number
}

type InventoryModalState = {
  show: boolean
  mode: 'add' | 'edit'
  preset?: Partial<InventoryAsset>
  asset?: InventoryAsset
}

type InventarioPageProps = {
  currentProjectId: string | null
  inventoryCategories: any[]
  setInventoryCategories: (categories: any[]) => void
  environments: any[]
  setEnvironments: (environments: any[]) => void
  devices: any[]
  setDevices: (devices: any[]) => void
  agents: any[]
  setAgents: (agents: any[]) => void
  customInventoryItems: any[]
  setCustomInventoryItems: (items: any[]) => void
  confirmAction: (options: { title: string; message: string; variant?: 'danger' | 'warning' | 'info'; confirmLabel?: string; cancelLabel?: string | null }) => Promise<boolean>
  currentProjectInventoryCategories: any[]
  currentProjectEnvironments: any[]
  currentProjectDevices: any[]
  currentProjectCustomInventoryItems: any[]
  currentProjectAgents: any[]
  setInvModalConfig: (config: any) => void
  canAccessCapability?: (capabilityId: any, level?: any) => boolean
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>
}

const ASSET_TYPES = [
  'Servidor',
  'Computadora',
  'Laptop',
  'Dispositivo movil',
  'Tablet',
  'Router/Switch',
  'Impresora',
  'Dispositivo IoT',
  'Nodo de ejecucion',
  'Maquina virtual',
  'Contenedor',
  'Herramienta digital',
  'Servicio',
  'API',
  'Base de datos',
  'Otro'
]

const NATURES = ['fisico', 'virtual', 'digital']
const STATUSES = ['Activo', 'Online', 'Offline', 'Mantenimiento', 'En Pausa', 'Retirado', 'Desconocido']
const CRITICALITIES = ['Baja', 'Media', 'Alta', 'Critica']
const ENDPOINT_TYPES = ['ip', 'url', 'hostname', 'dns', 'puerto', 'otro']

const defaultAsset = (projectId: string, preset: Partial<InventoryAsset> = {}): InventoryAsset => ({
  id: '',
  proyecto_id: projectId,
  categoria_id: preset.categoria_id || '',
  parent_id: preset.parent_id || null,
  nombre: preset.nombre || '',
  tipo: preset.tipo || 'Computadora',
  naturaleza: preset.naturaleza || 'fisico',
  estado: preset.estado || 'Activo',
  criticidad: preset.criticidad || 'Media',
  descripcion: preset.descripcion || '',
  ubicacion: preset.ubicacion || '',
  responsable: preset.responsable || '',
  fabricante: preset.fabricante || '',
  modelo: preset.modelo || '',
  serial: preset.serial || '',
  asset_tag: preset.asset_tag || '',
  sistema_operativo: preset.sistema_operativo || '',
  metadata: preset.metadata || {},
  endpoints: preset.endpoints || []
})

const getAssetIcon = (tipo: string, naturaleza: string) => {
  if (tipo === 'Servidor') return Server
  if (tipo === 'Base de datos') return Database
  if (tipo === 'API' || tipo === 'Servicio' || tipo === 'Herramienta digital') return Globe
  if (tipo === 'Laptop' || tipo === 'Computadora') return Laptop
  if (tipo === 'Dispositivo movil' || tipo === 'Tablet') return Smartphone
  if (tipo === 'Router/Switch') return Router
  if (tipo === 'Nodo de ejecucion') return Cpu
  if (naturaleza === 'virtual') return HardDrive
  return Boxes
}

const statusVariant = (estado: string) => {
  if (estado === 'Activo' || estado === 'Online') return 'success'
  if (estado === 'Mantenimiento') return 'info'
  if (estado === 'En Pausa') return 'warning'
  if (estado === 'Offline' || estado === 'Retirado') return 'secondary'
  return 'light'
}

const criticalityVariant = (criticidad: string) => {
  if (criticidad === 'Critica') return 'danger'
  if (criticidad === 'Alta') return 'warning'
  if (criticidad === 'Baja') return 'secondary'
  return 'primary'
}

const metadataToText = (metadata: Record<string, any> = {}) =>
  Object.entries(metadata).map(([key, value]) => `${key}=${String(value)}`).join('\n')

const textToMetadata = (value: string) => Object.fromEntries(
  value
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const [key, ...rest] = line.split('=')
      return [key.trim(), rest.join('=').trim()]
    })
    .filter(([key]) => key)
)

const endpointLabel = (endpoint: InventoryEndpoint) => {
  const port = endpoint.puerto ? `:${endpoint.puerto}` : ''
  const protocol = endpoint.protocolo ? `/${endpoint.protocolo}` : ''
  return `${endpoint.valor}${port}${protocol}`
}

export function InventarioPage({
  currentProjectId,
  inventoryCategories,
  setInventoryCategories,
  confirmAction,
  currentProjectInventoryCategories,
  canAccessCapability,
  fetchWithAuth
}: InventarioPageProps) {
  const { t } = useI18n()
  const canUseCapability = canAccessCapability || (() => true)
  const canEditInventory = canUseCapability('inventario.categorias', 'edit')
  const [assets, setAssets] = useState<InventoryAsset[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [filters, setFilters] = useState({ q: '', tipo: '', naturaleza: '', estado: '', criticidad: '', parentId: '' })
  const [newCategoryName, setNewCategoryName] = useState('')
  const [modalState, setModalState] = useState<InventoryModalState>({ show: false, mode: 'add' })
  const [formAsset, setFormAsset] = useState<InventoryAsset | null>(null)
  const [metadataText, setMetadataText] = useState('')

  const loadAssets = async () => {
    if (!currentProjectId) return
    setLoading(true)
    setError('')
    try {
      const allAssets: InventoryAsset[] = []
      let skip = 0
      while (true) {
        const response = await fetchWithAuth(`${API_BASE}/infraestructura/activos/?proyecto_id=${encodeURIComponent(currentProjectId)}&skip=${skip}&limit=200`)
        if (!response.ok) {
          const body = await response.json().catch(() => null)
          throw new Error(body?.detail || t('inventario.errorLoading'))
        }
        const page = await response.json()
        allAssets.push(...page)
        if (!Array.isArray(page) || page.length < 200) break
        skip += 200
      }
      setAssets(allAssets)
    } catch (err: any) {
      setError(err?.message || t('inventario.errorLoading'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAssets()
  }, [currentProjectId])

  const parentOptions = useMemo(() => assets.filter(asset => asset.naturaleza !== 'digital'), [assets])

  const filteredAssets = useMemo(() => {
    const query = filters.q.trim().toLowerCase()
    return assets.filter(asset => {
      const endpointsText = asset.endpoints.map(endpointLabel).join(' ').toLowerCase()
      const matchesQuery = !query || [
        asset.nombre,
        asset.tipo,
        asset.naturaleza,
        asset.descripcion,
        asset.ubicacion,
        asset.responsable,
        asset.serial,
        asset.asset_tag,
        endpointsText
      ].some(value => String(value || '').toLowerCase().includes(query))
      return matchesQuery
        && (!filters.tipo || asset.tipo === filters.tipo)
        && (!filters.naturaleza || asset.naturaleza === filters.naturaleza)
        && (!filters.estado || asset.estado === filters.estado)
        && (!filters.criticidad || asset.criticidad === filters.criticidad)
        && (!filters.parentId || asset.parent_id === filters.parentId)
    })
  }, [assets, filters])

  const assetsByParent = useMemo(() => {
    const grouped: Record<string, InventoryAsset[]> = {}
    assets.forEach(asset => {
      if (!asset.parent_id) return
      grouped[asset.parent_id] = [...(grouped[asset.parent_id] || []), asset]
    })
    return grouped
  }, [assets])

  const openAddModal = (preset: Partial<InventoryAsset>) => {
    if (!currentProjectId) return
    const nextAsset = defaultAsset(currentProjectId, preset)
    setFormAsset(nextAsset)
    setMetadataText(metadataToText(nextAsset.metadata))
    setModalState({ show: true, mode: 'add', preset })
  }

  const openEditModal = (asset: InventoryAsset) => {
    const normalizedEndpoints: InventoryEndpoint[] = asset.endpoints.length
      ? asset.endpoints.map(endpoint => ({ ...endpoint, puerto: typeof endpoint.puerto === 'number' ? endpoint.puerto : '' }))
      : []
    const nextAsset: InventoryAsset = {
      ...defaultAsset(asset.proyecto_id),
      ...asset,
      endpoints: normalizedEndpoints
    }
    setFormAsset(nextAsset)
    setMetadataText(metadataToText(nextAsset.metadata))
    setModalState({ show: true, mode: 'edit', asset })
  }

  const hideModal = () => {
    setModalState({ show: false, mode: 'add' })
    setFormAsset(null)
    setMetadataText('')
  }

  const updateFormAsset = (patch: Partial<InventoryAsset>) => {
    setFormAsset(current => current ? { ...current, ...patch } : current)
  }

  const updateEndpoint = (index: number, patch: Partial<InventoryEndpoint>) => {
    setFormAsset(current => {
      if (!current) return current
      return {
        ...current,
        endpoints: current.endpoints.map((endpoint, itemIndex) => itemIndex === index ? { ...endpoint, ...patch } : endpoint)
      }
    })
  }

  const addEndpoint = () => {
    setFormAsset(current => current ? {
      ...current,
      endpoints: [...current.endpoints, { tipo: 'ip', valor: '', puerto: '', protocolo: '', descripcion: '', principal: current.endpoints.length === 0 }]
    } : current)
  }

  const removeEndpoint = (index: number) => {
    setFormAsset(current => current ? {
      ...current,
      endpoints: current.endpoints.filter((_, itemIndex) => itemIndex !== index)
    } : current)
  }

  const submitAsset = async (event: FormEvent) => {
    event.preventDefault()
    if (!currentProjectId || !formAsset) return
    setSaving(true)
    setError('')
    try {
      const cleanEndpoints = formAsset.endpoints
        .filter(endpoint => endpoint.valor.trim())
        .map(endpoint => ({
          ...endpoint,
          puerto: endpoint.puerto ? Number(endpoint.puerto) : null,
          protocolo: endpoint.protocolo || null,
          descripcion: endpoint.descripcion || null,
          principal: Boolean(endpoint.principal)
        }))
      const payload = {
        categoria_id: formAsset.categoria_id || null,
        parent_id: formAsset.parent_id || null,
        nombre: formAsset.nombre,
        tipo: formAsset.tipo,
        naturaleza: formAsset.naturaleza,
        estado: formAsset.estado,
        criticidad: formAsset.criticidad,
        descripcion: formAsset.descripcion || null,
        ubicacion: formAsset.ubicacion || null,
        responsable: formAsset.responsable || null,
        fabricante: formAsset.fabricante || null,
        modelo: formAsset.modelo || null,
        serial: formAsset.serial || null,
        asset_tag: formAsset.asset_tag || null,
        sistema_operativo: formAsset.sistema_operativo || null,
        metadata: textToMetadata(metadataText),
        activo: true
      }

      if (modalState.mode === 'add') {
        const response = await fetchWithAuth(`${API_BASE}/infraestructura/activos/?proyecto_id=${encodeURIComponent(currentProjectId)}`, {
          method: 'POST',
          body: JSON.stringify({ ...payload, endpoints: cleanEndpoints })
        })
        if (!response.ok) throw new Error((await response.json().catch(() => null))?.detail || t('inventario.errorSaving'))
      } else if (modalState.asset) {
        const response = await fetchWithAuth(`${API_BASE}/infraestructura/activos/${modalState.asset.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload)
        })
        if (!response.ok) throw new Error((await response.json().catch(() => null))?.detail || t('inventario.errorSaving'))

        const originalEndpointIds = new Set((modalState.asset.endpoints || []).map(endpoint => endpoint.id).filter(Boolean))
        const currentEndpointIds = new Set(cleanEndpoints.map(endpoint => endpoint.id).filter(Boolean))
        for (const endpoint of cleanEndpoints) {
          if (endpoint.id) {
            const endpointResponse = await fetchWithAuth(`${API_BASE}/infraestructura/endpoints/${endpoint.id}`, {
              method: 'PATCH',
              body: JSON.stringify(endpoint)
            })
            if (!endpointResponse.ok) throw new Error((await endpointResponse.json().catch(() => null))?.detail || t('inventario.errorSaving'))
          } else {
            const endpointResponse = await fetchWithAuth(`${API_BASE}/infraestructura/activos/${modalState.asset.id}/endpoints/`, {
              method: 'POST',
              body: JSON.stringify(endpoint)
            })
            if (!endpointResponse.ok) throw new Error((await endpointResponse.json().catch(() => null))?.detail || t('inventario.errorSaving'))
          }
        }
        for (const endpointId of originalEndpointIds) {
          if (!currentEndpointIds.has(endpointId)) {
            await fetchWithAuth(`${API_BASE}/infraestructura/endpoints/${endpointId}`, { method: 'DELETE' })
          }
        }
      }
      hideModal()
      await loadAssets()
    } catch (err: any) {
      setError(err?.message || t('inventario.errorSaving'))
    } finally {
      setSaving(false)
    }
  }

  const deleteAsset = async (asset: InventoryAsset) => {
    const children = assetsByParent[asset.id] || []
    const confirmed = await confirmAction({
      title: t('inventario.deleteConfirmTitle'),
      message: children.length
        ? `${t('inventario.deleteConfirmMessage', { name: asset.nombre })} (${children.length})`
        : t('inventario.deleteConfirmMessage', { name: asset.nombre }),
      variant: 'danger',
      confirmLabel: t('inventario.delete')
    })
    if (!confirmed) return
    const response = await fetchWithAuth(`${API_BASE}/infraestructura/activos/${asset.id}`, { method: 'DELETE' })
    if (!response.ok) {
      const body = await response.json().catch(() => null)
      setError(body?.detail || t('inventario.errorDeleting'))
      return
    }
    await loadAssets()
  }

  if (!currentProjectId) {
    return (
      <WorkspaceContextEmptyState
        message={t('inventario.noProjectSelected')}
        detail={t('inventario.noProjectDetail')}
      />
    )
  }

  return (
    <div className="p-3 p-xl-4 animate__animated animate__fadeIn text-dark text-start bg-light h-100 overflow-auto">
      <InventoryToolbar options={{
        t,
        canEditInventory,
        newCategoryName,
        setNewCategoryName,
        inventoryCategories,
        currentProjectId,
        setInventoryCategories,
        openAddModal,
        error,
        filters,
        setFilters,
        parentOptions,
        filteredAssets,
      }} />
      {loading ? (
        <div className="d-flex align-items-center gap-2 text-muted small py-5 justify-content-center">
          <Spinner size="sm" /> {t('inventario.loading')}
        </div>
      ) : filteredAssets.length === 0 ? (
        <Card className="border-0 shadow-sm rounded-3">
          <Card.Body className="text-center py-5 text-muted">
            <Network size={32} className="mb-2 opacity-50" />
            <div className="fw-bold">{t('inventario.noAssets')}</div>
            <div className="small">{t('inventario.addAsset')}</div>
          </Card.Body>
        </Card>
      ) : (
        <InventoryAssetGrid options={{
          filteredAssets,
          assetsByParent,
          assets,
          getAssetIcon,
          statusVariant,
          criticalityVariant,
          endpointLabel,
          t,
          canEditInventory,
          openAddModal,
          openEditModal,
          deleteAsset,
        }} />
      )}

      <InventoryAssetModal options={{ t, modalState, formAsset, hideModal, submitAsset, currentProjectInventoryCategories, parentOptions, updateFormAsset, addEndpoint, updateEndpoint, removeEndpoint, metadataText, setMetadataText, saving }} />
    </div>
  )
}
