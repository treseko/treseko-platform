import { Badge, Button, Card } from 'react-bootstrap'
import { Crown } from 'lucide-react'
import { useI18n } from '../../../i18n'

type Props = {
  title: string
  description: string
  bullets: string[]
  onOpenLicense: () => void
}

export function PremiumLockedSettingsPanel({ title, description, bullets, onOpenLicense }: Props) {
  const { t } = useI18n()
  return (
    <div className="animate__animated animate__fadeIn">
      <Card className="border-0 shadow-sm rounded-4 bg-white p-4">
        <div className="d-flex flex-column flex-md-row justify-content-between align-items-start gap-3">
          <div>
            <Badge bg="warning" text="dark" className="border mb-3 d-inline-flex align-items-center gap-1">
              <Crown size={14} /> {t('configuracion.premiumBadge')}
            </Badge>
            <h5 className="fw-bold text-dark mb-2">{title}</h5>
            <p className="text-muted mb-3">{description}</p>
            <div className="d-flex flex-column gap-2">
              {bullets.map(item => (
                <div key={item} className="small text-secondary d-flex align-items-start gap-2">
                  <span className="text-primary fw-bold">•</span>
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>
          <Button variant="outline-primary" className="fw-bold rounded-pill px-4" onClick={onOpenLicense}>
            {t('configuracion.premiumLockedViewLicense')}
          </Button>
        </div>
      </Card>
    </div>
  )
}
