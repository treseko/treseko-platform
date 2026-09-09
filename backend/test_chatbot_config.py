from app.services.chatbot_config import (
    SYSTEM_CHATBOT_PROFILES,
    chatbot_config_errors,
    chatbot_required_variables,
    merge_chatbot_config,
    normalize_chatbot_config,
    normalize_environment_chatbot_config,
    resolve_chatbot_profile,
)


def test_environment_without_catalog_gets_safe_system_profiles():
    config = normalize_environment_chatbot_config({"connection": {"endpoint": "http://chat.test/api"}})

    assert len(SYSTEM_CHATBOT_PROFILES) == 5
    assert len(config["profiles"]) == 5
    assert config["default_profile"] == "usuario_mayor"


def test_legacy_chatbot_config_is_normalized_to_v2():
    config = normalize_chatbot_config({
        "endpoint": "{{ENV.CHATBOT_URL}}/chat",
        "turns": [{"message": "hola", "assertions": [{"expected": "bienvenido"}]}],
        "security": {"forbidden_response_patterns": ["password"]},
        "evaluation": {"llm_judge": {"enabled": True, "min_score": 80}},
    })

    assert config["schema_version"] == 2
    assert config["connection"]["endpoint"].endswith("/chat")
    assert config["conversation"]["turns"][0]["input"]["text"] == "hola"
    assert config["evaluation"]["deterministic"]["forbidden_patterns"] == ["password"]
    assert config["evaluation"]["semantic"]["minimum_score"] == 0.8


def test_v2_config_accepts_opening_message_without_legacy_turns():
    config = normalize_chatbot_config({
        "schema_version": 2,
        "connection": {"endpoint": "http://chat.test/api", "method": "POST"},
        "conversation": {"opening_message": {"mode": "fixed", "text": "hola"}},
    })

    assert chatbot_config_errors(config) == []
    assert config["conversation"]["opening_message"]["text"] == "hola"


def test_chatbot_config_blocks_missing_endpoint_and_empty_turn():
    errors = chatbot_config_errors({
        "connection": {"method": "POST"},
        "conversation": {"turns": [{"input": {"mode": "fixed", "text": ""}}]},
    })

    assert errors
    assert "endpoint" in errors[0].lower()


def test_profile_generated_turn_is_valid_without_fixed_text():
    errors = chatbot_config_errors({
        "connection": {"endpoint": "http://chat.test/api"},
        "conversation": {"turns": [{"input": {"mode": "profile_generated", "instruction": "saludá"}}]},
    })

    assert errors == []


def test_environment_connection_is_inherited_and_case_overrides_only_scenario():
    environment = normalize_environment_chatbot_config({
        "connection": {
            "endpoint": "{{ENV.CHATBOT_URL}}/api/chat",
            "headers": {"Authorization": "Bearer {{ENV.CHATBOT_TOKEN}}"},
            "request_template": {"message": "{{turn.message}}"},
        },
        "profile_bindings": {"age": "edad", "tone": "tono_usuario"},
    })
    merged = merge_chatbot_config(environment, {
        "conversation": {"opening_message": {"mode": "fixed", "text": "hola"}},
    })

    assert merged["connection"]["endpoint"] == "{{ENV.CHATBOT_URL}}/api/chat"
    assert merged["connection"]["headers"]["Authorization"].startswith("Bearer")
    assert merged["profile_bindings"] == {"age": "edad", "tone": "tono_usuario"}
    assert merged["conversation"]["opening_message"]["text"] == "hola"


def test_profile_bindings_resolve_free_dataset_names_and_coerce_values():
    config = {
        "profile_bindings": {"age": "edad", "spelling_errors": "errores_ortograficos", "goal": "objetivo_usuario"},
        "profile": {"language": "es"},
    }
    profile, missing = resolve_chatbot_profile(config, {
        "DATASET.edad": "65",
        "errores_ortograficos": "true",
        "DATASET.objetivo_usuario": "consultar licencia",
    })

    assert profile == {"age": 65, "spelling_errors": True, "goal": "consultar licencia", "language": "es"}
    assert missing == []


def test_reusable_environment_profile_is_selected_and_dataset_binding_overrides_it():
    environment = normalize_environment_chatbot_config({
        "connection": {"endpoint": "http://chat.test/api"},
        "profiles": [
            {
                "id": "usuario_mayor",
                "name": "Usuario mayor",
                "profile": {"age": 65, "tone": "confused", "language": "es"},
            },
        ],
        "default_profile": "usuario_mayor",
        "profile_bindings": {"age": "edad"},
    })
    merged = merge_chatbot_config(environment, {
        "profile_id": "usuario_mayor",
        "conversation": {"opening_message": {"mode": "fixed", "text": "hola"}},
    })

    profile, missing = resolve_chatbot_profile(merged, {"edad": "66"})

    assert merged["profiles"][0]["id"] == "usuario_mayor"
    assert profile["age"] == 66
    assert profile["tone"] == "confused"
    assert missing == []


