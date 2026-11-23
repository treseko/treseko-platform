from __future__ import annotations

from cryptography.fernet import Fernet
import pytest

from app import schemas
from app.services.ai_credential_crypto import decrypt_ai_credential, encrypt_ai_credential


def test_ai_vault_uses_dedicated_fernet_key(monkeypatch):
    key = Fernet.generate_key().decode("ascii")
    monkeypatch.setenv("AI_CREDENTIALS_MASTER_KEY", key)
    monkeypatch.delenv("AI_CREDENTIALS_MASTER_KEY_FILE", raising=False)
    encrypted, key_id = encrypt_ai_credential("provider-secret")
    assert "provider-secret" not in encrypted
    assert decrypt_ai_credential(encrypted, key_id) == "provider-secret"


def test_ai_vault_rejects_missing_or_rotated_master_key(monkeypatch):
    monkeypatch.delenv("AI_CREDENTIALS_MASTER_KEY", raising=False)
    monkeypatch.delenv("AI_CREDENTIALS_MASTER_KEY_FILE", raising=False)
    with pytest.raises(RuntimeError, match="obligatorio"):
        encrypt_ai_credential("secret")
    monkeypatch.setenv("AI_CREDENTIALS_MASTER_KEY", Fernet.generate_key().decode("ascii"))
    encrypted, key_id = encrypt_ai_credential("secret")
    monkeypatch.setenv("AI_CREDENTIALS_MASTER_KEY", Fernet.generate_key().decode("ascii"))
    with pytest.raises(RuntimeError, match="otra clave"):
        decrypt_ai_credential(encrypted, key_id)


@pytest.mark.parametrize("endpoint", [
    "http://provider.example/v1",
    "https://user:pass@provider.example/v1",
    "https://provider.example/v1?key=secret",
    "file:///tmp/model",
])
def test_provider_profile_rejects_unsafe_endpoints(endpoint):
    with pytest.raises(ValueError):
        schemas.AiProviderProfileCreate(
            name="perfil", provider="openai", adapter="openai-responses",
            endpoint=endpoint, model="model-a",
        )


def test_provider_profile_allows_https_and_local_models():
    remote = schemas.AiProviderProfileCreate(name="openai", provider="openai", adapter="openai-responses", endpoint="https://api.openai.example/v1", model="model-a")
    local = schemas.AiProviderProfileCreate(name="ollama", provider="ollama", adapter="openai-compatible", endpoint="http://127.0.0.1:11434/v1", model="local")
    docker_host = schemas.AiProviderProfileCreate(name="lm-studio", provider="lm-studio", adapter="openai-compatible", endpoint="http://host.docker.internal:1234/v1", model="local")
    assert remote.endpoint.startswith("https://")
    assert local.endpoint.startswith("http://127.0.0.1")
    assert docker_host.endpoint.startswith("http://host.docker.internal")


def test_public_credential_contract_has_no_secret_field():
    assert "secret" not in schemas.AiProviderCredentialResponse.model_fields
    assert "secret_value_encrypted" not in schemas.AiProviderCredentialResponse.model_fields
