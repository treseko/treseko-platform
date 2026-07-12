import { useState } from 'react'

type UseExecutionRunDetailParams = {
  loadTestRunDetail: (runId: string) => Promise<any>
}

export function useExecutionRunDetail({ loadTestRunDetail }: UseExecutionRunDetailParams) {
  const [executionRunDetail, setExecutionRunDetail] = useState<any | null>(null)
  const [executionRunDetailLoading, setExecutionRunDetailLoading] = useState(false)
  const [executionRunDetailError, setExecutionRunDetailError] = useState('')

  const openExecutionRunDetail = async (runId: string) => {
    setExecutionRunDetail(null)
    setExecutionRunDetailError('')
    setExecutionRunDetailLoading(true)
    try {
      const data = await loadTestRunDetail(runId)
      setExecutionRunDetail(data)
    } catch (error: any) {
      setExecutionRunDetailError(error.message || 'No se pudo cargar el detalle de la ejecucion')
    } finally {
      setExecutionRunDetailLoading(false)
    }
  }

  const closeExecutionRunDetail = () => {
    setExecutionRunDetail(null)
    setExecutionRunDetailError('')
  }

  return {
    executionRunDetail,
    executionRunDetailLoading,
    executionRunDetailError,
    openExecutionRunDetail,
    closeExecutionRunDetail,
  }
}
