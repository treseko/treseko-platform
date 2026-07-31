import { useState } from 'react'
import { Button, Modal } from 'react-bootstrap'
import { AlertTriangle, CheckCircle2, Code, ListChecks, Terminal } from 'lucide-react'

export type ScriptValidationDetails = {
  valid: boolean
  hasWarnings: boolean
  message: string
  error?: string
  warnings: string[]
  checks: string[]
}

function formatValidationText(text: string) {
  return text
    .replace(/^Script y prueba validos$/i, 'El script y la prueba son validos.')
    .replace(/^Script valido con advertencias$/i, 'El script es valido, pero hay advertencias para revisar.')
    .replace(/^Sintaxis JavaScript valida\.$/i, 'La sintaxis JavaScript es valida.')
    .replace(/^Sintaxis Python valida\.$/i, 'La sintaxis Python es valida.')
    .replace(/^Funciones detectadas en el script:\s*/i, 'Funciones detectadas: ')
    .replace(/^Framework reconocido:\s*/i, 'Framework reconocido: ')
    .replace(/^Formato detectado: Playwright Test Runner$/i, 'Formato detectado: Playwright Test Runner.')
    .replace(/^Formato detectado: Funcion worker$/i, 'Formato detectado: funcion del worker.')
    .replace(/^Formato detectado: Spec Cypress$/i, 'Formato detectado: spec Cypress.')
    .replace(/^Formato detectado: Script Node\/Puppeteer$/i, 'Formato detectado: script Node/Puppeteer.')
    .replace(/^Formato detectado: Script Python\/Selenium$/i, 'Formato detectado: script Python/Selenium.')
}

export function ScriptValidationModal({
  validation,
  onHide
}: {
  validation: ScriptValidationDetails | null
  onHide: () => void
}) {
  const [showLog, setShowLog] = useState(false)
  if (!validation) return null

  const functionCheck = validation.checks.find((check) => /^Funciones detectadas en el script:/i.test(check))
  const otherChecks = validation.checks.filter((check) => check !== functionCheck)
  const variant = !validation.valid ? 'danger' : validation.hasWarnings ? 'warning' : 'success'
  const title = !validation.valid
    ? 'Script invalido'
    : validation.hasWarnings
      ? 'Script valido con advertencias'
      : 'Script valido'
  const logLines = [
    'Validacion estatica completada.',
    '',
    'No se ejecuto ningun navegador ni se envio ningun job al worker.',
    'Este detalle corresponde al chequeo de sintaxis, placeholders, contexto y funciones disponibles.',
    '',
    `Resultado: ${title}`,
    validation.error ? `Error detectado: ${validation.error}` : '',
    validation.warnings.length ? `Advertencias detectadas: ${validation.warnings.length}` : '',
    validation.checks.length ? `Chequeos correctos: ${validation.checks.length}` : '',
    functionCheck ? formatValidationText(functionCheck) : ''
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
          <div className="text-uppercase text-muted small fw-bold mb-1">Resultado</div>
          <div className="fw-semibold">{formatValidationText(validation.error || validation.message || title)}</div>
        </div>

        {validation.warnings.length > 0 && (
          <div className="border border-warning rounded-3 p-3 mb-3 bg-warning bg-opacity-10">
            <div className="text-uppercase small fw-bold mb-2 d-flex align-items-center gap-2">
              <AlertTriangle size={16} /> Advertencias
            </div>
            <ul className="mb-0 ps-3">
              {validation.warnings.map((warning, index) => (
                <li key={`${warning}-${index}`}>{formatValidationText(warning)}</li>
              ))}
            </ul>
          </div>
        )}

        {functionCheck && (
          <div className="border rounded-3 p-3 mb-3">
            <div className="text-uppercase text-muted small fw-bold mb-2 d-flex align-items-center gap-2">
              <Code size={16} /> Funciones detectadas
            </div>
            <div>{formatValidationText(functionCheck)}</div>
          </div>
        )}

        {otherChecks.length > 0 && (
          <div className="border rounded-3 p-3 mb-3">
            <div className="text-uppercase text-muted small fw-bold mb-2 d-flex align-items-center gap-2">
              <ListChecks size={16} /> Chequeos realizados
            </div>
            <ul className="mb-0 ps-3">
              {otherChecks.map((check, index) => (
                <li key={`${check}-${index}`}>{formatValidationText(check)}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="border rounded-3 p-3 mb-3 small bg-info bg-opacity-10">
          <strong>No se ejecuto ningun navegador.</strong> Esta validacion solo revisa sintaxis, placeholders, contexto y funciones disponibles.
          Para ver resultados reales del script, usa Dry-run con worker o ejecuta la prueba automatizada desde Ejecutar Pruebas.
        </div>

        <Button
          variant="outline-secondary"
          size="sm"
          className="fw-bold d-inline-flex align-items-center gap-2"
          onClick={() => setShowLog((current) => !current)}
        >
          <Terminal size={15} /> {showLog ? 'Ocultar detalle tecnico' : 'Ver detalle tecnico'}
        </Button>
        {showLog && (
          <pre className="mt-3 mb-0 bg-dark text-light rounded-3 p-3 small overflow-auto" style={{ maxHeight: 260, whiteSpace: 'pre-wrap' }}>
            {logLines}
          </pre>
        )}
      </Modal.Body>
      <Modal.Footer className="border-0 pt-0">
        <Button variant={variant === 'danger' ? 'danger' : variant === 'warning' ? 'warning' : 'success'} className="fw-bold rounded-pill px-4" onClick={onHide}>
          Entendido
        </Button>
      </Modal.Footer>
    </Modal>
  )
}
