"""Validated, importable examples for the Treseko portability contract."""
from __future__ import annotations

import hashlib
import io
import json
import zipfile
from datetime import datetime, timezone


def _canonical(value: object) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def build_tcases_example(format_id: str) -> bytes:
    """Return a small package accepted by the real `.tcases` parser."""
    project_id = "11111111-1111-4111-8111-111111111111"
    parent_suite_id = "22222222-2222-4222-8222-222222222222"
    suite_id = "33333333-3333-4333-8333-333333333333"
    case_id = "44444444-4444-4444-8444-444444444444"
    attachment_id = "55555555-5555-4555-8555-555555555555"
    attachment_content = (
        b"Treseko example evidence\n"
        b"Expected: dashboard visible after a successful login.\n"
    )
    attachment_path = (
        f"attachments/{case_id}/2-{attachment_id}-evidencia-login.txt"
    )

    suites = [
        {
            "id": parent_suite_id,
            "parent_id": None,
            "nombre": "Web",
            "descripcion": "Pruebas de la aplicación web.",
            "orden": 1,
        },
        {
            "id": suite_id,
            "parent_id": parent_suite_id,
            "nombre": "Autenticación",
            "descripcion": "Acceso y gestión de sesión.",
            "orden": 1,
        },
    ]
    case = {
        "external_id": case_id,
        "external_version": "1",
        "suite_id": suite_id,
        "titulo": "Inicio de sesión con credenciales válidas",
        "descripcion": "Validar que un usuario activo pueda acceder.",
        "precondiciones": "El usuario existe y se encuentra habilitado.",
        "postcondiciones": "La sesión queda iniciada.",
        "prioridad": "ALTA",
        "criticidad": "CRITICA",
        "tipo_prueba": "MANUAL",
        "estado_caso": "ACTIVO",
        "etiquetas": ["smoke", "autenticacion", "ejemplo"],
        "pasos": [
            {
                "numero_paso": 1,
                "accion": "Abrir la pantalla de inicio de sesión.",
                "datos": "URL: https://app.example.test/login",
                "resultado_esperado": "El formulario de acceso es visible.",
            },
            {
                "numero_paso": 2,
                "accion": "Ingresar credenciales válidas y confirmar.",
                "datos": "Usuario: qa@example.test",
                "resultado_esperado": "Se muestra el dashboard del usuario.",
            },
        ],
    }
    cases = [case]
    versions = [{"master_id": case_id, "version": 1, "case": case}]
    attachments = [
        {
            "case_external_id": case_id,
            "step_number": 2,
            "filename": "evidencia-login.txt",
            "content_type": "text/plain",
            "size": len(attachment_content),
            "sha256": hashlib.sha256(attachment_content).hexdigest(),
            "tipo": "evidence",
            "archive_path": attachment_path,
        }
    ]
    payloads = {
        "cases.json": cases,
        "suites.json": suites,
        "versions.json": versions,
        "attachments.json": attachments,
    }
    manifest = {
        "format": format_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "project_id": project_id,
        "checksums": {
            name: hashlib.sha256(_canonical(value)).hexdigest()
            for name, value in payloads.items()
        },
        "case_count": len(cases),
    }
    readme = """EJEMPLO DE MIGRACION TRESEKO

Este archivo es un ZIP con extension .tcases. No cambies solamente la extension
de otro archivo. Genera manifest.json, cases.json, suites.json, versions.json y
attachments.json, calcula sus SHA-256 y agrega los binarios bajo attachments/.
"""

    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("manifest.json", _canonical(manifest))
        for name, value in payloads.items():
            archive.writestr(name, _canonical(value))
        archive.writestr(attachment_path, attachment_content)
        archive.writestr("README.txt", readme.encode("utf-8"))
    return stream.getvalue()
