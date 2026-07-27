from importlib import import_module

_MODULE_NAMES = [
    "app.repositories.users",
    "app.repositories.roles",
    "app.repositories.organizations",
    "app.repositories.projects",
    "app.repositories.components",
    "app.repositories.builds",
    "app.repositories.suites",
    "app.repositories.cases",
    "app.repositories.executions",
    "app.repositories.snapshots",
    "app.repositories.attachments",
    "app.repositories.bugs",
    "app.repositories.automation",
    "app.repositories.ai",
    "app.repositories.reports",
    "app.repositories.redmine",
    "app.repositories.integrations",
    "app.repositories.inventory",
    "app.repositories.wiki",
    "app.repositories.scheduler",
    "app.repositories.settings",
    "app.repositories.external_api",
    "app.repositories.traceability",
    "app.repositories.story_generation",
    "app.repositories.case_generation",
]

_modules = [import_module(name) for name in _MODULE_NAMES]
_source_modules = []
for _module in _modules:
    for _source_module in getattr(_module, "__source_modules__", []):
        if _source_module not in _source_modules:
            _source_modules.append(_source_module)
_exports = {}
for _module in _modules:
    for _name, _value in vars(_module).items():
        if not _name.startswith("__"):
            _exports[_name] = _value
globals().update(_exports)
# Los módulos de repositorio pueden compartir utilidades públicas a través de este
# agregador por compatibilidad histórica. No propagar nombres privados: dos
# repositorios pueden tener helpers internos con el mismo nombre (por ejemplo
# ``_call_engine``) y sobrescribirlos cambia silenciosamente el flujo que usa
# cada uno.
for _module in [*_modules, *_source_modules]:
    _module_vars = vars(_module)
    # Algunos módulos históricos consumen helpers privados inyectados por el
    # agregador. Sólo completar los que no existan; jamás reemplazar el helper
    # privado que el propio módulo ya declaró.
    _module_vars.update(
        {
            name: value
            for name, value in _exports.items()
            if not name.startswith("_") or name not in _module_vars
        }
    )
__all__ = sorted(_exports)
del import_module, _MODULE_NAMES, _modules, _source_modules, _module, _name, _value, _exports, _module_vars