def test_invalid_reusable_profile_selection_is_rejected():
    errors = chatbot_config_errors({
        "connection": {"endpoint": "http://chat.test/api"},
        "profiles": [{"id": "usuario_mayor", "profile": {"age": 65}}],
        "profile_id": "perfil_inexistente",
        "conversation": {"opening_message": {"mode": "fixed", "text": "hola"}},
    })

    assert "no existe" in errors[0]


def test_unused_profile_bindings_are_warnings_not_required_connection_variables():
    config = {
        "connection": {"endpoint": "{{ENV.CHATBOT_URL}}/api/chat", "request_template": {"message": "{{turn.message}}"}},
        "profile_bindings": {"age": "edad"},
        "conversation": {"opening_message": {"mode": "fixed", "text": "hola"}},
    }

    assert chatbot_required_variables(config, {"ENV.CHATBOT_URL": "http://chat.test"}) == []


def test_supported_dynamic_inputs_are_not_reported_as_missing_variables():
    config = {
        "connection": {"endpoint": "http://chat.test/{{$randomUUID}}"},
        "conversation": {"turns": [{"input": {"mode": "fixed", "text": "Hola {{$randomFirstName}}"}}]},
    }

    assert chatbot_config_errors(config) == []
    assert chatbot_required_variables(config, {}) == []


def test_unsupported_dynamic_inputs_are_reported_before_execution():
    config = {
        "connection": {"endpoint": "http://chat.test/{{$randomNotSupported}}"},
        "conversation": {"turns": [{"input": {"mode": "fixed", "text": "Hola"}}]},
    }

    errors = chatbot_config_errors(config)

    assert any("dinámicas no soportadas" in error for error in errors)


def test_tool_observation_modes_normalize_legacy_contracts():
    config = normalize_chatbot_config({
        "connection": {"endpoint": "http://chat.test/api"},
        "conversation": {"opening_message": {"mode": "fixed", "text": "hola"}},
        "tools": [
            {"name": "legacy", "require_observable": True},
            {"name": "black_box"},
            {"name": "future", "observation": {"mode": "external_trace"}},
        ],
    })

    assert config["tools"][0]["observation"] == {"mode": "response_payload", "required": True}
    assert config["tools"][1]["observation"]["mode"] == "black_box"
    assert config["tools"][2]["observation"]["mode"] == "external_trace"


def test_required_response_payload_tool_needs_observation_paths():
    errors = chatbot_config_errors({
        "connection": {"endpoint": "http://chat.test/api"},
        "conversation": {"opening_message": {"mode": "fixed", "text": "hola"}},
        "tools": [{"name": "get_cart", "observation": {"mode": "response_payload", "required": True}, "expected_result": {"items": 3}}],
    })

    assert "tool calls" in errors[0].lower()


def test_connection_contract_accepts_real_adapters_and_response_mapping_formats():
    generic = normalize_chatbot_config({
        "connection": {
            "adapter": "generic_http",
            "endpoint": "https://chat.test/api",
            "response_mapping": {
                "response_format": "text",
                "message_path": "$.message",
                "session_id_path": "$.session",
                "tool_calls_path": "$.tools.calls",
                "tool_result_path": "$.tools.result",
            },
        },
        "conversation": {"session_mode": "new_each_turn", "turns": [{"message": "hola"}]},
    })
    legacy = normalize_chatbot_config({
        "connection": {"adapter": "http", "endpoint": "https://chat.test/api"},
        "conversation": {"opening_message": {"mode": "fixed", "text": "hola"}},
    })

    assert chatbot_config_errors(generic) == []
    assert generic["connection"]["response_mapping"]["response_format"] == "text"
    assert generic["conversation"]["session_mode"] == "new_each_turn"
    assert legacy["connection"]["adapter"] == "http"
    assert chatbot_config_errors(legacy) == []


def test_openai_compatible_requires_model_and_accepts_v2_model():
    missing_model = chatbot_config_errors({
        "connection": {"adapter": "openai_compatible", "endpoint": "https://chat.test/v1/chat/completions"},
        "conversation": {"opening_message": {"mode": "fixed", "text": "hola"}},
    })
    valid = normalize_chatbot_config({
        "connection": {"adapter": "openai_compatible", "endpoint": "https://chat.test/v1/chat/completions", "model": "local"},
        "conversation": {"opening_message": {"mode": "fixed", "text": "hola"}},
    })

    assert any("model" in error for error in missing_model)
    assert chatbot_config_errors(valid) == []


def test_unsupported_response_format_and_session_mode_are_rejected():
    errors = chatbot_config_errors({
        "connection": {
            "endpoint": "https://chat.test/api",
            "response_mapping": {"response_format": "xml"},
        },
        "conversation": {"session_mode": "shared", "opening_message": {"mode": "fixed", "text": "hola"}},
    })

    assert "formato de respuesta" in errors[0].lower()
