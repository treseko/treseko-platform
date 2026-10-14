from uuid import uuid4
from types import SimpleNamespace
from app.main import app
from app import schemas
from app.services.automation_payloads import freeze_worker_payload, worker_payload

def test_frozen_payload_keeps_business_values_encrypted_and_round_trips():
    data={'variables':{'password':'synthetic-password','token':'synthetic-business-token'},'script':'password=synthetic-value'}
    stored=freeze_worker_payload(data)
    assert stored != data and 'synthetic-password' not in str(stored)
    assert worker_payload(SimpleNamespace(payload_congelado=stored))==data

def test_result_does_not_drop_long_logs_many_artifacts_or_business_secrets():
    data={'lease_token':'x'*48,'result_event_id':str(uuid4()),'status':'PASSED','logs':'password=synthetic-password\n'+'x'*20000,
          'artifacts':[{'filename':f'{i}.txt','content_type':'text/plain','base64':'cHJvYmU='} for i in range(25)],
          'metadata':{'variables':{'password':'synthetic-password'}}}
    result=schemas.AutomationJobResult(**data)
    assert result.logs==data['logs'] and len(result.artifacts)==25
    assert result.model_dump()['metadata']==data['metadata']
def test_large_api_evidence_and_literal_redaction_strings_are_not_altered():
    from app.services.api_worker_contract import validate_api_worker_result
    result={'schema_version':'treseko.api-result/v1','status':'PASSED','steps':[{'response':{'body':'x'*(5*1024*1024),'body_json':{'password':'[redacted]'}}}]}
    assert validate_api_worker_result(result)==result

def test_original_literal_markers_and_large_extracted_state_are_valid_data():
    from app.services.api_worker_contract import validate_api_worker_state_updates
    state={'shared_variables':{'api.literal':'[redacted]','api.large':'x'*600000},'persistent_variables':{}}
    assert validate_api_worker_state_updates(state)==state

def test_complete_data_policy_applies_to_all_automated_formats():
    from app.services.api_evidence_policy import public_test_data_evidence_enabled
    execution=SimpleNamespace(evidence_policy={'complete_data':True,'scope':'authenticated_execution'})
    assert public_test_data_evidence_enabled(execution=execution)
