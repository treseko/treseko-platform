import { Badge, ListGroup } from 'react-bootstrap'
import { Bot, LayoutList } from 'lucide-react'
import { useI18n } from '../../i18n'
import { migrateOpeningMessageToTurn, normalizeChatbotConfig } from '../casos/chatbotConfig'
import { executionStatusLabel } from './executionPresentation'
import { getManualConsoleCaseStatus } from './manualConsoleStatus'

type Props = {
  activeExecutionTests: any[]
  selectedTest: any
  currentExecutionRun: any
  currentExecutionCase: any
  statusByCaseId?: Record<string, string>
  handleSelectTestForExecution?: (test: any) => void
}

const configuredTurnCount = (test: any) => {
  const config = normalizeChatbotConfig(
    migrateOpeningMessageToTurn(test?.configuracion_chatbot || {}),
  )
  return Array.isArray(config.conversation?.turns) ? config.conversation.turns.length : 0
}

export function ChatbotManualTestListSidebar({
  activeExecutionTests,
  selectedTest,
  currentExecutionRun,
  currentExecutionCase,
  statusByCaseId = {},
  handleSelectTestForExecution,
}: Props) {
  const { t } = useI18n()

  return (
    <div
      className="manual-console-sidebar bg-white border-end d-flex flex-column flex-shrink-0 z-0"
      style={{ width: '290px' }}
      aria-label={t('ejecutarPruebas.chatbotBatchAria')}
    >
      <div className="p-3 bg-light border-bottom">
        <h6 className="fw-bold text-dark m-0 d-flex align-items-center gap-2">
          <LayoutList size={16} className="text-primary" /> {t('ejecutarPruebas.chatbotBatch')}
        </h6>
        <div className="text-muted x-small mt-1">
          {t('ejecutarPruebas.chatbotSelectedCases', { count: activeExecutionTests.length })}
        </div>
      </div>
      <ListGroup variant="flush" className="overflow-auto flex-grow-1 pb-4">
        {activeExecutionTests.map((test: any) => {
          const isActive = selectedTest?.id === test.id
          const currentStatus = getManualConsoleCaseStatus({
            testId: test.id,
            selectedTestId: selectedTest?.id,
            currentExecutionCase,
            currentRun: currentExecutionRun,
            historicalStatus: test.lastResult,
            localStatus: statusByCaseId[String(test.id)],
          })
          const count = configuredTurnCount(test)
          return (
            <ListGroup.Item
              key={test.id}
              action
              active={isActive}
              onClick={() => handleSelectTestForExecution?.(test)}
              className={`border-bottom p-3 cursor-pointer ${isActive ? 'bg-primary bg-opacity-10 border-start border-4 border-primary' : 'hover-bg-light'}`}
            >
              <div className="d-flex justify-content-between align-items-center mb-1">
                <span className={`font-monospace fw-bold x-small ${isActive ? 'text-primary' : 'text-secondary'}`}>
                  {test.code || test.id.slice(0, 8).toUpperCase()}
                </span>
                <Badge bg={currentStatus === 'EN CURSO' ? 'info' : currentStatus === 'PASO' ? 'success' : currentStatus === 'FALLO' ? 'danger' : currentStatus === 'BLOQUEADO' ? 'primary' : 'secondary'} className="x-small">
                  {currentStatus === 'EN CURSO' ? t('ejecutarPruebas.chatbotInProgress') : executionStatusLabel(currentStatus, t)}
                </Badge>
              </div>
              <div
                className={`small fw-semibold text-truncate ${isActive ? 'text-dark' : 'text-muted'}`}
                title={test.title}
              >
                {test.title}
              </div>
              <div className="d-flex flex-wrap gap-2 mt-2">
                <Badge bg="light" text="dark" className="border x-small">
                  <Bot size={12} className="me-1" />
                  {t('ejecutarPruebas.chatbotTurns', { count })}
                </Badge>
              </div>
            </ListGroup.Item>
          )
        })}
      </ListGroup>
    </div>
  )
}
