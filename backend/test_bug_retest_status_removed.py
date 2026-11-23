import pytest
from pydantic import ValidationError

from app import models, schemas


def test_retest_status_is_absent_from_runtime_contracts():
    assert "retest_status" not in models.BugIssue.__table__.columns
    assert "retest_status" not in models.BugStatusHistory.__table__.columns
    assert "retest_status" not in schemas.BugIssueCreate.model_fields
    assert "retest_status" not in schemas.BugIssueUpdate.model_fields
    assert "retest_status" not in schemas.BugTransitionRequest.model_fields
    assert "retest_status" not in schemas.BugIssueResponse.model_fields
    assert "retest_status" not in schemas.BugStatusHistoryResponse.model_fields


def test_transition_contract_rejects_removed_retest_status():
    with pytest.raises(ValidationError):
        schemas.BugTransitionRequest.model_validate({
            "estado": "CERRADO",
            "retest_status": "aprobado",
        })
