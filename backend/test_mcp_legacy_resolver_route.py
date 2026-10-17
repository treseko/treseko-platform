from app.app_factory import create_app
from app.api.routers.mcp import resolve_engine_runtime_credential


def test_106_compose_resolver_path_remains_available():
    app = create_app()
    route = next(
        route for route in app.routes
        if getattr(route, "path", None) == "/api/mcp/internal/runtime-credential"
    )

    assert "POST" in route.methods
    assert route.endpoint is resolve_engine_runtime_credential
    assert route.include_in_schema is False
