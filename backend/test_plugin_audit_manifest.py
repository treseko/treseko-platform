from app.services.plugins.manifest import audit_manifest_snapshot, installation_scope_key


def test_plugin_audit_keeps_full_signed_manifest_but_redacts_secrets():
    manifest = {
        "plugin_id": "com.treseko.junit-importer",
        "release_id": "release-1",
        "signature": {"algorithm": "ed25519", "key_id": "key-1", "value": "public-signature"},
        "authorization": "must-not-be-stored",
    }
    snapshot = audit_manifest_snapshot(manifest)
    assert snapshot["signature"]["value"] == "public-signature"
    assert "authorization" not in snapshot


def test_plugin_scope_key_is_nullable_safe_and_deterministic():
    assert installation_scope_key() == "global"
    assert installation_scope_key(organizacion_id="org-1") == "organization:org-1"
    assert installation_scope_key(organizacion_id="org-1", proyecto_id="project-1") == "project:project-1"
