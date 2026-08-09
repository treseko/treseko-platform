import { Badge, ListGroup } from 'react-bootstrap'
import { LayoutList } from 'lucide-react'
import { getManualConsoleCaseStatus } from './manualConsoleStatus'

export function ManualConsoleTestListSidebar({ context }: { context: any }) {
  const { t, activeExecutionTests, selectedTest, currentExecutionRun, currentExecutionCase, handleSelectTestForExecution, getStatusColor, executionSnapshots, getExecutionReferenceCount } = context

  return (
    <div className="manual-console-sidebar bg-white border-end d-flex flex-column flex-shrink-0 z-0" style={{ width: '290px' }}>
      <div className="p-3 bg-light border-bottom">
        <h6 className="fw-bold text-dark m-0 d-flex align-items-center gap-2">
          <LayoutList size={16} className="text-primary"/> {t('ejecutarPruebas.executionBatch')}
        </h6>
        <div className="text-muted x-small mt-1">{activeExecutionTests.length} {t('ejecutarPruebas.selectedCasesForCycle')}</div>
      </div>
      <ListGroup variant="flush" className="overflow-auto flex-grow-1 pb-4">
        {activeExecutionTests.map((test: any) => {
          const isActive = selectedTest.id === test.id
          const currentStatus = getManualConsoleCaseStatus({
            testId: test.id,
            selectedTestId: selectedTest?.id,
            currentExecutionCase,
            currentRun: currentExecutionRun,
            historicalStatus: test.lastResult,
          })
          return (
            <ListGroup.Item key={test.id} action active={isActive} onClick={() => handleSelectTestForExecution(test)} className={`border-bottom p-3 cursor-pointer ${isActive ? 'bg-primary bg-opacity-10 border-start border-4 border-primary' : 'hover-bg-light'}`}>
              <div className="d-flex justify-content-between align-items-center mb-1">
                <span className={`font-monospace fw-bold x-small ${isActive ? 'text-primary' : 'text-secondary'}`}>
                  {test.code || test.id.slice(0, 8).toUpperCase()}
                </span>
                <Badge bg={currentStatus === 'EN CURSO' ? 'info' : getStatusColor(currentStatus)} className="x-small" style={{ fontSize: 'var(--app-font-size-meta)' }}>
                  {currentStatus}
                </Badge>
              </div>
              <div className={`small fw-semibold text-truncate ${isActive ? 'text-dark' : 'text-muted'}`} title={test.title}>{test.title}</div>
              <div className="d-flex flex-wrap gap-2 mt-2">
                <Badge bg="light" text="dark" className="border x-small">{isActive ? executionSnapshots.length : (test.stepsCount || 0)} pasos</Badge>
                {isActive && getExecutionReferenceCount() > 0 && (
                  <Badge bg="light" text="primary" className="border x-small">{getExecutionReferenceCount()} refs.</Badge>
                )}
              </div>
            </ListGroup.Item>
          )
        })}
      </ListGroup>
    </div>
  )
}
