import asyncio
import os
from typing import Any
from urllib.parse import urlparse

from ldap3 import ALL, Connection, Server
from ldap3.core.exceptions import LDAPException
from ldap3.utils.conv import escape_filter_chars


class LdapAuthenticationError(ValueError):
    pass


class LdapLookupError(ValueError):
    pass


class LdapLookupUnavailableError(LdapLookupError):
    pass


def _env_or_file(name: str) -> str:
    value = os.getenv(name)
    if value:
        return value.strip()
    file_path = os.getenv(f"{name}_FILE")
    if not file_path:
        return ""
    try:
        with open(file_path, "r", encoding="utf-8") as handle:
            return handle.read().strip()
    except OSError:
        return ""


def _allow_insecure_ldap() -> bool:
    return (os.getenv("AUTH_AD_LDAP_ALLOW_INSECURE") or os.getenv("AUTH_AD_OIDC_ALLOW_PRIVATE_ENDPOINTS") or "").strip().lower() in {"1", "true", "yes"}


def _validate_ldap_config(config: dict[str, Any]) -> tuple[str, str, str, str]:
    ldap_url = str(config.get("ldap_url") or "").strip()
    base_dn = str(config.get("ldap_base_dn") or "").strip()
    user_attribute = str(config.get("ldap_user_attribute") or "sAMAccountName").strip()
    bind_pattern = str(config.get("ldap_bind_pattern") or "{username}@{domain}").strip()
    parsed = urlparse(ldap_url)
    if parsed.scheme.lower() not in {"ldap", "ldaps"} or not parsed.netloc:
        raise ValueError("LDAP URL no configurada o invalida")
    if parsed.scheme.lower() == "ldap" and not _allow_insecure_ldap():
        raise ValueError("LDAP directo debe usar LDAPS en produccion")
    if not base_dn:
        raise ValueError("LDAP base DN no configurado")
    if not user_attribute or any(char in user_attribute for char in ("*", "(", ")", "\\", "\x00")):
        raise ValueError("Atributo de usuario LDAP invalido")
    if "{username}" not in bind_pattern:
        raise ValueError("LDAP bind pattern debe incluir {username}")
    return ldap_url, base_dn, user_attribute, bind_pattern


def _domain_for_bind(username: str, config: dict[str, Any]) -> str:
    if "@" in username:
        return username.rsplit("@", 1)[1].lower()
    allowed_domains = config.get("allowed_domains") or []
    if allowed_domains:
        return str(allowed_domains[0]).lstrip("@").lower()
    return ""


def _bind_name(username: str, config: dict[str, Any], bind_pattern: str) -> str:
    domain = _domain_for_bind(username, config)
    bare_username = username.split("@", 1)[0].strip()
    return bind_pattern.format(username=bare_username, domain=domain, upn=username.strip())


def _groups_from_member_of(values: list[str]) -> list[str]:
    groups: list[str] = []
    for member_of in values:
        first = str(member_of).split(",", 1)[0]
        if first.upper().startswith("CN="):
            groups.append(first[3:])
    return groups


def _claims_from_entry(data: dict[str, Any], identifier: str, config: dict[str, Any]) -> dict[str, Any]:
    account = (data.get("sAMAccountName") or [identifier.split("@", 1)[0]])[0]
    upn = (data.get("userPrincipalName") or [identifier if "@" in identifier else ""])[0]
    email = (data.get("mail") or [upn or f"{account}@{_domain_for_bind(identifier, config)}"])[0]
    name = (data.get("displayName") or data.get("cn") or [email])[0]
    return {
        "sub": str(upn or email).lower(),
        "email": str(email).lower(),
        "preferred_username": str(account),
        "upn": str(upn or email).lower(),
        "name": str(name),
        "given_name": str((data.get("givenName") or [""])[0]),
        "family_name": str((data.get("sn") or [""])[0]),
        "groups": _groups_from_member_of([str(item) for item in data.get("memberOf", [])]),
        "email_verified": True,
    }


def _search_user(conn: Connection, config: dict[str, Any], identifier: str) -> dict[str, Any] | None:
    _, base_dn, user_attribute, _ = _validate_ldap_config(config)
    clean_identifier = str(identifier or "").strip()
    if not clean_identifier or any(char in clean_identifier for char in ("\x00", "\r", "\n", "\t", "*", "(", ")", "\\")):
        raise LdapLookupError("Usuario LDAP invalido")
    bare_identifier = clean_identifier.split("@", 1)[0]
    escaped_identifier = escape_filter_chars(clean_identifier)
    escaped_bare = escape_filter_chars(bare_identifier)
    search_filter = (
        f"(|({user_attribute}={escaped_identifier})"
        f"({user_attribute}={escaped_bare})"
        f"(userPrincipalName={escaped_identifier})"
        f"(mail={escaped_identifier}))"
    )
    attributes = ["cn", "displayName", "givenName", "sn", "mail", "userPrincipalName", "sAMAccountName", "memberOf"]
    ok = conn.search(base_dn, search_filter, attributes=attributes, size_limit=1)
    if not ok or not conn.entries:
        return None
    return _claims_from_entry(conn.entries[0].entry_attributes_as_dict, clean_identifier, config)


def _validate_lookup_query(query: str, *, min_length: int = 1) -> str:
    clean_query = str(query or "").strip()
    if len(clean_query) < min_length or any(char in clean_query for char in ("\x00", "\r", "\n", "\t", "*", "(", ")", "\\")):
        raise LdapLookupError("Usuario LDAP invalido")
    return clean_query


