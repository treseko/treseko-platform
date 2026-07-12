import { useEffect, useRef, useState } from 'react'
import type { RealtimeConnectionStatus, RealtimeEvent } from './realtimeTypes'

type UseProjectRealtimeOptions = {
  enabled: boolean
  projectId?: string | null
  onEvent: (event: RealtimeEvent) => void
}

const MAX_SEEN_EVENTS = 250
const BACKOFF_MS = [1000, 2000, 5000, 10000, 15000]

function buildProjectSyncUrl(projectId: string) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/ws/project-sync/${encodeURIComponent(projectId)}`
}

export function useProjectRealtime({ enabled, projectId, onEvent }: UseProjectRealtimeOptions) {
  const [status, setStatus] = useState<RealtimeConnectionStatus>(enabled ? 'connecting' : 'disabled')
  const onEventRef = useRef(onEvent)
  const socketRef = useRef<WebSocket | null>(null)
  const retryRef = useRef(0)
  const reconnectTimerRef = useRef<number | null>(null)
  const seenEventsRef = useRef<string[]>([])
  const seenEventSetRef = useRef<Set<string>>(new Set())
  const closedByEffectRef = useRef(false)

  useEffect(() => {
    onEventRef.current = onEvent
  }, [onEvent])

  useEffect(() => {
    if (!enabled || !projectId) {
      setStatus('disabled')
      return
    }

    let disposed = false
    closedByEffectRef.current = false

    const clearReconnectTimer = () => {
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
    }

    const closeSocket = () => {
      closedByEffectRef.current = true
      socketRef.current?.close()
      socketRef.current = null
    }

    const rememberEvent = (event: RealtimeEvent) => {
      const key = event.event_id || `${event.event_type}:${event.timestamp || ''}:${event.project_id || ''}`
      if (!key) return false
      if (seenEventSetRef.current.has(key)) return false
      seenEventSetRef.current.add(key)
      seenEventsRef.current.push(key)
      while (seenEventsRef.current.length > MAX_SEEN_EVENTS) {
        const oldKey = seenEventsRef.current.shift()
        if (oldKey) seenEventSetRef.current.delete(oldKey)
      }
      return true
    }

    const scheduleReconnect = () => {
      if (disposed || document.hidden) {
        setStatus('polling')
        return
      }
      const delay = BACKOFF_MS[Math.min(retryRef.current, BACKOFF_MS.length - 1)]
      retryRef.current += 1
      setStatus(retryRef.current > 1 ? 'reconnecting' : 'polling')
      clearReconnectTimer()
      reconnectTimerRef.current = window.setTimeout(connect, delay)
    }

    const connect = () => {
      if (disposed || document.hidden) {
        setStatus('polling')
        return
      }
      if (
        socketRef.current
        && (socketRef.current.readyState === WebSocket.CONNECTING || socketRef.current.readyState === WebSocket.OPEN)
      ) {
        return
      }
      const token = localStorage.getItem('qa_access_token')
      if (!token) {
        setStatus('polling')
        return
      }

      closedByEffectRef.current = false
      setStatus(retryRef.current > 0 ? 'reconnecting' : 'connecting')
      const socket = new WebSocket(buildProjectSyncUrl(projectId))
      socketRef.current = socket

      socket.onopen = () => {
        retryRef.current = 0
        socket.send(JSON.stringify({ type: 'auth', token }))
      }

      socket.onmessage = (message) => {
        try {
          const event = JSON.parse(message.data) as RealtimeEvent
          if (!event?.event_type || !rememberEvent(event)) return
          if (event.event_type === 'realtime.connected') {
            setStatus('connected')
            return
          }
          if (event.event_type === 'realtime.pong') return
          onEventRef.current(event)
        } catch {
          // Ignore malformed realtime messages; REST loaders remain the source of truth.
        }
      }

      socket.onerror = () => {
        setStatus('polling')
      }

      socket.onclose = () => {
        socketRef.current = null
        if (!closedByEffectRef.current) scheduleReconnect()
      }
    }

    const handleVisibilityChange = () => {
      if (document.hidden) {
        closeSocket()
        setStatus('polling')
        return
      }
      closedByEffectRef.current = false
      retryRef.current = 0
      connect()
    }

    connect()
    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('focus', handleVisibilityChange)

    return () => {
      disposed = true
      clearReconnectTimer()
      closeSocket()
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('focus', handleVisibilityChange)
    }
  }, [enabled, projectId])

  return { status }
}
