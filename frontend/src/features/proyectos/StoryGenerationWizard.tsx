import { Nav } from "react-bootstrap";
const stages = ["Analizar requisito", "Resolver preguntas y supuestos", "Configurar y generar", "Revisar y crear borradores"];
export function StoryGenerationWizard({ step, children }: { step: number; children: React.ReactNode }) { return <><Nav variant="pills" className="mb-3">{stages.map((stage, index) => <Nav.Item key={stage}><Nav.Link active={index === step} disabled={index > step}>{index + 1}. {stage}</Nav.Link></Nav.Item>)}</Nav>{children}</>; }
