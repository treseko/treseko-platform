import base64
import binascii
import logging
import os
from uuid import UUID
from typing import Optional

from .services.error_sanitizer import sanitize_external_error


logger = logging.getLogger(__name__)

STATIC_DIR = "app/static/evidencias"
MAX_EVIDENCE_IMAGE_BASE64_LENGTH = 16 * 1024 * 1024
MAX_EVIDENCE_IMAGE_BYTES = 12 * 1024 * 1024
ALLOWED_IMAGE_SIGNATURES = (b"\x89PNG\r\n\x1a\n", b"\xff\xd8\xff", b"GIF87a", b"GIF89a", b"RIFF")

def save_evidence_image(snapshot_id: UUID, image_base64: str) -> Optional[str]:
    """
    Guarda una imagen en Base64 en el sistema de archivos y devuelve la URL relativa.
    """
    try:
        if not image_base64 or not isinstance(image_base64, str):
            return None

        # Limpiar prefijo base64 si existe
        if "," in image_base64:
            prefix, image_base64 = image_base64.split(",", 1)
            if not prefix.lower().startswith("data:image/") or ";base64" not in prefix.lower():
                return None

        image_base64 = image_base64.strip()
        if len(image_base64) > MAX_EVIDENCE_IMAGE_BASE64_LENGTH:
            return None

        try:
            image_bytes = base64.b64decode(image_base64, validate=True)
        except (binascii.Error, ValueError):
            return None

        if not image_bytes or len(image_bytes) > MAX_EVIDENCE_IMAGE_BYTES:
            return None
        if not any(image_bytes.startswith(signature) for signature in ALLOWED_IMAGE_SIGNATURES):
            return None

        file_path = os.path.join(STATIC_DIR, f"{snapshot_id}.png")
        
        # Asegurar que el directorio existe
        os.makedirs(STATIC_DIR, exist_ok=True)
        
        with open(file_path, "wb") as f:
            f.write(image_bytes)
            
        return f"/static/evidencias/{snapshot_id}.png"
    except Exception as e:
        logger.warning("Error al guardar evidencia visual: %s", sanitize_external_error(e))
        return None
