import { useRef } from 'react'

export type CaseEditorSaveState = {
  created: boolean
  busy: boolean
  requestId: string | null
  saved: any | null
  definition: string | null
  projectId: string | null
}
export const emptyCaseEditorSaveState = (): CaseEditorSaveState => ({ created: false, busy: false, requestId: null, saved: null, definition: null, projectId: null })
export const useCaseEditorSaveState = () => useRef<CaseEditorSaveState>(emptyCaseEditorSaveState())
