from types import SimpleNamespace
from uuid import uuid4

from app.repositories.dataset_variables import native_environment_variables


def test_native_environment_exposes_base_url_compatibility_aliases():
    environment = SimpleNamespace(
        id=uuid4(),
        nombre="QA Web",
        url="https://qa.example.test",
        version="demo",
        status="Online",
    )

    variables = native_environment_variables(environment)

    assert variables["ENV.BASE_URL"] == "https://qa.example.test"
    assert "ENV.URL" not in variables
    assert variables["base_url"] == "https://qa.example.test"
    assert variables["BASE_URL"] == "https://qa.example.test"
