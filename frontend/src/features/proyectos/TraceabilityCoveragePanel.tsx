import { useI18n } from '../../i18n'
import { ProgressBar } from "react-bootstrap";
export function TraceabilityCoveragePanel({ coverage }: { coverage: any }) {
  const { t } = useI18n()
  return <div><small>{t('proyectos.coverageDesign')}</small><ProgressBar now={coverage?.cobertura_diseno || 0} label={`${coverage?.cobertura_diseno || 0}%`} /></div>;
}
