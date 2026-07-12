export type AttachmentMimeOption = {
  label: string
  value: string
  extra?: string
  extras?: string[]
}

export type AttachmentMimeGroup = {
  label: string
  options: AttachmentMimeOption[]
}

export const attachmentMimeGroups: AttachmentMimeGroup[] = [
  {
    label: 'Imágenes',
    options: [
      { label: 'PNG', value: 'image/png' },
      { label: 'JPG/JPEG', value: 'image/jpeg', extra: 'image/jpg' },
      { label: 'WEBP', value: 'image/webp' },
      { label: 'GIF', value: 'image/gif' },
    ],
  },
  {
    label: 'Documentos',
    options: [
      { label: 'PDF', value: 'application/pdf' },
      { label: 'TXT / LOG', value: 'text/plain' },
      { label: 'CSV', value: 'text/csv' },
      { label: 'JSON', value: 'application/json' },
      { label: 'XML', value: 'application/xml', extra: 'text/xml' },
      { label: 'ZIP', value: 'application/zip', extra: 'application/x-zip-compressed' },
    ],
  },
  {
    label: 'Office',
    options: [
      { label: 'XLS/XLSX', value: 'application/vnd.ms-excel', extra: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
      { label: 'DOC/DOCX', value: 'application/msword', extra: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
      { label: 'PPT/PPTX', value: 'application/vnd.ms-powerpoint', extra: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
    ],
  },
  {
    label: 'Videos',
    options: [
      { label: 'MP4', value: 'video/mp4' },
      { label: 'WEBM', value: 'video/webm' },
    ],
  },
  {
    label: 'Avanzado',
    options: [
      { label: 'BIN / octet-stream', value: 'application/octet-stream' },
    ],
  },
]

const attachmentMimeOptions = attachmentMimeGroups.flatMap(group => group.options)

type UseAttachmentMimeOptionsParams = {
  attachmentConfig: any
  setAttachmentConfig: (config: any) => void
}

export function useAttachmentMimeOptions({
  attachmentConfig,
  setAttachmentConfig,
}: UseAttachmentMimeOptionsParams) {
  const toggleAttachmentMime = (option: AttachmentMimeOption, checked: boolean) => {
    const values = [option.value, option.extra, ...(option.extras || [])].filter(Boolean)
    const current = attachmentConfig.allowed_mime_types || []
    const next = checked
      ? Array.from(new Set([...current, ...values]))
      : current.filter((item: string) => !values.includes(item))
    setAttachmentConfig({ ...attachmentConfig, allowed_mime_types: next })
  }

  return {
    attachmentMimeGroups,
    attachmentMimeOptions,
    toggleAttachmentMime,
  }
}
