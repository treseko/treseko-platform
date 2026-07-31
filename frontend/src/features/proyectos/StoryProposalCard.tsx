import { useI18n } from '../../i18n'
import { Badge, Form, Table } from "react-bootstrap";
import type { StoryProposal } from "./types/traceability";

export function StoryProposalCard({ proposal, index, onChange }: { proposal: StoryProposal; index: number; onChange: (proposal: StoryProposal) => void }) {
  const { t } = useI18n()
  return <Table responsive size="sm" className="mb-0"><tbody><tr><td><Form.Check checked={proposal.selected !== false} onChange={() => onChange({ ...proposal, selected: !proposal.selected })} aria-label={`${t('proyectos.selectProposal')} ${index + 1}`} /></td><td><strong>{t('proyectos.proposal')} {index + 1}</strong><div>{proposal.title}</div><small className="text-muted">{proposal.actor} {t('proyectos.wants')} {proposal.goal}</small></td><td><Badge bg={proposal.quality.testability === "PASS" ? "success" : proposal.quality.testability === "FAIL" ? "danger" : "warning"}>{proposal.quality.testability}</Badge></td></tr></tbody></Table>;
}
