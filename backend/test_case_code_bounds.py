"""API code bounds must match the persistent case column."""
import pytest
from pydantic import ValidationError
from uuid import uuid4
from app import models,schemas
from app.schema_sections.testing import MAX_TEST_CASE_CODE_LENGTH

def payload(code):
 return {'proyecto_id':uuid4(),'titulo':'Code bound','prioridad':'MEDIA','tipo_prueba':'MANUAL','codigo':code}

def test_case_code_limit_matches_database():
 assert MAX_TEST_CASE_CODE_LENGTH == models.CasoPrueba.__table__.c.codigo.type.length
 assert schemas.CasoPruebaCreate(**payload('x'*MAX_TEST_CASE_CODE_LENGTH)).codigo == 'x'*MAX_TEST_CASE_CODE_LENGTH

def test_oversized_case_code_is_rejected_before_database_write():
 with pytest.raises(ValidationError):
  schemas.CasoPruebaCreate(**payload('x'*(MAX_TEST_CASE_CODE_LENGTH+1)))
