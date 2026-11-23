from datetime import timedelta

import jwt

from app import auth


def _decode(token: str):
    return jwt.decode(token, auth.SECRET_KEY, algorithms=[auth.ALGORITHM])


def test_access_tokens_carry_access_type():
    token = auth.create_access_token({"sub": "user@example.com"}, expires_delta=timedelta(minutes=5))

    assert _decode(token)["type"] == "access"


def test_engine_ws_tokens_are_not_user_access_tokens():
    token = auth.create_access_token(
        {"sub": "ai-engine", "scope": "ai-engine-ws", "execution_id": "exec-1"},
        expires_delta=timedelta(minutes=5),
        token_type="engine_ws",
    )
    payload = _decode(token)

    assert payload["type"] == "engine_ws"
    assert payload["scope"] == "ai-engine-ws"
    assert payload["type"] != "access"


if __name__ == "__main__":
    test_access_tokens_carry_access_type()
    test_engine_ws_tokens_are_not_user_access_tokens()
    print("JWT token type security checks passed")
