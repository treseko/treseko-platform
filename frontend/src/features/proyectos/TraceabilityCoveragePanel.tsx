import { ProgressBar } from "react-bootstrap";
export function TraceabilityCoveragePanel({ coverage }: { coverage: any }) { return <div><small>Cobertura de diseño</small><ProgressBar now={coverage?.cobertura_diseno || 0} label={`${coverage?.cobertura_diseno || 0}%`} /></div>; }
