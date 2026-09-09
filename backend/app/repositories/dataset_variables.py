from typing import Any, Dict


def native_environment_variables(entorno: Any) -> Dict[str, str]:
    """Expose environment metadata and backwards-compatible URL aliases."""
    base_url = entorno.url or ""
    return {
        "ENV.ID": str(entorno.id),
        "ENV.NAME": entorno.nombre or "",
        "ENV.BASE_URL": base_url,
        "ENV.VERSION": entorno.version or "",
        "ENV.STATUS": entorno.status or "",
        # Keep {{base_url}} compatible with API cases created before the
        # explicit ENV.* namespace was introduced. Explicit environment,
        # dataset, and case variables still win through the existing merge
        # order in resolve_case_dataset.
        "base_url": base_url,
        "BASE_URL": base_url,
    }
