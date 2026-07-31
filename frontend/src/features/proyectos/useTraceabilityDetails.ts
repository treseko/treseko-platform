import { useEffect, useState } from 'react'
import { API_BASE } from '../../app/constants'

export function useTraceabilityDetails(options: any) {
  const { stories, fetchWithAuth, readJson } = options
  const [caseGenerationStory, setCaseGenerationStory] = useState<any>(null)
  const [detailItem, setDetailItem] = useState<{ kind: 'requirement' | 'story'; item: any } | null>(null)
  const [linkedStoryCases, setLinkedStoryCases] = useState<any[]>([])
  const [linkedStoryCasesLoading, setLinkedStoryCasesLoading] = useState(false)
  useEffect(() => {
    if (detailItem?.kind !== 'story') {
      setLinkedStoryCases([])
      return
    }
    let cancelled = false
    setLinkedStoryCasesLoading(true)
    fetchWithAuth(`${API_BASE}/historias/${detailItem.item.id}/casos/`)
      .then(readJson)
      .then((items: any) => { if (!cancelled) setLinkedStoryCases(Array.isArray(items) ? items : []) })
      .catch(() => { if (!cancelled) setLinkedStoryCases([]) })
      .finally(() => { if (!cancelled) setLinkedStoryCasesLoading(false) })
    return () => { cancelled = true }
  }, [detailItem?.item?.id, detailItem?.kind])
  const openDetails = (kind: 'requirement' | 'story', item: any) => setDetailItem({ kind, item })
  const storiesForRequirement = (requirementId: string) => stories.filter((item: any) => item.requisito_id === requirementId)
  return { caseGenerationStory, setCaseGenerationStory, detailItem, setDetailItem, linkedStoryCases, linkedStoryCasesLoading, openDetails, storiesForRequirement }
}
