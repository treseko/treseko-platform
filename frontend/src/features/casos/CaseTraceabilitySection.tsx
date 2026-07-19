import { useEffect, useState } from 'react'
import { AlertTriangle, Link2 } from 'lucide-react'
import { Button, Card, Form } from 'react-bootstrap'
import { API_BASE } from '../../app/constants'

export function CaseTraceabilitySection({
  projectId, masterId, fetchWithAuth, storyIds, setStoryIds, editable = true,
}: any) {
  const [stories, setStories] = useState<any[]>([])
  const [linked, setLinked] = useState<any[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!projectId || !fetchWithAuth) return
    let active = true
    setLoading(true)
    Promise.all([
      fetchWithAuth(`${API_BASE}/proyectos/${projectId}/historias/`).then((response: Response) => response.ok ? response.json() : []),
      masterId ? fetchWithAuth(`${API_BASE}/casos/${masterId}/historias/`).then((response: Response) => response.ok ? response.json() : []) : Promise.resolve([]),
    ]).then(([available, current]) => {
      if (!active) return
      setStories(Array.isArray(available) ? available : [])
      setLinked(Array.isArray(current) ? current : [])
      if (masterId && !storyIds.length) setStoryIds((Array.isArray(current) ? current : []).map((item: any) => String(item.historia_id)))
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [projectId, masterId, fetchWithAuth])

  const linkedById = new Map(linked.map((item: any) => [String(item.historia_id), item]))
  const toggle = (id: string) => setStoryIds(storyIds.includes(id) ? storyIds.filter((item: string) => item !== id) : [...storyIds, id])

  return (
    <Card className="border-0 shadow-sm rounded-3 bg-white text-start mb-3 overflow-hidden">
      <div className="bg-light border-bottom py-2 px-3 d-flex align-items-center gap-2">
        <Link2 size={18} className="text-primary" />
        <h6 className="fw-bold text-dark m-0">Trazabilidad</h6>
      </div>
      <Card.Body className="p-3">
        {loading ? <span className="small text-muted">Cargando historias...</span> : stories.length === 0 ? <span className="small text-muted">No hay historias activas en este proyecto.</span> : (
          <div className="d-flex flex-column gap-2">
            {stories.map((story) => {
              const id = String(story.id)
              const current = linkedById.get(id)
              return <div key={id} className="border rounded-2 p-2 d-flex gap-2 align-items-start">
                <Form.Check aria-label={`Vincular ${story.codigo}`} checked={storyIds.includes(id)} disabled={!editable} onChange={() => toggle(id)} className="mt-1" />
                <div className="flex-grow-1 min-w-0">
                  <div className="small fw-bold text-primary">{story.codigo} · {story.titulo}</div>
                  <div className="x-small text-muted">{story.requisito_codigo} · {story.requisito_titulo}</div>
                  {current?.requiere_revision && <div className="x-small text-warning-emphasis mt-1 d-flex align-items-center gap-1"><AlertTriangle size={13} /> Requiere revisar este caso.</div>}
                </div>
                {current?.requiere_revision && masterId && editable && <Button size="sm" variant="outline-warning" title="Confirmar revisión" onClick={async () => {
                  const response = await fetchWithAuth(`${API_BASE}/casos/${masterId}/historias/${id}/confirmar-revision`, { method: 'POST' })
                  if (response.ok) setLinked(await response.json())
                }}>Revisado</Button>}
              </div>
            })}
          </div>
        )}
      </Card.Body>
    </Card>
  )
}
