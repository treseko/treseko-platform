from datetime import datetime, timezone, timedelta
from types import SimpleNamespace as NS
from uuid import uuid4
import pytest
from app import crud
from app.repositories.project_metrics import _chatbot_result_metrics
from app.repositories.project_metrics_history import build_project_history
from app.repositories.project_metrics_derived import build_derived_metrics

@pytest.mark.parametrize('status,expected',[(200,0),(500,1),(0,1)])
def test_manual_chatbot_http_and_validation_metrics(status,expected):
    result={'turns':[{'statusCode':status,'assertions':[{'passed':False}]}],'assertions':[], 'performance':{'http_error_count':expected}}
    metrics=_chatbot_result_metrics(result)
    assert metrics['http_error_count']==expected
    assert metrics['validation_failure_count']==1
    assert metrics['latency_sample_count']==0

def test_automated_summary_not_counted_twice():
    metrics=_chatbot_result_metrics({'turns':[{'statusCode':200,'latencyMs':0,'assertions':[{'passed':False}]}], 'assertions':[{'passed':False}],'failed_assertions':1,'http_errors':['validation failed']})
    assert metrics['validation_failure_count']==1 and metrics['http_error_count']==0
    assert metrics['latency_sample_count']==1 and metrics['p95_latency_ms']==0

@pytest.mark.asyncio
@pytest.mark.parametrize('selected_index,expected_index',[(0,1),(1,2),(2,None)])
async def test_comparison_uses_real_predecessor(selected_index,expected_index):
    now=datetime.now(timezone.utc)
    builds=[NS(componente_id=uuid4(),id=uuid4(),nombre=f'v{3-i}',estado='HISTORICA',activo=False,fecha_creacion=now-timedelta(days=i),fecha_inicio=None) for i in range(3)]
    class Db:
        calls=0
        async def execute(self,q):
            self.calls+=1
            values=builds if self.calls==1 else []
            return NS(scalars=lambda:NS(all=lambda:values))
    result=await build_project_history(dict(db=Db(),proyecto_id=uuid4(),build=builds[selected_index],project_bug_history={},stats={},cobertura=0,total_ejecutados=0,qa_status={},bug_metrics={}))
    assert result['comparison'].get('previous_build_id')==(str(builds[expected_index].id) if expected_index is not None else None)

def test_estimation_uses_completed_attempt_average_without_losing_cumulative_effort():
    now=datetime.now(timezone.utc)
    context=dict(ejecuciones=[NS(fecha_ejecucion=now,duracion_segundos=60,estado_resultado='PASO'),NS(fecha_ejecucion=now,duracion_segundos=60,estado_resultado='FALLO')],related_bugs=[],build=NS(fecha_creacion=now,nombre='QA',codigo='QA'),total_ejecutados=1,now=now,stats={'pasados':1,'pendientes':1},bug_metrics={},project=None,component=None,usuarios_info={},caso_ultimo_estado={},cobertura=50,first_comment_hours=[],reopened=0,bugs_without_evidence=0,failure_items=[],failures_with_bug=0,overdue=0,bugs_by_origin_build={},casos_detalle_por_master={},bug_items=[],por_prioridad={},ai_metrics={'executions':0})
    temporal=build_derived_metrics(context)['temporal_metrics']
    assert temporal['total_execution_seconds']==120
    assert temporal['average_seconds_per_attempt']==60
    assert temporal['average_seconds_per_executed_case']==120
    assert temporal['estimated_remaining_seconds']==60

def test_explicit_zero_http_summary_is_not_replaced_by_legacy_validation_errors():
    metrics=_chatbot_result_metrics({'performance':{'http_error_count':0},'http_errors':['legacy assertion error']})
    assert metrics['http_error_count']==0
