import { useI18n } from '../../i18n'
import { Button, Col, Form, Row } from "react-bootstrap";
import type { AcceptanceCriterion } from "./types/traceability";

type Props = {
  criteria: AcceptanceCriterion[];
  onChange?: (criteria: AcceptanceCriterion[]) => void;
  disabled?: boolean;
};

export function AcceptanceCriteriaEditor({ criteria, onChange, disabled = false }: Props) {
  const { t } = useI18n()
  const update = (index: number, patch: Partial<AcceptanceCriterion>) => {
    onChange?.(criteria.map((criterion, itemIndex) => itemIndex === index ? { ...criterion, ...patch } : criterion));
  };

  const add = () => onChange?.([...criteria, { local_id: `AC-MANUAL-${criteria.length + 1}`, type: "FUNCTIONAL", title: "", given: "", when: "", then: [], observable_result: "", mandatory: true, source_refs: [], assumption_ids: [] }]);
  const remove = (index: number) => onChange?.(criteria.filter((_, itemIndex) => itemIndex !== index));
  return (
    <div className="d-flex flex-column gap-3">
      {!criteria.length && <div className="small text-muted">{t('proyectos.addCriteriaHint')}</div>}
      {criteria.map((criterion, index) => (
        <div className="border rounded p-2" key={criterion.local_id}>
          <div className="d-flex justify-content-between align-items-center small text-muted mb-2"><span>{t('proyectos.criterionLabel', { index: index + 1 })}</span>{onChange && !disabled && <Button type="button" size="sm" variant="outline-danger" onClick={() => remove(index)}>{t('proyectos.remove')}</Button>}</div>
          <Form.Control
            size="sm"
            className="mb-2"
            aria-label={t('proyectos.criterionLabel', { index: index + 1 })}
            value={criterion.title}
            disabled={disabled || !onChange}
            onChange={(event) => update(index, { title: event.target.value })}
          />
          <Row className="g-2">
            <Col md={6}>
              <Form.Label className="small mb-1">{t('proyectos.given')}</Form.Label>
              <Form.Control size="sm" value={criterion.given} disabled={disabled || !onChange} onChange={(event) => update(index, { given: event.target.value })} />
            </Col>
            <Col md={6}>
              <Form.Label className="small mb-1">{t('proyectos.when')}</Form.Label>
              <Form.Control size="sm" value={criterion.when} disabled={disabled || !onChange} onChange={(event) => update(index, { when: event.target.value })} />
            </Col>
            <Col md={12}>
              <Form.Label className="small mb-1">{t('proyectos.then')}</Form.Label>
              <Form.Control
                as="textarea"
                rows={2}
                value={criterion.then.join("\n")}
                disabled={disabled || !onChange}
                onChange={(event) => update(index, { then: event.target.value.split("\n").map((item) => item.trim()).filter(Boolean) })}
              />
            </Col>
            <Col md={12}>
              <Form.Label className="small mb-1">{t('proyectos.observableResult')}</Form.Label>
              <Form.Control size="sm" value={criterion.observable_result} disabled={disabled || !onChange} onChange={(event) => update(index, { observable_result: event.target.value })} />
            </Col>
          </Row>
        </div>
      ))}
      {onChange && !disabled && <Button type="button" size="sm" variant="outline-secondary" className="align-self-start" onClick={add}>{t('proyectos.addCriterion')}</Button>}
    </div>
  );
}
