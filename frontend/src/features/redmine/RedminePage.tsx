import { useEffect, useMemo, useState } from 'react'
import { Alert, Badge, Button, Card, Col, Row, Spinner } from 'react-bootstrap'
import { Box, Lock, Plug, Puzzle, RefreshCw, ShieldCheck, Store } from 'lucide-react'
import { API_BASE } from '../../app/constants'

type ExtensionKind = 'integration' | 'plugin'

type ExtensionInstance = {
  id: string
  enabled: boolean
  status: string
}

type ExtensionItem = {
  id: string
  kind: ExtensionKind
  display_name: string
  description?: string
  status: string
  builtin?: boolean
  capabilities: Array<{ id: string, label: string, level: string }>
  premium_feature?: string
  premium_required?: boolean
  installed: boolean
  instance?: ExtensionInstance | null
}

type RedminePageProps = {
  fetchWithAuth: (url: string, options?: any) => Promise<Response>
  showFeedback: (title: string, message: string, variant?: string) => void
  canAccessCapability?: (capabilityId: any, level?: any) => boolean
  hasSystemFeature?: (featureId: string) => boolean
  setActiveTab?: (tab: any) => void
  setConfigTab?: (tab: any) => void
  currentProjectRedmineBugs?: any[]
  currentProjectCases?: any[]
  redmineUrl?: string
}

const KIND_LABEL: Record<ExtensionKind, string> = {
  integration: 'Integracion',
  plugin: 'Plugin',
}

const STATUS_LABELS: Record<string, string> = {
  planned: 'Proximamente',
  installed: 'Instalado',
  configured: 'Configurado',
  active: 'Activo',
  disabled: 'Inactivo',
  error: 'Error',
}

const PROVIDER_ACCENT: Record<string, string> = {
  notification_email: 'info',
  redmine: 'danger',
  jira: 'primary',
  github_issues: 'dark',
  bug_tracker: 'warning',
  motor_llm: 'info',
  junit_importer: 'info',
  excel_importer: 'success',
  custom_dashboard: 'warning',
  ai_case_generator: 'secondary',
}

const statusVariant = (status?: string) => {
  if (status === 'active') return 'success'
  if (status === 'configured' || status === 'installed') return 'primary'
  if (status === 'error') return 'danger'
  if (status === 'disabled') return 'secondary'
  return 'secondary'
}

const extensionDescription = (item: ExtensionItem) => {
  if (item.description) return item.description
  if (item.id === 'notification_email') return 'Notificaciones por correo ya integradas en Treseko.'
  if (item.id === 'bug_tracker') return 'Bug tracker interno ya disponible para gestionar defectos y trazabilidad QA.'
  if (item.id === 'motor_llm') return 'Motor LLM integrado para ejecucion IA, modelos y workflows controlados.'
  if (item.id === 'redmine') return 'Instalable como integracion enterprise segura, sin codigo externo ni acceso directo a datos.'
  if (item.id === 'jira') return 'Vinculacion futura de epicas, historias e incidencias contra pruebas y builds.'
  if (item.id === 'github_issues') return 'Vinculacion con GitHub Issues para defectos y trazabilidad.'
  if (item.id === 'junit_importer') return 'Importa resultados JUnit/XML mediante APIs internas de Treseko.'
  if (item.id === 'excel_importer') return 'Importa casos desde Excel sin acceso directo a la base de datos.'
  if (item.id === 'custom_dashboard') return 'Agrega widgets personalizados al dashboard QA.'
  if (item.id === 'ai_case_generator') return 'Genera casos con IA bajo permisos, cuotas y auditoria.'
  return 'Complemento seguro administrado por Treseko.'
}

