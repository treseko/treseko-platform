import math, os
import pytest
from uuid import uuid4
from datetime import datetime,timezone,timedelta
from sqlalchemy import delete
from app import crud, models
from app.database import AsyncSessionLocal,engine
from app.repositories.project_metrics import get_project_metrics

def api_result(latencies):
    return {'steps':[{'response':{'status':200,'timings':{'total_ms':v}},'assertions':[]} for v in latencies]}
@pytest.mark.skipif(os.getenv('TRESEKO_TEST_ISOLATE_HTTP_DATA') != '1', reason='Requires controlled report metrics PostgreSQL')
async def test_report_metrics_with_versions_latencies_retries_and_active_execution():
    assert engine.url.database == 'treseko_tests' and engine.url.host in {'127.0.0.1', 'localhost'}
    async with AsyncSessionLocal() as db:
        user=models.Usuario(email='reports-check@example.invalid',rol=models.Rol.ADMIN,activo=True)
        org=models.Organizacion(nombre='Reportes QA aislado');db.add_all([user,org]);await db.flush()
        project=models.Proyecto(nombre='Métricas verificables',organizacion_id=org.id);db.add(project);await db.flush()
        comp=models.Componente(nombre='API',proyecto_id=project.id);db.add(comp);await db.flush()
        build=models.Build(nombre='Métricas QA',proyecto_id=project.id,componente_id=comp.id,estado='ACTIVA',activo=True)
        suite=models.Suite(nombre='API',proyecto_id=project.id,componente_id=comp.id);db.add_all([build,suite]);await db.flush()
        cases=[]
        for i in range(2):
            cases.append(models.CasoPrueba(master_id=uuid4(),version=1,prioridad=models.Prioridad.MEDIA,creado_por=user.id,codigo=f'REPORT-{i}',titulo=f'API {i}',proyecto_id=project.id,componente_id=comp.id,suite_id=suite.id,tipo_prueba=models.TipoPrueba.MANUAL,formato_prueba=models.FormatoPrueba.API))
        db.add_all(cases);await db.flush();db.add_all([models.BuildCaso(build_id=build.id,caso_id=c.id) for c in cases])
        run=models.TestRun(proyecto_id=project.id,build_id=build.id,nombre='Datos controlados',entorno='QA',creado_por=user.id,origen='MANUAL');db.add(run);await db.flush()
        now=datetime.now(timezone.utc)
        for i,c in enumerate(cases):
            db.add(models.EjecucionCaso(test_run_id=run.id,caso_id=c.id,version_ejecutada=1,ejecutado_por=user.id,execution_mode=models.ExecutionMode.MANUAL,estado_resultado=models.EstadoResultado.PASO,fecha_ejecucion=now+timedelta(seconds=i),api_resultado=api_result([10]*100 if i==0 else [1000])))
        await db.commit()
        m=await get_project_metrics(db,project.id,build.id)
        specific=m['metricas_por_formato']['API']['specific'];all_latencies=[10]*100+[1000]
        expected=sorted(all_latencies)[math.ceil(.95*len(all_latencies))-1]
        assert specific['requests']==101 and specific['p95_latency_ms']==expected==10
        # The logical case remains assigned but the build now points to version 2.
        old=cases[0]
        newer=models.CasoPrueba(master_id=old.master_id,version=2,prioridad=old.prioridad,creado_por=user.id,codigo=old.codigo,titulo=old.titulo,proyecto_id=project.id,componente_id=comp.id,suite_id=suite.id,tipo_prueba=old.tipo_prueba,formato_prueba=old.formato_prueba)
        db.add(newer);await db.flush();old.activo=False;await db.execute(delete(models.BuildCaso).where(models.BuildCaso.build_id==build.id,models.BuildCaso.caso_id==old.id));db.add(models.BuildCaso(build_id=build.id,caso_id=newer.id));await db.commit()
        m=await get_project_metrics(db,project.id,build.id)
        matrix=m['metricas_por_formato_y_modo']['API']['MANUAL'];specific=m['metricas_por_formato']['API']['specific']
        assert m['total_ejecutados']==2 and matrix['executed']==2 and specific['requests']==101
        # A third execution of an already executed case must not inflate unique cases.
        run2=models.TestRun(proyecto_id=project.id,build_id=build.id,nombre='Repetición',entorno='QA',creado_por=user.id,origen='MANUAL');db.add(run2);await db.flush()
        db.add(models.EjecucionCaso(test_run_id=run2.id,caso_id=cases[1].id,version_ejecutada=1,ejecutado_por=user.id,estado_resultado=models.EstadoResultado.FALLO,fecha_ejecucion=now+timedelta(seconds=10),api_resultado=api_result([1000])))
        await db.commit();m=await get_project_metrics(db,project.id,build.id)
        assert m['total_casos_asignados']==2 and m['total_ejecutados']==2 and m['stats']['fallados']==1
        running_build=models.Build(nombre='En progreso',proyecto_id=project.id,componente_id=comp.id,estado='HISTORICA',activo=False)
        running_case=models.CasoPrueba(master_id=uuid4(),prioridad=models.Prioridad.MEDIA,creado_por=user.id,codigo='RUNNING-ONLY',titulo='IA en curso',proyecto_id=project.id,componente_id=comp.id,suite_id=suite.id,tipo_prueba=models.TipoPrueba.AUTOMATIZADA_AI,formato_prueba=models.FormatoPrueba.CLASICA)
        db.add_all([running_build,running_case]);await db.flush();db.add(models.BuildCaso(build_id=running_build.id,caso_id=running_case.id))
        running_run=models.TestRun(proyecto_id=project.id,build_id=running_build.id,nombre='IA en curso',entorno='QA',creado_por=user.id,origen='IA');db.add(running_run);await db.flush()
        db.add(models.EjecucionCaso(test_run_id=running_run.id,caso_id=running_case.id,version_ejecutada=1,ejecutado_por=user.id,execution_mode=models.ExecutionMode.IA,estado_resultado=models.EstadoResultado.EJECUTANDO_AI))
        await db.commit();m=await get_project_metrics(db,project.id,running_build.id)
        assert m['total_ejecutados']==0 and m['cobertura_porcentaje']==0 and m['stats']['pendientes']==1
        assert m['metricas_por_formato']['CLASICA']['pending']==1
        assert m['metricas_por_formato_y_modo']['CLASICA']['IA']['executed']==0
        assert m['metricas_por_formato_y_modo']['CLASICA']['SIN_EJECUTAR']['pending']==1
        history=next(item for item in m['historico_versions'] if item['build_id']==str(running_build.id))
        assert history['ejecutados']==0 and history['cobertura_porcentaje']==0
        # Latest in-progress retry supersedes an old verdict for coverage.
        old_finished=models.EjecucionCaso(test_run_id=running_run.id,caso_id=running_case.id,version_ejecutada=1,ejecutado_por=user.id,estado_resultado=models.EstadoResultado.PASO,intento_numero=2,fecha_ejecucion=now-timedelta(days=1))
        db.add(old_finished);await db.commit();m=await get_project_metrics(db,project.id,running_build.id)
        assert m['total_ejecutados']==0 and m['stats']['pendientes']==1 and m['stats']['pasados']==0
        # Conversational P95 aggregates observed turns from the latest results.
        chat_cases=[models.CasoPrueba(master_id=uuid4(),prioridad=models.Prioridad.MEDIA,creado_por=user.id,codigo=f'CHAT-{i}',titulo=f'Conversación {i}',proyecto_id=project.id,componente_id=comp.id,suite_id=suite.id,tipo_prueba=models.TipoPrueba.MANUAL,formato_prueba=models.FormatoPrueba.CONVERSACIONAL) for i in range(2)]
        db.add_all(chat_cases);await db.flush()
        for i,c in enumerate(chat_cases):
            db.add(models.BuildCaso(build_id=build.id,caso_id=c.id))
            db.add(models.EjecucionCaso(test_run_id=run.id,caso_id=c.id,version_ejecutada=1,ejecutado_por=user.id,estado_resultado=models.EstadoResultado.PASO,chatbot_resultado={'turns':[{'latencyMs':v} for v in ([10]*100 if i==0 else [1000])]}))
        await db.commit();m=await get_project_metrics(db,project.id,build.id)
        assert m['chatbot_metrics']['p95_latency_ms']==10
        assert m['metricas_por_formato']['CONVERSACIONAL']['specific']['p95_latency_ms']==10
    await engine.dispose()
