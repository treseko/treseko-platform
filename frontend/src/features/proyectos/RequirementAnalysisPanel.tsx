import { Alert } from "react-bootstrap";
export function RequirementAnalysisPanel({ analysis }: { analysis: any }) { return <Alert variant={analysis?.readiness === "READY" ? "success" : "warning"} className="mb-0"><strong>{analysis?.readiness || "Pendiente de análisis"}</strong>{(analysis?.questions || []).map((item: string) => <div key={item}>{item}</div>)}</Alert>; }
