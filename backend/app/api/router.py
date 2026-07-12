import os

from fastapi import APIRouter

from .routers import (
    audit,
    ai_engine,
    auth,
    auth_ad,
    attachments,
    automation_functions,
    automation,
    bugs,
    builds,
    cases,
    components,
    debug,
    executions,
    extensions,
    external_api,
    environments,
    inventory,
    legacy_automation_execution,
    notifications,
    organizations,
    portability,
    projects,
    redmine,
    reports,
    roles,
    scheduler,
    script_validation,
    system,
    system_monitor,
    suites,
    test_runs,
    users,
    websocket_sync,
    wiki,
)


api_router = APIRouter()
api_router.include_router(audit.router)
api_router.include_router(ai_engine.router)
api_router.include_router(auth.router)
api_router.include_router(auth_ad.router)
api_router.include_router(attachments.router)
api_router.include_router(automation_functions.router)
api_router.include_router(automation.router)
api_router.include_router(bugs.router)
api_router.include_router(builds.router)
api_router.include_router(cases.router)
api_router.include_router(components.router)
if (os.getenv("APP_ENV") or os.getenv("ENVIRONMENT") or os.getenv("ENV") or "").strip().lower() in {"dev", "development", "local"}:
    api_router.include_router(debug.router)
api_router.include_router(executions.router)
api_router.include_router(extensions.router)
api_router.include_router(external_api.router)
api_router.include_router(environments.router)
api_router.include_router(inventory.router)
api_router.include_router(legacy_automation_execution.router)
api_router.include_router(organizations.router)
api_router.include_router(portability.router)
api_router.include_router(projects.router)
api_router.include_router(redmine.router)
api_router.include_router(reports.router)
api_router.include_router(users.router)
api_router.include_router(roles.router)
api_router.include_router(scheduler.router)
api_router.include_router(script_validation.router)
api_router.include_router(system.router)
api_router.include_router(notifications.router)
api_router.include_router(system_monitor.router)
api_router.include_router(suites.router)
api_router.include_router(test_runs.router)
api_router.include_router(websocket_sync.router)
api_router.include_router(wiki.router)
