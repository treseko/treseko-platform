import json

from app.services.case_portability_parser import parse_import


def test_postman_collection_preserves_folders_order_and_scripts():
    collection = {
        "info": {"name": "Commerce API", "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"},
        "variable": [{"key": "base_url", "value": "{{base_url}}"}],
        "item": [{"name": "Auth", "item": [{
            "id": "login-1", "name": "Login", "request": {"method": "POST", "url": "{{base_url}}/login", "body": {"mode": "raw", "raw": "{}", "options": {"raw": {"language": "json"}}}},
            "event": [{"listen": "test", "script": {"exec": ["pm.test('status', () => pm.response.to.have.status(200));"]}}],
        }, {"id": "me-1", "name": "Me", "request": {"method": "GET", "url": "{{base_url}}/me"}}]}],
    }

    package = parse_import("postman/collection-v2.1", json.dumps(collection).encode())

    assert [item["titulo"] for item in package["cases"]] == ["Login", "Me"]
    assert package["cases"][0]["suite_path"] == "Commerce API/Auth"
    assert package["cases"][0]["configuracion_api"]["schema_version"] == "treseko.api-test/v2"
    assert "pm.test" in package["cases"][0]["configuracion_api"]["post_response_script"]
