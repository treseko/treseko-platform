"""Focused validation coverage for persisted visual-language preferences.

The existing HTTP integration harness seeds a configured PostgreSQL database
and authenticates a real user. It is not a secret-free isolated fixture, so
the PATCH-then-GET flow remains a documented follow-up rather than creating a
test that could write to an unintended database.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest
from pydantic import ValidationError


BACKEND_DIR = Path(__file__).resolve().parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))
os.chdir(BACKEND_DIR)
# Importing the public schemas initializes the database module. Keep this
# focused validation test independent from PostgreSQL and external secrets.
os.environ.setdefault("RUNTIME_ENVIRONMENT", "test")
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
os.environ.setdefault("ALLOW_SQLITE_LEGACY", "true")

from app import schemas  # noqa: E402


@pytest.mark.unit
def test_user_language_accepts_supported_visual_locales():
    assert schemas.UserLanguageUpdate(language=" ES ").language == "es"
    assert schemas.UserLanguageUpdate(language="EN").language == "en"
    assert schemas.UserLanguageUpdate(language=" Pt ").language == "pt"
    assert schemas.UserLanguageUpdate(language="PT").language == "pt"


@pytest.mark.unit
@pytest.mark.parametrize("language", ["fr", "english", "pt-BR", "p"])
def test_user_language_rejects_unsupported_or_noncanonical_values(language):
    with pytest.raises((ValidationError, ValueError)):
        schemas.UserLanguageUpdate(language=language)


@pytest.mark.unit
def test_user_language_response_preserves_existing_profile_settings():
    response = schemas.UserPreferences(
        personal_theme="light",
        profile_settings={"language": "pt", "density": "compact"},
        project_theme_overrides={},
    )

    assert response.profile_settings == {"language": "pt", "density": "compact"}
