import { useEffect, useRef } from 'react'

type UseLiveRefreshOptions = {
  enabled: boolean
  intervalMs?: number
  refreshOnFocus?: boolean
  refreshOnMount?: boolean
  onRefresh: () => Promise<void> | void
}

export function useLiveRefresh({
  enabled,
  intervalMs = 0,
  refreshOnFocus = true,
  refreshOnMount = false,
  onRefresh,
}: UseLiveRefreshOptions) {
  const refreshRef = useRef(onRefresh)
  const runningRef = useRef(false)

  useEffect(() => {
    refreshRef.current = onRefresh
  }, [onRefresh])

  useEffect(() => {
    if (!enabled) return

    let cancelled = false
    const runRefresh = async () => {
      if (cancelled || document.hidden || runningRef.current) return
      runningRef.current = true
      try {
        await refreshRef.current()
      } finally {
        runningRef.current = false
      }
    }

    if (refreshOnMount) void runRefresh()

    const handleFocus = () => {
      if (refreshOnFocus) void runRefresh()
    }
    window.addEventListener('focus', handleFocus)
    document.addEventListener('visibilitychange', handleFocus)

    const timer = intervalMs > 0
      ? window.setInterval(() => void runRefresh(), intervalMs)
      : null

    return () => {
      cancelled = true
      window.removeEventListener('focus', handleFocus)
      document.removeEventListener('visibilitychange', handleFocus)
      if (timer) window.clearInterval(timer)
    }
  }, [enabled, intervalMs, refreshOnFocus, refreshOnMount])
}
