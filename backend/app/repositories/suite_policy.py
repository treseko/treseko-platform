"""Shared project tree locks and editable suite destinations."""
import hashlib
from sqlalchemy import select, text
from .. import models


async def lock_suite_project(db, project_id):
    if db.bind.dialect.name == 'postgresql':
        key = int.from_bytes(hashlib.sha256(f'suites:{project_id}'.encode()).digest()[:8], 'big', signed=True)
        await db.execute(text('SELECT pg_advisory_xact_lock(:key)'), {'key': key})


async def suite_rows(db, project_id):
    await lock_suite_project(db, project_id)
    return (await db.execute(select(models.Suite).where(models.Suite.proyecto_id == project_id)
        .execution_options(populate_existing=True))).scalars().all()


def descendants(rows, suite_id):
    by_parent = {}
    for row in rows:
        by_parent.setdefault(row.parent_id, []).append(row)
    result, pending, seen = [], list(by_parent.get(suite_id, [])), {suite_id}
    while pending:
        item = pending.pop()
        if item.id in seen:
            raise ValueError('La jerarquía contiene un ciclo. Revisa las suites antes de modificarla.')
        seen.add(item.id)
        result.append(item)
        pending.extend(by_parent.get(item.id, []))
    return result


def editable_path(rows, suite_id, *, allow_archived_self=False):
    by_id = {row.id: row for row in rows}
    current, seen = suite_id, set()
    while current:
        if current in seen:
            raise ValueError('La jerarquía contiene un ciclo.')
        seen.add(current)
        item = by_id.get(current)
        if not item or not item.activo:
            raise ValueError('La suite destino o una carpeta padre no está disponible.')
        if item.archivado and not (current == suite_id and allow_archived_self):
            raise ValueError('Restaura la suite destino y sus carpetas padre antes de modificarla.')
        current = item.parent_id
    return by_id[suite_id]


async def require_editable_suite(db, project_id, suite_id, component_id=None, *, exact_component=False):
    rows = await suite_rows(db, project_id)
    item = editable_path(rows, suite_id)
    if (exact_component or item.componente_id is not None) and item.componente_id != component_id:
        raise ValueError('La suite destino no pertenece al componente indicado; no se puede mover o copiar a otro componente.')
    return item
