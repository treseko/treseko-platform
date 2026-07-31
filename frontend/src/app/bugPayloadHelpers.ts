export const buildBugExecutionDetails = ({
  activeSnapshots,
  stepResults,
  snapshotNotes,
  test,
  buildName,
  historyItem,
  snapshotStatus,
  snapshotNote,
}: any) => {
  const executedSteps = activeSnapshots.map((item: any) => {
    const status = stepResults[item.numero_paso] || item.estado_paso || 'SIN_CORRER'
    const itemNote = snapshotNotes[item.numero_paso] || item.comentarios || item.error_log || ''
    return {
      numero_paso: item.numero_paso,
      accion: item.accion_congelada || 'Ejecutar paso congelado',
      datos: item.datos_resueltos || item.datos_congelados || null,
      esperado: item.resultado_esperado_congelado || null,
      veredicto: status,
      observacion: itemNote || null,
    }
  })
  const reproductionSteps = activeSnapshots.length > 0
    ? activeSnapshots.map((item: any) => {
      const status = stepResults[item.numero_paso] || item.estado_paso || 'SIN_CORRER'
      const itemNote = snapshotNotes[item.numero_paso] || item.comentarios || item.error_log || ''
      return [
        `${item.numero_paso}. ${item.accion_congelada || 'Ejecutar paso congelado'} -> ${status}`,
        item.datos_resueltos || item.datos_congelados ? `   Datos: ${item.datos_resueltos || item.datos_congelados}` : null,
        item.resultado_esperado_congelado ? `   Esperado: ${item.resultado_esperado_congelado}` : null,
        itemNote ? `   Observacion: ${itemNote}` : null,
      ].filter(Boolean).join('\n')
    }).join('\n')
    : [
      `1. Ejecutar caso ${test?.code || test?.codigo || test?.title || 'seleccionado'} en build ${buildName}.`,
      historyItem.environmentName ? `2. Usar ambiente ${historyItem.environmentName}${historyItem.datasetName ? ` con dataset ${historyItem.datasetName}` : ''}.` : null,
      `3. Registrar veredicto general ${snapshotStatus || 'FALLO'}.`,
      `4. Validar observacion: ${snapshotNote || 'sin observacion adicional'}.`,
    ].filter(Boolean).join('\n')
  return { executedSteps, reproductionSteps }
}
