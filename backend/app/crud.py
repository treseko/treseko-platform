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
for _module in [*_modules, *_source_modules]:
    vars(_module).update(_exports)
__all__ = sorted(_exports)
del import_module, _MODULE_NAMES, _modules, _source_modules, _module, _name, _value, _exports
