import { useI18n } from '../../i18n'
import { Alert } from "react-bootstrap";
export function RequirementAnalysisPanel({ analysis }: { analysis: any }) {
  const { t } = useI18n()
  return <Alert variant={analysis?.readiness === "READY" ? "success" : "warning"} className="mb-0"><strong>{analysis?.readiness || t('proyectos.pendingAnalysis')}</strong>{(analysis?.questions || []).map((item: string) => <div key={item}>{item}</div>)}</Alert>;
}
