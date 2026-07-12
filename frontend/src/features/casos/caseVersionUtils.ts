import { findSuiteById } from '../../testRepositoryUtils'

const caseVersionFields = [
  ['titulo', 'Título'],
  ['descripcion', 'Descripción'],
  ['precondiciones', 'Precondiciones'],
  ['postcondiciones', 'Postcondiciones'],
  ['prioridad', 'Prioridad'],
  ['criticidad', 'Criticidad'],
  ['tipo_prueba', 'Tipo'],
  ['estado_caso', 'Estado'],
  ['suite_id', 'Suite'],
  ['componente_id', 'Componente'],
  ['dataset', 'Dataset'],
  ['etiquetas', 'Etiquetas'],
  ['pasos', 'Pasos']
]

type CreateCaseVersionRowsParams = {
  suitesTree: any[]
  componentsList: any[]
}

export function createCaseVersionRows({ suitesTree, componentsList }: CreateCaseVersionRowsParams) {
  const formatCasoVersionValue = (key: string, value: any) => {
    if (value === null || value === undefined || value === '') return 'Sin valor'
    if (key === 'suite_id') return findSuiteById(suitesTree, value)?.nombre || value
    if (key === 'componente_id') return componentsList.find(c => c.id === value)?.name || value
    if (key === 'pasos') {
      if (!Array.isArray(value) || value.length === 0) return 'Sin pasos'
      return value
        .slice()
        .sort((a, b) => (a.numero_paso || 0) - (b.numero_paso || 0))
        .map(p => `${p.numero_paso}. ${p.accion || p.acción || ''}${p.resultado_esperado ? ` -> ${p.resultado_esperado}` : ''}`)
        .join('\n')
    }
    if (typeof value === 'object') return JSON.stringify(value, null, 2)
    return String(value)
  }

  return (current: any, selected: any) =>
    caseVersionFields.map(([key, label]) => {
      const before = selected?.[key]
      const after = current?.[key]
      return {
        key,
        label,
        before: formatCasoVersionValue(key, before),
        after: formatCasoVersionValue(key, after),
        changed: JSON.stringify(before ?? null) !== JSON.stringify(after ?? null)
      }
    })
}
