"""Project names, capacity and persisted lifecycle with real PostgreSQL."""
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import psycopg
from fastapi.testclient import TestClient

from app.database import DATABASE_URL
from app.main import app
from app.api.routers import organizations
from app.services.edition.catalog import COMMUNITY_LIMITS
from test_api_project_http_flow import _create_admin, _login, _allow_controlled_tenant_limit


def test_names_capacity_and_lifecycle_are_persisted(monkeypatch):
    monkeypatch.setattr(organizations, 'enforce_limit', _allow_controlled_tenant_limit)
    email, password = f'consolidation-{uuid4().hex}@example.test', 'ControlledProjectQA2026!'
    _create_admin(email, password)
    with TestClient(app, raise_server_exceptions=False) as client:
        headers = _login(client, email, password)
        def create(url, body):
            response = client.post(url, headers=headers, json=body)
            assert response.status_code == 200, response.text
            return response.json()
        orgs = [create('/organizaciones/', {'nombre': f'QA {uuid4().hex}'})['id'] for _ in range(2)]
        first = create('/proyectos/', {'nombre': ' Shared name ', 'organizacion_id': orgs[0]})
        other = create('/proyectos/', {'nombre': 'Shared name', 'organizacion_id': orgs[1]})
        assert first['nombre'] == other['nombre'] == 'Shared name'
        assert first['id'] != other['id']
        assert client.post('/proyectos/', headers=headers, json={'nombre':'Shared name','organizacion_id':orgs[0]}).status_code == 400
        for name in ('', '   ', '\t\n'):
            assert client.post('/proyectos/', headers=headers, json={'nombre':name,'organizacion_id':orgs[0]}).status_code == 422
            assert client.patch(f"/proyectos/{first['id']}",headers=headers,json={'nombre':name}).status_code == 422
        assert client.patch(f"/proyectos/{first['id']}",headers=headers,json={'organizacion_id':None}).status_code == 422
        capacity = COMMUNITY_LIMITS['max_projects']
        for index in range(capacity-1):
            create('/proyectos/', {'nombre':f'Fill {index}', 'organizacion_id':orgs[0]})
        inactive = create('/proyectos/', {'nombre':'Inactive', 'organizacion_id':orgs[0], 'estado':'En Pausa','activo':False})
        assert client.patch(f"/proyectos/{inactive['id']}", headers=headers, json={'estado':'Activo'}).status_code == 403
        assert client.post('/proyectos/',headers=headers,json={'nombre':'Over quota','organizacion_id':orgs[0]}).status_code == 403
        assert client.patch(f"/proyectos/{other['id']}",headers=headers,json={'organizacion_id':orgs[0],'nombre':'Transferred'}).status_code == 403
        assert client.post('/proyectos/import/',headers=headers,json={'proyecto':{'nombre':'Imported','organizacion_id':orgs[0]},'suites':[],'casos':[]}).status_code in (400,403)
        component = create('/componentes/', {'proyecto_id':first['id'],'nombre':'Retained component'})
        build = create('/builds/', {'proyecto_id':first['id'],'componente_id':component['id'],'nombre':'Retained build','estado':'ACTIVA'})
        path=f"/proyectos/{first['id']}"
        for state in ('Cerrado','Activo','Activo'):
            response=client.patch(path,headers=headers,json={'estado':state})
            assert response.status_code == 200, response.text
        assert client.get(f"{path}/componentes/",headers=headers).json()[0]['id']==component['id']
        assert client.get(f"{path}/builds/",headers=headers).json()[0]['id']==build['id']
        with psycopg.connect(DATABASE_URL.replace('postgresql+asyncpg://','postgresql://',1)) as db:
            events=db.execute('SELECT event_type FROM notification_events WHERE proyecto_id=%s AND event_type IN (%s,%s)',(first['id'],'project.closed','project.reopened')).fetchall()
            assert sorted(row[0] for row in events)==['project.closed','project.reopened']
            assert db.execute('SELECT nombre, activo FROM proyectos WHERE id=%s',(first['id'],)).fetchone()==('Shared name',True)
        assert client.get(path).status_code==401


def test_concurrent_creation_cannot_overfill_last_project_slot(monkeypatch):
    monkeypatch.setattr(organizations,'enforce_limit',_allow_controlled_tenant_limit)
    email,password=f'capacity-{uuid4().hex}@example.test','ControlledCapacityQA2026!'
    _create_admin(email,password)
    with TestClient(app,raise_server_exceptions=False) as client:
        headers=_login(client,email,password)
        response=client.post('/organizaciones/',headers=headers,json={'nombre':f'Concurrent {uuid4().hex}'})
        assert response.status_code==200,response.text
        org=response.json()['id']
        for index in range(COMMUNITY_LIMITS['max_projects']-1):
            assert client.post('/proyectos/',headers=headers,json={'nombre':f'Slot {index}','organizacion_id':org}).status_code==200
        with ThreadPoolExecutor(max_workers=2) as pool:
            attempts=[pool.submit(client.post,'/proyectos/',headers=headers,json={'nombre':f'Concurrent {index}','organizacion_id':org}) for index in range(2)]
            assert sorted(attempt.result().status_code for attempt in attempts)==[200,403]
        with psycopg.connect(DATABASE_URL.replace('postgresql+asyncpg://','postgresql://',1)) as db:
            assert db.execute('SELECT COUNT(*) FROM proyectos WHERE organizacion_id=%s AND activo',(org,)).fetchone()[0]==COMMUNITY_LIMITS['max_projects']
