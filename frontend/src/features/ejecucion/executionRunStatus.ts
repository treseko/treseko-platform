export function getExecutionStatusesByCaseId(executions: any[]) {
  return Object.fromEntries(
    executions.map((execution: any) => [
      String(execution.caso_id),
      execution.estado_resultado || 'SIN_CORRER',
    ])
  )
}