def _search_users(conn: Connection, config: dict[str, Any], query: str, limit: int) -> list[dict[str, Any]]:
    _, base_dn, user_attribute, _ = _validate_ldap_config(config)
    clean_query = _validate_lookup_query(query, min_length=2)
    safe_limit = max(1, min(int(limit or 8), 20))
    escaped = escape_filter_chars(clean_query)
    search_filter = (
        "(&(|(objectClass=user)(objectClass=person)(objectClass=inetOrgPerson))(|"
        f"({user_attribute}={escaped}*)"
        f"(userPrincipalName={escaped}*)"
        f"(mail={escaped}*)"
        f"(displayName=*{escaped}*)"
        f"(cn=*{escaped}*)"
        "))"
    )
    attributes = ["cn", "displayName", "givenName", "sn", "mail", "userPrincipalName", "sAMAccountName", "memberOf"]
    ok = conn.search(base_dn, search_filter, attributes=attributes, size_limit=safe_limit)
    if not ok or not conn.entries:
        return []
    results = [_claims_from_entry(entry.entry_attributes_as_dict, clean_query, config) for entry in conn.entries]
    return sorted(results, key=lambda item: (str(item.get("name") or ""), str(item.get("email") or "")))


def _lookup_bind_credentials() -> tuple[str, str]:
    bind_dn = _env_or_file("AUTH_AD_LDAP_LOOKUP_BIND_DN")
    bind_password = _env_or_file("AUTH_AD_LDAP_LOOKUP_BIND_PASSWORD")
    if not bind_dn or not bind_password:
        raise LdapLookupUnavailableError("LDAP lookup requiere AUTH_AD_LDAP_LOOKUP_BIND_DN y AUTH_AD_LDAP_LOOKUP_BIND_PASSWORD")
    return bind_dn, bind_password


def _find_user_sync(config: dict[str, Any], identifier: str) -> dict[str, Any] | None:
    ldap_url, _, _, _ = _validate_ldap_config(config)
    bind_dn, bind_password = _lookup_bind_credentials()
    try:
        server = Server(ldap_url, get_info=ALL, connect_timeout=8)
        conn = Connection(server, user=bind_dn, password=bind_password, auto_bind=True, receive_timeout=10, auto_referrals=False)
    except LDAPException as exc:
        raise LdapLookupError("No se pudo consultar LDAP") from exc
    try:
        return _search_user(conn, config, identifier)
    finally:
        conn.unbind()


def _search_users_sync(config: dict[str, Any], query: str, limit: int = 8) -> list[dict[str, Any]]:
    ldap_url, _, _, _ = _validate_ldap_config(config)
    bind_dn, bind_password = _lookup_bind_credentials()
    try:
        server = Server(ldap_url, get_info=ALL, connect_timeout=8)
        conn = Connection(server, user=bind_dn, password=bind_password, auto_bind=True, receive_timeout=10, auto_referrals=False)
    except LDAPException as exc:
        raise LdapLookupError("No se pudo consultar LDAP") from exc
    try:
        return _search_users(conn, config, query, limit)
    finally:
        conn.unbind()


def _authenticate_sync(config: dict[str, Any], username: str, password: str) -> dict[str, Any]:
    clean_username = str(username or "").strip()
    if not clean_username or any(char in clean_username for char in ("\x00", "\r", "\n", "\t", "*", "(", ")", "\\")):
        raise LdapAuthenticationError("Usuario LDAP invalido")
    if not password:
        raise LdapAuthenticationError("Credenciales LDAP invalidas")

    ldap_url, base_dn, user_attribute, bind_pattern = _validate_ldap_config(config)
    bind_name = _bind_name(clean_username, config, bind_pattern)
    try:
        server = Server(ldap_url, get_info=ALL, connect_timeout=8)
        conn = Connection(server, user=bind_name, password=password, auto_bind=True, receive_timeout=10, auto_referrals=False)
    except LDAPException as exc:
        raise LdapAuthenticationError("Credenciales LDAP invalidas") from exc

    bare_username = clean_username.split("@", 1)[0]
    escaped_user = escape_filter_chars(clean_username)
    escaped_bare = escape_filter_chars(bare_username)
    search_filter = f"(|({user_attribute}={escaped_user})({user_attribute}={escaped_bare})(userPrincipalName={escaped_user}))"
    attributes = ["cn", "displayName", "givenName", "sn", "mail", "userPrincipalName", "sAMAccountName", "memberOf"]
    try:
        ok = conn.search(base_dn, search_filter, attributes=attributes, size_limit=1)
        if not ok or not conn.entries:
            raise LdapAuthenticationError("Usuario LDAP no encontrado")
        entry = conn.entries[0]
        data = entry.entry_attributes_as_dict
    finally:
        conn.unbind()

    return _claims_from_entry(data, clean_username, config)


async def authenticate(config: dict[str, Any], username: str, password: str) -> dict[str, Any]:
    return await asyncio.to_thread(_authenticate_sync, config, username, password)


async def find_user(config: dict[str, Any], identifier: str) -> dict[str, Any] | None:
    return await asyncio.to_thread(_find_user_sync, config, identifier)


async def search_users(config: dict[str, Any], query: str, limit: int = 8) -> list[dict[str, Any]]:
    return await asyncio.to_thread(_search_users_sync, config, query, limit)
