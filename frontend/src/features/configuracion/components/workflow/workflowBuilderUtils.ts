import type { AiWorkflow } from '../../types/configuracion'

export const WORKFLOW_PORTABLE_EXPORT_LABEL = 'Exportar workflow portable'
export const WORKFLOW_PORTABLE_IMPORT_LABEL = 'Importar workflow portable'
export const canExportPortableWorkflow = (workflow?: AiWorkflow | null) => workflow?.workflow_format === 'universal_v2'
