from app.repositories.project_metrics_formats import (
    _empty_format_metrics,
    _empty_format_mode_metrics,
    _finalize_format_metrics,
    _finalize_format_mode_metrics,
)


def test_format_metrics_contract_includes_current_and_future_formats():
    metrics = _empty_format_metrics()

    assert set(metrics) == {"CLASICA", "CONVERSACIONAL", "API", "PERFORMANCE"}
    assert metrics["CONVERSACIONAL"]["metrics_available"] is True
    assert metrics["API"]["metrics_available"] is True
    assert "turns" in metrics["CONVERSACIONAL"]["specific"]
    assert "requests" in metrics["API"]["specific"]


def test_format_metrics_calculates_common_kpis_without_fake_future_metrics():
    metrics = _empty_format_metrics()
    metrics["CONVERSACIONAL"].update({"total": 2, "executed": 1, "passed": 1})
    metrics["API"].update({"total": 1})

    result = _finalize_format_metrics(metrics)

    assert result["CONVERSACIONAL"]["pending"] == 1
    assert result["CONVERSACIONAL"]["coverage_percent"] == 50.0
    assert result["CONVERSACIONAL"]["success_executed_percent"] == 100.0
    assert result["CONVERSACIONAL"]["status"] == "DISPONIBLE"
    assert result["API"]["status"] == "DISPONIBLE"
    assert result["API"]["pending"] == 1


def test_format_mode_matrix_keeps_build_cases_and_pending_cases_separate():
    matrix = _empty_format_mode_metrics()
    matrix["CONVERSACIONAL"]["MANUAL"].update({"total": 2, "executed": 1, "failed": 1})
    matrix["CLASICA"]["SIN_EJECUTAR"]["total"] = 3

    result = _finalize_format_mode_metrics(matrix)

    assert set(result) == {"CLASICA", "CONVERSACIONAL", "API", "PERFORMANCE"}
    assert result["CONVERSACIONAL"]["MANUAL"]["pending"] == 1
    assert result["CONVERSACIONAL"]["MANUAL"]["failed"] == 1
    assert result["CLASICA"]["SIN_EJECUTAR"]["pending"] == 3