export function RedminePage({
  fetchWithAuth,
  showFeedback,
  hasSystemFeature,
  setActiveTab,
  setConfigTab,
}: RedminePageProps) {
  const [items, setItems] = useState<ExtensionItem[]>([])
  const [filter, setFilter] = useState<'all' | ExtensionKind | 'installed'>('all')
  const [loading, setLoading] = useState(false)

  const visibleItems = useMemo(() => items.filter(item => {
    if (filter === 'installed') return item.installed
    if (filter === 'integration') return item.kind === 'integration'
    if (filter === 'plugin') return item.kind === 'plugin'
    return true
  }), [items, filter])

  const loadCatalog = async () => {
    setLoading(true)
    try {
      const response = await fetchWithAuth(`${API_BASE}/extensions/catalog`)
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data?.detail || 'No se pudo cargar el catalogo.')
      setItems(data.items || [])
    } catch (err: any) {
      showFeedback('Complementos', err?.message || 'No se pudo cargar el catalogo.', 'danger')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadCatalog()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const openInstalledSettings = () => {
    setConfigTab?.('integrations')
    setActiveTab?.('configuracion')
  }

  const renderAction = (item: ExtensionItem) => {
    if (item.installed) {
      const targetConfigTab = item.id === 'notification_email'
        ? 'notifications'
        : item.id === 'bug_tracker'
          ? null
          : item.id === 'motor_llm'
            ? 'ai'
            : 'integrations'
      return (
        <Button
          variant="outline-dark"
          size="sm"
          className="mt-auto fw-bold rounded-pill shadow-none"
          onClick={() => {
            if (targetConfigTab) setConfigTab?.(targetConfigTab)
            setActiveTab?.(item.id === 'bug_tracker' ? 'bugs' : 'configuracion')
          }}
        >
          {item.builtin ? 'Abrir complemento' : 'Configurar instalado'}
        </Button>
      )
    }

    if (!item.installed) {
      return (
        <Button
          variant="light"
          size="sm"
          className="mt-auto fw-bold rounded-pill border shadow-none"
          disabled
          title="Este complemento estara disponible proximamente"
        >
          Proximamente
        </Button>
      )
    }
  }

  return (
    <div className="app-page animate__animated animate__fadeIn text-dark text-start">
      <div className="app-page-header mb-3">
        <div>
          <h4 className="fw-bold text-primary m-0 d-flex align-items-center gap-2">
            <Store size={24} /> Complementos
          </h4>
          <div className="small text-muted">Tienda segura de integraciones y plugins aprobados por Treseko.</div>
        </div>
        <div className="d-flex flex-wrap gap-2 justify-content-end">
          <Button variant="outline-secondary" size="sm" className="fw-bold" onClick={loadCatalog} disabled={loading}>
            <RefreshCw size={14} className="me-1" /> Actualizar
          </Button>
          <Button variant="primary" size="sm" className="fw-bold" onClick={openInstalledSettings}>
            <SettingsShortcutIcon /> Configuracion
          </Button>
        </div>
      </div>

      <Alert variant="info" className="border-0 shadow-sm rounded-3 small">
        <div className="d-flex align-items-start gap-2">
          <ShieldCheck size={18} className="mt-1 flex-shrink-0" />
          <div>
            <strong>Modelo seguro V1.</strong> La tienda instala complementos registrados por Treseko. No ejecutan codigo externo ni acceden directo a la base de datos.
          </div>
        </div>
      </Alert>

      <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
        <div className="d-flex flex-wrap gap-2">
          {[
            ['all', 'Todos'],
            ['integration', 'Integraciones'],
            ['plugin', 'Plugins'],
            ['installed', 'Instalados'],
          ].map(([id, label]) => (
            <Button key={id} size="sm" variant={filter === id ? 'primary' : 'outline-secondary'} className="fw-bold rounded-pill" onClick={() => setFilter(id as any)}>
              {label}
            </Button>
          ))}
        </div>
        <Badge bg="primary" className="fw-bold p-2">Hub de Complementos</Badge>
      </div>

      {loading && items.length === 0 ? (
        <div className="py-5 text-center"><Spinner /></div>
      ) : (
        <Row className="g-3">
          {visibleItems.map(item => {
            const accent = PROVIDER_ACCENT[item.id] || (item.kind === 'integration' ? 'primary' : 'success')
            const status = item.instance?.status || item.status
            const locked = Boolean(item.premium_required && item.premium_feature && !hasSystemFeature?.(item.premium_feature))
            return (
              <Col xl={4} lg={6} key={item.id}>
                <Card className={`extension-market-card shadow-sm h-100 rounded-4 ${item.installed ? 'border-success-subtle' : 'border-light'} ${locked ? 'bg-light bg-opacity-50' : 'bg-white'}`}>
                  <Card.Body className={`p-4 d-flex flex-column ${locked ? 'opacity-75' : ''}`}>
                    <div className="d-flex justify-content-between align-items-start mb-3">
                      <div className={`bg-${accent} ${accent === 'dark' ? '' : 'bg-opacity-10'} p-2 rounded text-${accent}`}>
                        {item.kind === 'integration' ? <Plug size={24} /> : <Puzzle size={24} />}
                      </div>
                      <div className="d-flex flex-column align-items-end gap-1">
                        <Badge bg={statusVariant(status)} className="px-2 py-1 shadow-sm">
                          {item.builtin ? 'Incluido' : item.installed ? STATUS_LABELS[status] || status : STATUS_LABELS[item.status] || item.status}
                        </Badge>
                        {locked && <Badge bg="warning" text="dark" className="border"><Lock size={10} /> Premium</Badge>}
                      </div>
                    </div>
                    <div className="d-flex align-items-center gap-2 mb-2">
                      <h6 className="fw-bold text-dark mb-0 text-truncate" title={item.display_name}>{item.display_name}</h6>
                      <Badge bg="light" text="dark" className="border">{KIND_LABEL[item.kind]}</Badge>
                    </div>
                    <p className="small text-muted mb-4">{extensionDescription(item)}</p>
                    <div className="d-flex flex-wrap gap-1 mb-3">
                      {item.capabilities.slice(0, 3).map(capability => (
                        <Badge key={capability.id} bg="light" text="dark" className="border fw-normal" title={capability.id}>
                          {capability.label}
                        </Badge>
                      ))}
                    </div>
                    {renderAction(item)}
                  </Card.Body>
                </Card>
              </Col>
            )
          })}
          {visibleItems.length === 0 && (
            <Col>
              <Card className="border-0 shadow-sm rounded-3">
                <Card.Body className="text-center text-muted small">No hay complementos para este filtro.</Card.Body>
              </Card>
            </Col>
          )}
        </Row>
      )}
    </div>
  )
}

function SettingsShortcutIcon() {
  return <Box size={14} className="me-1" />
}
