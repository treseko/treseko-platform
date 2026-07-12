import { useEffect, useMemo, useState } from 'react'
import { Alert, Badge, Button, Card, Col, Row, Spinner, Table } from 'react-bootstrap'
import { Code, Copy } from 'lucide-react'
import { API_BASE } from '../../../app/constants'

type AutomationCodesPanelProps = {
  organizations: any[]
  projectsList: any[]
  componentsList: any[]
  buildsList: any[]
  buildCaseIds: Record<string, string[]>
  currentOrgId: string
  currentProjectId: string
  currentCompId: string
  currentBuildId: string
  currentProjectCases: any[]
  currentComponentCases: any[]
  projectsSource: 'local' | 'backend'
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>
  copyToClipboard: (value: string, label?: string) => void
}

export function AutomationCodesPanel({
  organizations,
  projectsList,
  componentsList,
  buildsList,
  buildCaseIds,
  currentOrgId,
  currentProjectId,
  currentCompId,
  currentBuildId,
  currentProjectCases,
  currentComponentCases,
  projectsSource,
  fetchWithAuth,
  copyToClipboard,
}: AutomationCodesPanelProps) {
  const [backendCases, setBackendCases] = useState<any[]>([])
  const [backendCasesTotal, setBackendCasesTotal] = useState(0)
  const [backendCasesLoading, setBackendCasesLoading] = useState(false)
  const [backendCasesError, setBackendCasesError] = useState('')
  const currentOrg = organizations.find(org => org.id === currentOrgId)
  const currentProject = projectsList.find(project => project.id === currentProjectId)
  const currentComponent = componentsList.find(component => component.id === currentCompId)
  const currentBuild = buildsList.find(build => build.id === currentBuildId)
  const componentNameById = new Map(componentsList.map(component => [component.id, component.name || component.nombre]))
  const getCaseCode = (test: any) => test?.code || test?.codigo || ''
  const getCaseTitle = (test: any) => test?.title || test?.titulo || 'Sin titulo'
  const getCasePriority = (test: any) => test?.priority || test?.prioridad || 'MEDIA'
  const getCaseComponentId = (test: any) => test?.componentId || test?.componente_id || ''
  const displayComponentName = (test: any) =>
    componentNameById.get(getCaseComponentId(test)) || test.component || 'Sin componente asignado'

  useEffect(() => {
    if (projectsSource !== 'backend' || !currentProjectId) {
      setBackendCases([])
      setBackendCasesTotal(0)
      setBackendCasesError('')
      setBackendCasesLoading(false)
      return
    }
    let cancelled = false
    const loadBackendCases = async () => {
      setBackendCasesLoading(true)
      setBackendCasesError('')
      try {
        const params = new URLSearchParams({ skip: '0', limit: '20' })
        if (currentCompId) params.set('component_id', currentCompId)
        if (currentBuildId) params.set('build_id', currentBuildId)
        const response = await fetchWithAuth(`${API_BASE}/proyectos/${currentProjectId}/casos/search?${params.toString()}`)
        if (!response.ok) throw new Error(await response.text())
        const payload = await response.json()
        if (cancelled) return
        setBackendCases(Array.isArray(payload?.items) ? payload.items : [])
        setBackendCasesTotal(Number(payload?.total || 0))
      } catch (error: any) {
        if (cancelled) return
        setBackendCases([])
        setBackendCasesTotal(0)
        setBackendCasesError(error?.message || 'No se pudieron cargar casos del contexto.')
      } finally {
        if (!cancelled) setBackendCasesLoading(false)
      }
    }
    loadBackendCases()
    return () => {
      cancelled = true
    }
  }, [projectsSource, currentProjectId, currentCompId, currentBuildId, fetchWithAuth])

  const localVisibleCases = useMemo(() => {
    if (projectsSource === 'backend') return []
    const activeBuildCaseIds = currentBuildId ? buildCaseIds[currentBuildId] || [] : []
    const activeBuildCases = activeBuildCaseIds.length > 0
      ? currentProjectCases.filter(test => activeBuildCaseIds.includes(test.id))
      : []
    return currentBuildId
      ? activeBuildCases
      : (currentComponentCases.length > 0 ? currentComponentCases : currentProjectCases)
  }, [buildCaseIds, currentBuildId, currentComponentCases, currentProjectCases, projectsSource])

  const visibleCases = projectsSource === 'backend' ? backendCases : localVisibleCases.slice(0, 20)
  const visibleCasesTotal = projectsSource === 'backend' ? backendCasesTotal : localVisibleCases.length

  const solutionCode = currentOrg?.code || ''
  const projectCode = currentProject?.code || ''
  const componentCode = currentComponent?.code || ''
  const buildCode = currentBuild?.code || ''

  const codeRows = [
    { label: 'solution_code', value: solutionCode, name: currentOrg?.name || 'Sin solucion' },
    { label: 'project_code', value: projectCode, name: currentProject?.name || 'Sin proyecto' },
    { label: 'component_code', value: componentCode, name: currentComponent?.name || 'Sin componente' },
    { label: 'build_code', value: buildCode, name: currentBuild?.name || 'Sin build' },
  ]

  const sampleCase = visibleCases[0]
  const samplePayload = JSON.stringify({
    solution_code: solutionCode || 'SOL-xxxxxxxx',
    project_code: projectCode || 'PRJ-xxxxxxxx',
    component_code: componentCode || 'CMP-xxxxxxxx',
    build_code: buildCode || 'BLD-xxxxxxxx',
    external_run_id: 'playwright-main-001',
    environment: 'qa',
    overwrite: true,
    cases: [{
      case_code: getCaseCode(sampleCase) || 'TC-0001',
      status: 'PASO',
      observations: 'Prueba ejecutada desde runner externo',
    }],
  }, null, 2)

  return (
    <Card className="border-0 shadow-sm rounded-4 bg-white p-4 mt-4">
      <div className="d-flex justify-content-between align-items-start gap-3 mb-3">
        <div>
          <h6 className="fw-bold text-dark mb-1 d-flex align-items-center gap-2">
            <Code size={20} className="text-primary" />
            Códigos para automatización externa
          </h6>
          <p className="small text-muted mb-0">
            Usa estos valores en <code>POST /external/executions/report</code>.
          </p>
        </div>
        <Button variant="outline-primary" size="sm" className="fw-bold" onClick={() => copyToClipboard(samplePayload, 'Payload ejemplo')}>
          <Copy size={14} className="me-1" /> Copiar JSON
        </Button>
      </div>

      {projectsSource !== 'backend' && (
        <Alert variant="warning" className="small">
          Los códigos externos solo están disponibles con datos sincronizados desde backend.
        </Alert>
      )}

      <Row className="g-3 mb-3">
        {codeRows.map(row => (
          <Col md={3} key={row.label}>
            <div className="border rounded-3 bg-light p-3 h-100">
              <div className="x-small fw-bold text-muted text-uppercase mb-1">{row.label}</div>
              <div className="small text-dark text-truncate mb-2" title={row.name}>{row.name}</div>
              <div className="d-flex align-items-center gap-2">
                <code className={`small flex-grow-1 ${row.value ? 'text-primary' : 'text-muted'}`}>{row.value || 'No disponible'}</code>
                <Button variant="link" size="sm" className="p-0" disabled={!row.value} title={`Copiar ${row.label}`} onClick={() => copyToClipboard(row.value, row.label)}>
                  <Copy size={14} />
                </Button>
              </div>
            </div>
          </Col>
        ))}
      </Row>

      <div className="d-flex justify-content-between align-items-center mb-2">
        <span className="small fw-bold text-dark">Casos del contexto actual</span>
        <Badge bg="primary">{visibleCasesTotal} caso(s)</Badge>
      </div>
      {backendCasesError && <Alert variant="warning" className="small py-2">{backendCasesError}</Alert>}
      <Table hover size="sm" className="mb-3 align-middle">
        <thead className="table-light">
          <tr>
            <th>case_code</th>
            <th>Nombre</th>
            <th>Componente</th>
            <th>Prioridad</th>
            <th className="text-end">Copiar</th>
          </tr>
        </thead>
        <tbody>
          {backendCasesLoading && (
            <tr><td colSpan={5} className="text-center py-4 text-muted small"><Spinner size="sm" className="me-2" />Cargando casos del contexto...</td></tr>
          )}
          {!backendCasesLoading && visibleCases.map((test: any) => (
            <tr key={test.id}>
              <td><code className="small text-primary">{getCaseCode(test)}</code></td>
              <td className="small fw-semibold text-dark">{getCaseTitle(test)}</td>
              <td className="small text-muted">{displayComponentName(test)}</td>
              <td><Badge bg={getCasePriority(test) === 'ALTA' ? 'danger' : getCasePriority(test) === 'MEDIA' ? 'warning' : 'secondary'}>{getCasePriority(test)}</Badge></td>
              <td className="text-end">
                <Button variant="link" size="sm" className="p-0" onClick={() => copyToClipboard(getCaseCode(test), 'case_code')}>
                  <Copy size={14} />
                </Button>
              </td>
            </tr>
          ))}
          {!backendCasesLoading && visibleCases.length === 0 && (
            <tr><td colSpan={5} className="text-center py-4 text-muted small">No hay casos cargados para este proyecto/componente.</td></tr>
          )}
        </tbody>
      </Table>
      {visibleCasesTotal > visibleCases.length && (
        <div className="x-small text-muted mb-3">Mostrando los primeros {visibleCases.length} de {visibleCasesTotal} casos del contexto.</div>
      )}

      <pre className="bg-dark text-light p-3 rounded-3 small mb-0 overflow-auto" style={{ fontSize: '11px' }}>{samplePayload}</pre>
    </Card>
  )
}
