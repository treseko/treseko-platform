import os
import sys
import uuid
from pathlib import Path

from pydantic import ValidationError


BACKEND_DIR = Path(__file__).resolve().parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))
os.chdir(BACKEND_DIR)

from app import schemas  # noqa: E402
from app.models import AutomationJobStatus, EstadoResultado  # noqa: E402


def _expect_validation_error(func, *args, **kwargs):
    try:
        func(*args, **kwargs)
    except (ValidationError, ValueError):
        return
    raise AssertionError("expected validation error")


def test_automation_runner_payloads_accept_normal_values():
    register = schemas.AutomationRunnerRegister(
        registration_token="qreg_valid",
        nombre="Local Worker",
        tipo="LOCAL",
        capabilities={"hostname": "worker-1", "tags": ["qa", "linux"]},
    )
    pairing = schemas.AutomationRunnerPairingRequestCreate(
        ttl_minutes=120,
        capabilities={"browser": "chromium"},
    )
    heartbeat = schemas.AutomationRunnerHeartbeat(
        estado="ONLINE",
        resources={"cpu": 10, "memory_mb": 512},
        active_jobs=1,
        uptime_seconds=3600,
    )

    assert register.capabilities["hostname"] == "worker-1"
    assert pairing.ttl_minutes == 120
    assert heartbeat.active_jobs == 1


def test_automation_runner_payloads_reject_oversized_or_invalid_values():
    _expect_validation_error(
        schemas.AutomationRunnerRegister,
        registration_token="qreg_" + ("x" * 200),
    )
    _expect_validation_error(
        schemas.AutomationRunnerRegistrationTokenCreate,
        ttl_minutes=24 * 60 + 1,
    )
    _expect_validation_error(
        schemas.AutomationRunnerPairingRequestCreate,
        ttl_minutes=121,
    )
    _expect_validation_error(
        schemas.AutomationRunnerPairingRequestCreate,
        capabilities={"notes": "x" * (schemas.MAX_AUTOMATION_JSON_BYTES + 1)},
    )
    _expect_validation_error(
        schemas.AutomationRunnerHeartbeat,
        active_jobs=1001,
    )


def test_automation_job_result_payloads_are_bounded():
    schemas.AutomationJobResult(
        lease_token="lease-" + ("x" * 48),
        result_event_id=str(uuid.uuid4()),
        status=AutomationJobStatus.PASSED,
        duration_seconds=15,
        observations="ok",
        metadata={"browser": "chromium"},
        steps=[schemas.AutomationJobResultStep(number=1, status=EstadoResultado.PASO)],
        artifacts=[
            schemas.AutomationJobResultArtifact(
                filename="shot.png",
                content_type="image/png",
                base64="aGVsbG8=",
                step_number=1,
            )
        ],
    )

    _expect_validation_error(
        schemas.AutomationJobResultStep,
        number=0,
        status=EstadoResultado.PASO,
    )
    large = "x" * (schemas.MAX_AUTOMATION_ARTIFACT_BASE64_LENGTH + 1)
    assert schemas.AutomationJobResultArtifact(filename="payload.png", base64=large).base64 == large
    metadata = {"notes": "x" * (schemas.MAX_AUTOMATION_RESULT_METADATA_BYTES + 1)}
    assert schemas.AutomationJobResult(lease_token="x"*48, result_event_id=str(uuid.uuid4()), status=AutomationJobStatus.ERROR, metadata=metadata).metadata == metadata


def test_automation_script_payloads_are_bounded():
    project_id = uuid.uuid4()
    schemas.AutomationDryRunRequest(
        script_automatizado="console.log('ok')",
        proyecto_id=project_id,
        titulo="Smoke test",
        codigo="TC-001",
        pasos=[{"accion": "abrir pagina"}],
    )
    schemas.FuncionAutomatizadaCreate(
        proyecto_id=project_id,
        nombre="login helper",
        codigo="async function login() { return true }",
        parametros=["usuario", "password"],
    )

    schemas.ScriptValidateRequest(
        script="console.log('ok')",
        framework="playwright",
        pasos=[{"accion": "validar"}],
    )

    _expect_validation_error(
        schemas.AutomationDryRunRequest,
        script_automatizado="x" * (schemas.MAX_AUTOMATION_SCRIPT_LENGTH + 1),
        proyecto_id=project_id,
    )
    _expect_validation_error(
        schemas.ScriptValidateRequest,
        script="console.log('ok')",
        framework="playwright",
        datos_caso="x" * (schemas.MAX_AUTOMATION_CASE_DATA_LENGTH + 1),
    )
    _expect_validation_error(
        schemas.ScriptValidateRequest,
        script="console.log('ok')",
        framework="playwright",
        pasos=[{"notes": "x" * (schemas.MAX_AUTOMATION_STEPS_BYTES + 1)}],
    )
    _expect_validation_error(
        schemas.FuncionAutomatizadaCreate,
        proyecto_id=project_id,
        nombre="helper",
        codigo="console.log('ok')",
        parametros=["x" * 121],
    )


if __name__ == "__main__":
    test_automation_runner_payloads_accept_normal_values()
    test_automation_runner_payloads_reject_oversized_or_invalid_values()
    test_automation_job_result_payloads_are_bounded()
    test_automation_script_payloads_are_bounded()
    print("Automation payload bounds checks OK")
