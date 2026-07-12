import type { ReactNode } from 'react'

type RequiredLabelProps = {
  children: ReactNode
  required?: boolean
  className?: string
}

export function RequiredLabel({ children, required = false, className = '' }: RequiredLabelProps) {
  return (
    <span className={className}>
      {children}{required ? <span className="text-danger ms-1">*</span> : null}
    </span>
  )
}
