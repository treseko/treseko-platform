import type { AiWorkflow } from '../../types/configuracion'

export const WORKFLOW_PORTABLE_EXPORT_LABEL = 'Exportar workflow portable'
export const WORKFLOW_PORTABLE_IMPORT_LABEL = 'Importar workflow portable'
export const canExportPortableWorkflow = (workflow?: AiWorkflow | null) => ['universal_v2', 'universal_v3'].includes(String(workflow?.workflow_format))
