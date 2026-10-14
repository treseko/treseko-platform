"""Edit structured criteria while preserving identifiers and existing case links."""
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from .. import models


def criterion_input(item):
    return {'local_id': item.codigo, 'type': item.tipo, 'title': item.titulo,
        'given': item.given_text, 'when': item.when_text, 'then': item.then_items,
        'observable_result': item.observable_result, 'mandatory': item.mandatory,
        'source_refs': item.source_refs, 'assumption_ids': item.assumption_refs}


def criteria_markdown(criteria):
    return '\n\n'.join(
        f"### {c['title']}\n**Dado:** {c['given']}\n**Cuando:** {c['when']}\n**Entonces:** " + '; '.join(c['then'])
        for c in criteria)


async def replace_story_criteria(db, story, criteria):
    if criteria is None or not criteria:
        raise ValueError('La historia necesita al menos un criterio estructurado.')
    ids = [c['local_id'] for c in criteria]
    if len(set(ids)) != len(ids):
        raise ValueError('Los criterios deben tener identificadores distintos.')
    rows = (await db.execute(select(models.AcceptanceCriterion).where(
        models.AcceptanceCriterion.historia_id == story.id).with_for_update())).scalars().all()
    active = sorted((row for row in rows if row.activo), key=lambda row: row.orden)
    changed = [criterion_input(row) for row in active] != criteria
    if not changed:
        return False
    by_code = {row.codigo: row for row in rows}
    for row in rows:
        row.activo = row.codigo in ids
    fields = {'type': 'tipo', 'title': 'titulo', 'given': 'given_text', 'when': 'when_text',
        'then': 'then_items', 'observable_result': 'observable_result', 'mandatory': 'mandatory',
        'source_refs': 'source_refs', 'assumption_ids': 'assumption_refs'}
    for order, criterion in enumerate(criteria):
        row = by_code.get(criterion['local_id'])
        if row is None:
            row = models.AcceptanceCriterion(historia_id=story.id, codigo=criterion['local_id'])
            db.add(row)
        row.activo, row.orden = True, order
        for field, attribute in fields.items():
            setattr(row, attribute, criterion[field])
    story.criterios_aceptacion_markdown = criteria_markdown(criteria)
    story.criterios_estructuracion_estado = 'STRUCTURED'
    return changed


async def story_edit_input(db, item, payload):
    item = (await db.execute(select(models.HistoriaUsuario).options(
        selectinload(models.HistoriaUsuario.requisito), selectinload(models.HistoriaUsuario.casos),
        selectinload(models.HistoriaUsuario.criterios_aceptacion)).where(models.HistoriaUsuario.id == item.id)
        .with_for_update().execution_options(populate_existing=True))).scalar_one()
    data = payload.model_dump(exclude_unset=True)
    expected = data.pop('expected_revision', None)
    if expected is not None and expected != item.ultima_actualizacion:
        raise ValueError('La historia cambió. Recarga antes de guardar tus cambios.')
    supplied = 'acceptance_criteria' in data
    criteria = data.pop('acceptance_criteria', None)
    if supplied:
        data.pop('criterios_aceptacion_markdown', None)
    return item, data, supplied, criteria
