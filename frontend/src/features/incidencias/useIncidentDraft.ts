import { useEffect, useRef, useState } from 'react'

const values = (incident: any) => ({
  estado: incident.estado || '', asignado_a: incident.asignado_a || '',
  resolucion: incident.resolucion || '', notas_qa: incident.notas_qa || '',
  resolution_build_id: '', motivo_cierre: '', comentario: '',
})
export type IncidentDraft = ReturnType<typeof values>

export function useIncidentDraft(incident: any) {
  const [form, setForm] = useState(() => values(incident))
  const baseline = useRef(values(incident))
  useEffect(() => {
    const next = values(incident)
    const old = baseline.current
    setForm(current => Object.fromEntries(Object.entries(next).map(([key, value]) => {
      const field = key as keyof IncidentDraft
      return [key, current[field] === old[field] ? value : current[field]]
    })) as IncidentDraft)
    baseline.current = next
  }, [incident.id, incident.estado, incident.asignado_a, incident.resolucion, incident.notas_qa])
  const dirty = Object.keys(form).some(key => form[key as keyof IncidentDraft] !== baseline.current[key as keyof IncidentDraft])
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  return { form, setForm, dirty, baseline }
}
