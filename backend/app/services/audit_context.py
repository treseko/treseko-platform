"""Request metadata used by the security audit trail."""

from __future__ import annotations

import ipaddress
import os
from contextvars import ContextVar
from typing import Any

from .error_contract import current_correlation_id


AUDIT_ORIGIN_HTTP = "http_client"
AUDIT_ORIGIN_PROXY = "trusted_proxy"
AUDIT_ORIGIN_INTERNAL = "internal_worker"
AUDIT_ORIGIN_UNKNOWN = "unknown"
_request_audit_context: ContextVar[dict[str, str | None] | None] = ContextVar(
    "treseko_request_audit_context", default=None
)


def _trusted_proxy_networks() -> tuple[ipaddress.IPv4Network | ipaddress.IPv6Network, ...]:
    configured = os.getenv("TRESEKO_TRUSTED_PROXY_IPS", "127.0.0.1,::1")
    networks: list[ipaddress.IPv4Network | ipaddress.IPv6Network] = []
    for raw_value in configured.split(","):
        value = raw_value.strip()
        if not value:
            continue
        try:
            networks.append(ipaddress.ip_network(value, strict=False))
        except ValueError:
            continue
    return tuple(networks)


def _is_trusted_proxy(peer: str | None) -> bool:
    if not peer:
        return False
    try:
        address = ipaddress.ip_address(peer)
    except ValueError:
        return False
    return any(address in network for network in _trusted_proxy_networks())


def _valid_ip(value: str | None) -> str | None:
    candidate = (value or "").strip()
    if not candidate:
        return None
    try:
        return str(ipaddress.ip_address(candidate))
    except ValueError:
        return None


def audit_request_context(request: Any | None) -> dict[str, str | None]:
    """Return safe audit metadata without trusting arbitrary forwarded headers."""
    if request is None:
        ambient = _request_audit_context.get()
        if ambient is not None:
            return {**ambient, "correlation_id": current_correlation_id(ambient.get("correlation_id"))}
        return {"ip_address": None, "origen": AUDIT_ORIGIN_UNKNOWN, "correlation_id": current_correlation_id()}

    peer = request.client.host if getattr(request, "client", None) else None
    if _is_trusted_proxy(peer):
        forwarded_for = request.headers.get("x-forwarded-for", "")
        forwarded_ip = _valid_ip(forwarded_for.split(",", 1)[0])
        if forwarded_ip:
            return {"ip_address": forwarded_ip, "origen": AUDIT_ORIGIN_PROXY, "correlation_id": current_correlation_id()}

    client_ip = _valid_ip(peer)
    if peer:
        return {"ip_address": client_ip, "origen": AUDIT_ORIGIN_HTTP, "correlation_id": current_correlation_id()}
    return {"ip_address": None, "origen": AUDIT_ORIGIN_UNKNOWN, "correlation_id": current_correlation_id()}


def internal_audit_context() -> dict[str, str | None]:
    return {"ip_address": None, "origen": AUDIT_ORIGIN_INTERNAL, "correlation_id": current_correlation_id()}


def set_request_audit_context(request: Any) -> object:
    """Bind request metadata so repositories called without a Request keep audit context."""
    peer = request.client.host if getattr(request, "client", None) else None
    context = audit_request_context(request)
    return _request_audit_context.set({**context, "peer_ip": _valid_ip(peer)})


def reset_request_audit_context(token: object) -> None:
    _request_audit_context.reset(token)  # type: ignore[arg-type]
