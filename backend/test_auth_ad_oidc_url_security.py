import os
import sys
from pathlib import Path

from pydantic import ValidationError


BACKEND_DIR = Path(__file__).resolve().parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))
os.chdir(BACKEND_DIR)

from app.services.auth_ad import oidc_service  # noqa: E402
from app import schemas  # noqa: E402


def _expect_value_error(func, *args, **kwargs):
    try:
        func(*args, **kwargs)
    except (ValueError, ValidationError):
        return
    raise AssertionError("expected ValueError")


def test_oidc_url_validator_rejects_insecure_and_local_targets():
    _expect_value_error(oidc_service.validate_oidc_https_url, "http://idp.example.com/.well-known/openid-configuration", "Discovery")
    _expect_value_error(oidc_service.validate_oidc_https_url, "https://localhost/.well-known/openid-configuration", "Discovery")
    _expect_value_error(oidc_service.validate_oidc_https_url, "https://127.0.0.1/.well-known/openid-configuration", "Discovery")
    _expect_value_error(oidc_service.validate_oidc_https_url, "https://10.0.0.8/.well-known/openid-configuration", "Discovery")
    assert oidc_service.validate_oidc_https_url("https://idp.example.com/.well-known/openid-configuration", "Discovery") == "https://idp.example.com/.well-known/openid-configuration"


def test_oidc_private_endpoint_override_is_explicit():
    original = os.environ.get("AUTH_AD_OIDC_ALLOW_PRIVATE_ENDPOINTS")
    try:
        os.environ["AUTH_AD_OIDC_ALLOW_PRIVATE_ENDPOINTS"] = "true"
        assert oidc_service.validate_oidc_https_url("https://10.0.0.8/.well-known/openid-configuration", "Discovery") == "https://10.0.0.8/.well-known/openid-configuration"
    finally:
        if original is None:
            os.environ.pop("AUTH_AD_OIDC_ALLOW_PRIVATE_ENDPOINTS", None)
        else:
            os.environ["AUTH_AD_OIDC_ALLOW_PRIVATE_ENDPOINTS"] = original


def test_oidc_redirect_path_must_be_local_absolute_path():
    assert oidc_service.safe_redirect_path("/auth/ad/callback/") == "/auth/ad/callback/"
    _expect_value_error(oidc_service.safe_redirect_path, "https://evil.example.com/callback")
    _expect_value_error(oidc_service.safe_redirect_path, "//evil.example.com/callback")
    _expect_value_error(oidc_service.safe_redirect_path, "/auth/ad/callback/\r\nX-Injected: 1")


def test_oidc_return_to_is_local_bounded_and_control_free():
    assert oidc_service.safe_return_to("/reportes?tab=metrics") == "/reportes?tab=metrics"
    assert oidc_service.safe_return_to("https://evil.example.com/") == "/"
    assert oidc_service.safe_return_to("//evil.example.com/") == "/"
    assert oidc_service.safe_return_to("/dashboard\r\nSet-Cookie: bad=1") == "/"
    assert oidc_service.safe_return_to("/" + ("x" * (oidc_service.MAX_OIDC_RETURN_TO_LENGTH + 1))) == "/"


def test_discovery_metadata_must_match_issuer_and_https_endpoints():
    config = {"issuer": "https://idp.example.com"}
    discovery = {
        "issuer": "https://idp.example.com",
        "authorization_endpoint": "https://idp.example.com/authorize",
        "token_endpoint": "https://idp.example.com/token",
        "jwks_uri": "https://idp.example.com/jwks",
    }
    assert oidc_service.validate_discovery_metadata(config, discovery) == discovery

    _expect_value_error(
        oidc_service.validate_discovery_metadata,
        config,
        {**discovery, "issuer": "https://evil.example.com"},
    )
    _expect_value_error(
        oidc_service.validate_discovery_metadata,
        config,
        {**discovery, "token_endpoint": "http://idp.example.com/token"},
    )


def test_oidc_config_update_rejects_insecure_urls_before_persisting():
    schemas.AuthAdOidcConfigUpdate(issuer="https://idp.example.com", discovery_url="https://idp.example.com/.well-known/openid-configuration")
    _expect_value_error(schemas.AuthAdOidcConfigUpdate, discovery_url="http://idp.example.com/.well-known/openid-configuration")
    _expect_value_error(schemas.AuthAdOidcConfigUpdate, issuer="https://127.0.0.1")
    _expect_value_error(schemas.AuthAdOidcConfigUpdate, redirect_path="//evil.example.com/callback")


def test_oidc_claim_email_rejects_header_injection_or_display_names():
    assert oidc_service._email_from_claims({"email": "User@Example.com"}) == "user@example.com"
    _expect_value_error(oidc_service._email_from_claims, {"email": "user@example.com\r\nBcc: attacker@example.com"})
    _expect_value_error(oidc_service._email_from_claims, {"email": "QA User <user@example.com>"})
    _expect_value_error(oidc_service._email_from_claims, {"email": "user@example.com,attacker@example.com"})


if __name__ == "__main__":
    test_oidc_url_validator_rejects_insecure_and_local_targets()
    test_oidc_private_endpoint_override_is_explicit()
    test_oidc_redirect_path_must_be_local_absolute_path()
    test_oidc_return_to_is_local_bounded_and_control_free()
    test_discovery_metadata_must_match_issuer_and_https_endpoints()
    test_oidc_config_update_rejects_insecure_urls_before_persisting()
    test_oidc_claim_email_rejects_header_injection_or_display_names()
    print("Auth AD/OIDC URL security checks OK")
