from app.repositories.report_metrics_calculation import (
    api_latency_samples, chatbot_latency_samples, is_terminal_result, nearest_rank_p95,
)


def test_only_terminal_results_count_as_completed():
    assert all(is_terminal_result(value) for value in ['PASO', 'FALLO', 'BLOQUEADO'])
    assert not any(is_terminal_result(value) for value in ['SIN_CORRER', 'EJECUTANDO_AI', None])


def test_p95_uses_all_samples_and_nearest_rank_for_small_sets():
    assert nearest_rank_p95([10] * 100 + [1000]) == 10
    assert nearest_rank_p95([10, 1000]) == 1000
    assert nearest_rank_p95([]) == 0


def test_api_latency_samples_keep_zero_and_exclude_missing_invalid_values():
    steps = [{'response': {'timings': {'total_ms': value}}} for value in [0, 10, None, -1, 'nan', True]]
    assert api_latency_samples({'steps': steps + [{'response': None}, {}]}) == [0, 10]


def test_chatbot_samples_are_observed_turns_not_aggregate_percentiles():
    result = {'turns': [{'latencyMs': 0}, {'latency_ms': 30}, {'latencyMs': None}, {}],
              'performance': {'p95_latency_ms': 9999}}
    assert chatbot_latency_samples(result) == [0, 30]
    assert nearest_rank_p95(chatbot_latency_samples(result)) == 30
