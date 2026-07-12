from urllib.parse import parse_qs

MAX_ASSET_QUERY_TOKEN_LENGTH = 2000
MAX_ASSET_QUERY_STRING_LENGTH = 4096


def normalize_asset_token(token: str | None) -> str | None:
    value = (token or "").strip()
    if (
        not value
        or len(value) > MAX_ASSET_QUERY_TOKEN_LENGTH
        or any(char.isspace() for char in value)
        or "\x00" in value
    ):
        return None
    return value


def extract_asset_query_token(query_string: bytes | str | None) -> str | None:
    if isinstance(query_string, bytes):
        raw_query = query_string.decode("latin1")
    else:
        raw_query = query_string or ""
    if len(raw_query) > MAX_ASSET_QUERY_STRING_LENGTH:
        return None
    try:
        query = parse_qs(raw_query, max_num_fields=20)
    except ValueError:
        return None
    values = query.get("asset_token")
    if not values or len(values) != 1:
        return None
    return normalize_asset_token(values[0])
