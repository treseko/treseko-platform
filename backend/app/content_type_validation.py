CONTENT_TYPE_SIGNATURES = {
    "application/pdf": (b"%PDF-",),
    "image/png": (b"\x89PNG\r\n\x1a\n",),
    "image/jpeg": (b"\xff\xd8\xff",),
    "image/jpg": (b"\xff\xd8\xff",),
    "image/gif": (b"GIF87a", b"GIF89a"),
    "image/webp": (b"RIFF",),
    "application/zip": (b"PK\x03\x04", b"PK\x05\x06", b"PK\x07\x08"),
    "application/x-zip-compressed": (b"PK\x03\x04", b"PK\x05\x06", b"PK\x07\x08"),
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": (b"PK\x03\x04", b"PK\x05\x06", b"PK\x07\x08"),
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": (b"PK\x03\x04", b"PK\x05\x06", b"PK\x07\x08"),
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": (b"PK\x03\x04", b"PK\x05\x06", b"PK\x07\x08"),
    "application/vnd.ms-excel": (b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1",),
    "application/msword": (b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1",),
    "application/vnd.ms-powerpoint": (b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1",),
    "video/webm": (b"\x1a\x45\xdf\xa3",),
}


def content_matches_declared_type(content_type: str, content: bytes) -> bool:
    normalized = (content_type or "").split(";", 1)[0].strip().lower()
    if not content:
        return False
    if normalized == "image/webp":
        return content.startswith(b"RIFF") and len(content) >= 12 and content[8:12] == b"WEBP"
    if normalized == "video/mp4":
        return len(content) >= 12 and content[4:8] == b"ftyp"
    signatures = CONTENT_TYPE_SIGNATURES.get(normalized)
    if signatures:
        return any(content.startswith(signature) for signature in signatures)
    if normalized in {"text/plain", "text/csv", "application/json", "application/xml", "text/xml"}:
        if b"\x00" in content:
            return False
        try:
            content[:4096].decode("utf-8")
        except UnicodeDecodeError:
            return False
    return True
