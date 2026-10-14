from __future__ import annotations

import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))
os.chdir(BACKEND_DIR)

from app.schema_sections.automation import (  # noqa: E402
    REDACTED_AUTOMATION_SECRET,
    AutomationJob,
    AutomationRunner,
    AutomationRunnerPairingPoll,
    AutomationRunnerPairingRequest,
)
from app.models import AutomationJobStatus  # noqa: E402


def test_automation_runner_capabilities_redact_nested_secrets():
    runner = AutomationRunner(
        id=uuid.uuid4(),
        nombre="worker",
        tipo="LOCAL",
        estado="ONLINE",
        activo=True,
        ultimo_heartbeat=datetime.now(timezone.utc),
        capabilities={
            "frameworks": ["playwright"],
            "api_key": "secret-api-key",
            "headers": {"Authorization": "Bearer token", "X-Worker": "visible"},
            "nested": [{"client_secret": "oidc-secret"}],
        },
    )

    data = runner.model_dump()
    assert data["capabilities"]["frameworks"] == ["playwright"]
    assert data["capabilities"]["api_key"] == REDACTED_AUTOMATION_SECRET
    assert data["capabilities"]["headers"]["Authorization"] == REDACTED_AUTOMATION_SECRET
    assert data["capabilities"]["headers"]["X-Worker"] == "visible"
    assert data["capabilities"]["nested"][0]["client_secret"] == REDACTED_AUTOMATION_SECRET


def test_pairing_responses_redact_capabilities_without_hiding_runner_token():
    request = AutomationRunnerPairingRequest(
        id=uuid.uuid4(),
        code="WK-123456",
        nombre="worker",
        tipo="LOCAL",
        estado="PENDING",
        expires_at=datetime.now(timezone.utc),
        capabilities={"token": "pairing-side-secret", "node_version": "20"},
    )
    request_data = request.model_dump()
    assert request_data["capabilities"]["token"] == REDACTED_AUTOMATION_SECRET
    assert request_data["capabilities"]["node_version"] == "20"

    poll = AutomationRunnerPairingPoll(
        code="WK-123456",
        estado="APPROVED",
        expires_at=datetime.now(timezone.utc),
        runner_token="qar_one_time_token",
        runner={"id": str(uuid.uuid4()), "capabilities": {"password": "runner-secret", "browsers": ["chromium"]}},
    )
    poll_data = poll.model_dump()
    assert poll_data["runner_token"] == "qar_one_time_token"
    assert poll_data["runner"]["capabilities"]["password"] == REDACTED_AUTOMATION_SECRET
    assert poll_data["runner"]["capabilities"]["browsers"] == ["chromium"]


def test_automation_job_response_redacts_payload_logs_and_metadata():
    job = AutomationJob(
        id=uuid.uuid4(),
        estado=AutomationJobStatus.FAILED,
        required_framework="playwright",
        required_language="javascript",
        timeout_seconds=300,
        payload_congelado={
            "url": "https://qa.example.test",
            "headers": {"Authorization": "Bearer payload-secret", "X-Trace": "visible"},
            "variables": {"password": "payload-password"},
        },
        logs='request failed with "api_key": "log-secret"',
        error_message="token=error-secret",
        metadata_resultado={"client_secret": "metadata-secret", "duration": 2},
    )

    data = job.model_dump()

    assert data["payload_congelado"]["url"] == "https://qa.example.test"
    assert data["payload_congelado"]["headers"]["Authorization"] == job.payload_congelado["headers"]["Authorization"]
    assert data["payload_congelado"]["headers"]["X-Trace"] == "visible"
    assert data["payload_congelado"]["variables"]["password"] == job.payload_congelado["variables"]["password"]
    assert "log-secret" in data["logs"]
    assert "error-secret" in data["error_message"]
    assert data["metadata_resultado"]["client_secret"] == "metadata-secret"
    assert data["metadata_resultado"]["duration"] == 2


if __name__ == "__main__":
    test_automation_runner_capabilities_redact_nested_secrets()
    test_pairing_responses_redact_capabilities_without_hiding_runner_token()
    test_automation_job_response_redacts_payload_logs_and_metadata()
    print("Automation capability redaction checks OK")
