import type { Dispatch, SetStateAction } from 'react'
import type { AttachmentMeta } from '../../EvidenceUpload'

type StepField = 'action' | 'data' | 'expected' | 'actionImg' | 'expectedImg'
type AttachmentField = 'actionAttachments' | 'expectedAttachments'

export function createCaseStepEditorActions(newTestSteps: any[], setNewTestSteps: Dispatch<SetStateAction<any[]>>) {
  const addStepInput = () => setNewTestSteps([...newTestSteps, { action: '', expected: '', data: '', actionImg: '', expectedImg: '' }])
  const removeStepInput = (index: number) => setNewTestSteps(newTestSteps.filter((_, itemIndex) => itemIndex !== index))
  const duplicateStepInput = (index: number) => {
    const source = newTestSteps[index]
    if (!source) return
    const duplicated = { ...source, actionAttachments: [...(source.actionAttachments || [])], expectedAttachments: [...(source.expectedAttachments || [])] }
    setNewTestSteps([...newTestSteps.slice(0, index + 1), duplicated, ...newTestSteps.slice(index + 1)])
  }
  const moveStepInput = (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1
    if (targetIndex < 0 || targetIndex >= newTestSteps.length) return
    const updated = [...newTestSteps]
    ;[updated[index], updated[targetIndex]] = [updated[targetIndex], updated[index]]
    setNewTestSteps(updated)
  }
  const handleStepInputChange = (index: number, field: StepField, value: string) => {
    const updated = [...newTestSteps]
    updated[index][field] = value
    setNewTestSteps(updated)
  }
  const updateStepAttachments = (index: number, field: AttachmentField, attachments: AttachmentMeta[]) => {
    setNewTestSteps(previous => previous.map((step, itemIndex) => itemIndex === index ? { ...step, [field]: attachments } : step))
  }
  return { addStepInput, removeStepInput, duplicateStepInput, moveStepInput, handleStepInputChange, updateStepAttachments }
}
