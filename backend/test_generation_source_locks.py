"""Source guards protect definitions without blocking FK references."""
from types import SimpleNamespace
from uuid import uuid4
from datetime import datetime, timezone
import pytest
from sqlalchemy.dialects import postgresql
from app import models
from app.repositories.generation_guards import require_current_sources

@pytest.mark.asyncio
async def test_source_locks_allow_references_without_allowing_source_edits():
    project_id, requirement_id, component_id, wiki_id = (uuid4() for _ in range(4))
    revision = datetime.now(timezone.utc)
    requirement = SimpleNamespace(id=requirement_id, archivado=False, codigo='REQ-1', titulo='Scope', descripcion_markdown='', prioridad='MEDIA', estado='ACTIVO', ultima_actualizacion=revision, external_provider=None, external_reference=None, external_url=None)
    component = SimpleNamespace(id=component_id, proyecto_id=project_id, nombre='Web', descripcion='', tech_stack='')
    wiki = SimpleNamespace(id=wiki_id, proyecto_id=project_id, titulo='Context', contenido='Observed facts')
    rows = {models.Requisito: requirement, models.Componente: component, models.WikiPage: wiki}
    queries = []
    class Database:
        async def execute(self, query):
            queries.append(str(query.compile(dialect=postgresql.dialect())))
            entity = query.column_descriptions[0]['entity']
            return SimpleNamespace(scalar_one_or_none=lambda: rows[entity])
    run = SimpleNamespace(requisito_id=requirement_id, proyecto_id=project_id, fuente_snapshot={'requisito': {}, 'componentes': [{'id':str(component_id), 'nombre':'Web', 'descripcion':'', 'tech_stack':''}], 'wiki':[{'id':str(wiki_id), 'titulo':'Context', 'contenido':'Observed facts'}], 'context_version':2})
    await require_current_sources(Database(), run)
    assert len(queries) == 3
    assert all('FOR NO KEY UPDATE' in query for query in queries)
    assert all('FOR KEY SHARE' not in query for query in queries)
