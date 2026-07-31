import { useI18n } from '../../i18n'
import { Nav } from "react-bootstrap";
const stageKeys = ["stageAnalyze", "stageResolve", "stageConfigure", "stageReview"];
export function StoryGenerationWizard({ step, children }: { step: number; children: React.ReactNode }) {
  const { t } = useI18n()
  return <><Nav variant="pills" className="mb-3">{stageKeys.map((key, index) => <Nav.Item key={key}><Nav.Link active={index === step} disabled={index > step}>{index + 1}. {t(`proyectos.${key}`)}</Nav.Link></Nav.Item>)}</Nav>{children}</>;
}
