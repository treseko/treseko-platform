import { useCallback, useEffect, useRef } from 'react'

/** Invalidates async work immediately on context change and on unmount. */
export function useReportContextGuard(context: string) {
  const state = useRef({ context, generation: 0, active: true })
  if (state.current.context !== context) {
    state.current.context = context
    state.current.generation += 1
  }
  useEffect(() => {
    state.current.active = true
    return () => { state.current.active = false; state.current.generation += 1 }
  }, [])
  return useCallback(() => {
    const generation = state.current.generation
    return () => state.current.active && state.current.generation === generation
  }, [])
}
