import { useState } from 'react'
import { Button, Modal } from 'react-bootstrap'
import { AlertTriangle, CheckCircle2, Code, ListChecks, Terminal } from 'lucide-react'
import { useI18n } from '../../i18n'

export type ScriptValidationDetails = {
  valid: boolean
  hasWarnings: boolean
  message: string
  error?: string
  warnings: string[]
  checks: string[]
}

function formatValidationText(text: string, t: (key: string, vars?: Record<string, string | number>) => string) {
  return text
    .replace(/^Script y prueba validos$/i, t('automatizacion.validationScriptAndCaseValid'))
    .replace(/^Script valido con advertencias$/i, t('automatizacion.validationScriptWarnings'))
    .replace(/^Sintaxis JavaScript valida\.$/i, t('automatizacion.validationJavaScript'))
    .replace(/^Sintaxis Python valida\.$/i, t('automatizacion.validationPython'))
    .replace(/^Funciones detectadas en el script:\s*/i, `${t('automatizacion.validationFunctions')}: `)
    .replace(/^Framework reconocido:\s*/i, `${t('automatizacion.validationFramework')}: `)
    .replace(/^Formato detectado: Playwright Test Runner$/i, t('automatizacion.validationPlaywrightFormat'))
    .replace(/^Formato detectado: Funcion worker$/i, t('automatizacion.validationWorkerFormat'))
    .replace(/^Formato detectado: Spec Cypress$/i, t('automatizacion.validationCypressFormat'))
    .replace(/^Formato detectado: Script Node\/Puppeteer$/i, t('automatizacion.validationPuppeteerFormat'))
    .replace(/^Formato detectado: Script Python\/Selenium$/i, t('automatizacion.validationSeleniumFormat'))
}

export function ScriptValidationModal({
  validation,
  onHide
}: {
  validation: ScriptValidationDetails | null
  onHide: () => void
}) {
  const { t } = useI18n()
  const [showLog, setShowLog] = useState(false)
  if (!validation) return null

  const functionCheck = validation.checks.find((check) => /^Funciones detectadas en el script:/i.test(check))
  const otherChecks = validation.checks.filter((check) => check !== functionCheck)
  const variant = !validation.valid ? 'danger' : validation.hasWarnings ? 'warning' : 'success'
  const title = !validation.valid
    ? t('automatizacion.invalidScript')
    : validation.hasWarnings
      ? t('automatizacion.validScriptWithWarnings')
      : t('automatizacion.validScript')
  const logLines = [
    t('automatizacion.validationStaticComplete'),
    '',
    t('automatizacion.validationNoBrowser'),
    t('automatizacion.validationScope'),
    '',
    `${t('automatizacion.validationResult')}: ${title}`,
    validation.error ? t('automatizacion.validationDetectedError', { error: validation.error }) : '',
    validation.warnings.length ? t('automatizacion.validationWarningsCount', { count: validation.warnings.length }) : '',
    validation.checks.length ? t('automatizacion.validationChecksCount', { count: validation.checks.length }) : '',
    functionCheck ? formatValidationText(functionCheck, t) : ''
  ].filter(Boolean).join('\n')

  return (
    <Modal show={Boolean(validation)} onHide={onHide} centered size="lg">
      <Modal.Header closeButton className={`border-0 ${variant === 'danger' ? 'bg-danger text-white' : variant === 'warning' ? 'bg-warning text-dark' : 'bg-success text-white'}`}>
        <Modal.Title className="fw-bold d-flex align-items-center gap-2">
          {variant === 'success' ? <CheckCircle2 size={22} /> : <AlertTriangle size={22} />} {title}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body className="p-4 text-dark">
        <div className="border rounded-3 p-3 mb-3 bg-light">
          <div className="text-uppercase text-muted small fw-bold mb-1">{t('automatizacion.validationResult')}</div>
          <div className="fw-semibold">{formatValidationText(validation.error || validation.message || title, t)}</div>
        </div>

        {validation.warnings.length > 0 && (
          <div className="border border-warning rounded-3 p-3 mb-3 bg-warning bg-opacity-10">
            <div className="text-uppercase small fw-bold mb-2 d-flex align-items-center gap-2">
              <AlertTriangle size={16} /> {t('automatizacion.validationWarnings')}
            </div>
            <ul className="mb-0 ps-3">
              {validation.warnings.map((warning, index) => (
                <li key={`${warning}-${index}`}>{formatValidationText(warning, t)}</li>
              ))}
            </ul>
          </div>
        )}

        {functionCheck && (
          <div className="border rounded-3 p-3 mb-3">
            <div className="text-uppercase text-muted small fw-bold mb-2 d-flex align-items-center gap-2">
              <Code size={16} /> {t('automatizacion.validationFunctions')}
            </div>
              <div>{formatValidationText(functionCheck, t)}</div>
          </div>
        )}

        {otherChecks.length > 0 && (
          <div className="border rounded-3 p-3 mb-3">
            <div className="text-uppercase text-muted small fw-bold mb-2 d-flex align-items-center gap-2">
              <ListChecks size={16} /> {t('automatizacion.validationChecks')}
            </div>
            <ul className="mb-0 ps-3">
              {otherChecks.map((check, index) => (
                <li key={`${check}-${index}`}>{formatValidationText(check, t)}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="border rounded-3 p-3 mb-3 small bg-info bg-opacity-10">
          <strong>{t('automatizacion.validationNoBrowserStrong')}</strong> {t('automatizacion.validationOnlyChecks')}
          {' '}{t('automatizacion.validationRealResults')}
        </div>

        <Button
          variant="outline-secondary"
          size="sm"
          className="fw-bold d-inline-flex align-items-center gap-2"
          onClick={() => setShowLog((current) => !current)}
        >
          <Terminal size={15} /> {showLog ? t('automatizacion.hideTechnicalDetail') : t('automatizacion.viewTechnicalDetail')}
        </Button>
        {showLog && (
          <pre className="mt-3 mb-0 bg-dark text-light rounded-3 p-3 small overflow-auto" style={{ maxHeight: 260, whiteSpace: 'pre-wrap' }}>
            {logLines}
          </pre>
        )}
      </Modal.Body>
      <Modal.Footer className="border-0 pt-0">
        <Button variant={variant === 'danger' ? 'danger' : variant === 'warning' ? 'warning' : 'success'} className="fw-bold rounded-pill px-4" onClick={onHide}>
          {t('automatizacion.understood')}
        </Button>
      </Modal.Footer>
    </Modal>
  )
}
