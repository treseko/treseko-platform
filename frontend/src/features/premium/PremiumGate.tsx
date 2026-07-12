import { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { Alert, Badge, Button, Card } from 'react-bootstrap'
import { Crown, Lock } from 'lucide-react'
import { featureEnabled, type FeatureLookup } from './featureAccess'

type PremiumGateMode = 'disabled' | 'card' | 'inline' | 'hidden'

type PremiumGateProps = {
  feature: string
  hasFeature?: FeatureLookup
  title: string
  description: string
  mode?: PremiumGateMode
  children?: ReactNode
  className?: string
  onRequestPremium?: () => void
}

export function PremiumGate({
  feature,
  hasFeature,
  title,
  description,
  mode = 'disabled',
  children,
  className = '',
  onRequestPremium,
}: PremiumGateProps) {
  const enabled = featureEnabled(hasFeature, feature)
  if (enabled) return <>{children}</>
  if (mode === 'hidden') return null

  if (mode === 'card') {
    return (
      <Card className={`premium-gate-card border-0 shadow-sm rounded-4 bg-white ${className}`}>
        <Card.Body className="d-flex flex-column flex-md-row align-items-start justify-content-between gap-3">
          <div className="d-flex align-items-start gap-2">
            <Crown size={18} className="text-warning mt-1 flex-shrink-0" />
            <div>
              <h6 className="fw-bold mb-1 text-dark">{title}</h6>
              <div className="small text-muted">{description}</div>
            </div>
          </div>
          <div className="d-flex align-items-center gap-2 flex-shrink-0">
            <Badge bg="warning" text="dark" className="border">Premium</Badge>
            {onRequestPremium && (
              <Button variant="outline-primary" size="sm" className="fw-bold rounded-pill" onClick={onRequestPremium}>
                Solicitar Premium
              </Button>
            )}
          </div>
        </Card.Body>
      </Card>
    )
  }

  if (mode === 'inline') {
    return (
      <Alert variant="warning" className={`border-warning-subtle small mb-0 ${className}`}>
        <div className="d-flex align-items-start gap-2">
          <Lock size={16} className="mt-1" />
          <div>
            <strong>{title}</strong>
            <div>{description}</div>
          </div>
        </div>
      </Alert>
    )
  }

  const disabledChild = isValidElement(children)
    ? cloneElement(children as ReactElement<any>, {
        className: `${(children as ReactElement<any>).props?.className || ''} premium-gate-control`.trim(),
        disabled: true,
        title,
        onClick: (event: any) => {
          event?.preventDefault?.()
          event?.stopPropagation?.()
        },
      })
    : children

  return (
    <span className={`premium-gate-toolbar ${className}`} title={description}>
      {disabledChild}
      <span className="premium-gate-toolbar-label">
        <Lock size={12} /> Premium
      </span>
    </span>
  )
}
