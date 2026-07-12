"""Seed demo mixto para presentaciones y desarrollo.

Este script no forma parte del bootstrap productivo limpio. Crea una solucion
demo con dos proyectos, datos historicos y ejecuciones suficientes para
Dashboard, Reportes, Bug Tracker, Historial y Complementos.
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Iterable

from sqlalchemy import delete, select

from app import auth, crud, models
from app.database import AsyncSessionLocal, BACKEND_DIR
from app.services.integrations.registry import get_registered_integrations
from app.services.plugins.registry import get_registered_plugins


SEED_MARK = "demo_showcase_v1"
ORG_NAME = "Treseko Demo Lab"
LEGACY_ORG_NAMES = ("Inmser Demo Lab",)
DEMO_ORG_NAMES = (ORG_NAME, *LEGACY_ORG_NAMES)
ADMIN_EMAIL = "admin@qa.local"
SYSTEM_USER = uuid.UUID(int=0)
UTC = timezone.utc


@dataclass(frozen=True)
class ProjectSpec:
    code: str
    name: str
    description: str
    components: tuple[tuple[str, str, str], ...]
    environments: tuple[tuple[str, str, str], ...]
    builds: tuple[tuple[str, int, int, bool], ...]
    suites: tuple[tuple[str, str, str], ...]
    case_prefix: str


PROJECTS = (
    ProjectSpec(
        code="PRJ-COMMERCE-DEMO",
        name="Commerce QA Portal",
        description="Demo comercial para validar un portal web de e-commerce con flujo mixto manual, Playwright e IA.",
        components=(
            ("CMP-WEB-SHOP", "Web Storefront", "React, Vite, Bootstrap"),
            ("CMP-CHECKOUT-API", "Checkout API", "FastAPI, PostgreSQL, Redis"),
        ),
        environments=(
            ("QA Web", "https://qa-commerce.demo.treseko.local", "qa"),
            ("Staging Web", "https://staging-commerce.demo.treseko.local", "staging"),
        ),
        builds=(
            ("v1.5.0-rc.2", -3, 4, True),
            ("v1.4.0", -12, -8, False),
            ("v1.3.0", -20, -16, False),
        ),
        suites=(
            ("Login y sesion", "#E0F2FE", "shield-check"),
            ("Catalogo y carrito", "#ECFDF5", "shopping-cart"),
            ("Checkout y pagos", "#FEF3C7", "credit-card"),
            ("Reportes de orden", "#F3E8FF", "file-chart-column"),
            ("Regresion automatizada", "#DBEAFE", "bot"),
        ),
        case_prefix="COM",
    ),
    ProjectSpec(
        code="PRJ-OPS-DEMO",
        name="Operations Mobile/API",
        description="Demo para operaciones mobile/API con servicios internos, evidencias, IA y regresion automatizada simulada.",
        components=(
            ("CMP-MOBILE-APP", "Mobile App", "React Native, Android, iOS"),
            ("CMP-OPS-API", "Operations API", "FastAPI, Webhooks, PostgreSQL"),
        ),
        environments=(
            ("QA Mobile", "https://qa-ops.demo.treseko.local", "qa"),
            ("API Sandbox", "https://api-sandbox.demo.treseko.local", "sandbox"),
        ),
        builds=(
            ("mobile-2.8.0-beta", -4, 5, True),
            ("mobile-2.7.0", -15, -11, False),
        ),
        suites=(
            ("Autenticacion mobile", "#FFE4E6", "smartphone"),
            ("Sincronizacion offline", "#EDE9FE", "refresh-cw"),
            ("API de operaciones", "#DCFCE7", "server"),
            ("Notificaciones", "#FEF9C3", "bell"),
            ("Regresion IA", "#E0E7FF", "brain-circuit"),
        ),
        case_prefix="OPS",
    ),
)


def now_utc() -> datetime:
    return datetime.now(UTC).replace(microsecond=0)


def new_id() -> uuid.UUID:
    return uuid.uuid4()


async def get_admin(session) -> models.Usuario:
    result = await session.execute(select(models.Usuario).where(models.Usuario.email == ADMIN_EMAIL))
    admin = result.scalar_one_or_none()
    if not admin:
        raise RuntimeError("No existe admin@qa.local. Ejecuta primero backend/seed_admin.py.")
    admin.rol = models.Rol.ADMIN
    admin.activo = True
    admin.auth_provider = "local"
    admin.permisos = auth.default_permissions_for_role(models.Rol.ADMIN)
    admin.modulos = auth.default_modules_for_role(models.Rol.ADMIN)
    return admin


async def ensure_code(session, instance, model, prefix: str, preferred: str) -> None:
    instance.codigo = preferred
    exists = await session.execute(select(model.id).where(model.codigo == preferred, model.id != instance.id))
    if exists.scalar_one_or_none():
        instance.codigo = await crud.generate_short_code(session, model, prefix)


async def reset_demo(session) -> None:
    result = await session.execute(select(models.Organizacion).where(models.Organizacion.nombre.in_(DEMO_ORG_NAMES)))
    orgs = result.scalars().all()
    for org in orgs:
        project_ids = [row[0] for row in (await session.execute(select(models.Proyecto.id).where(models.Proyecto.organizacion_id == org.id))).all()]
        if project_ids:
            build_ids = [row[0] for row in (await session.execute(select(models.Build.id).where(models.Build.proyecto_id.in_(project_ids)))).all()]
            run_ids = [row[0] for row in (await session.execute(select(models.TestRun.id).where(models.TestRun.proyecto_id.in_(project_ids)))).all()]
            execution_ids = [row[0] for row in (await session.execute(select(models.EjecucionCaso.id).where(models.EjecucionCaso.test_run_id.in_(run_ids)))).all()] if run_ids else []
            bug_ids = [row[0] for row in (await session.execute(select(models.BugIssue.id).where(models.BugIssue.proyecto_id.in_(project_ids)))).all()]

            if bug_ids:
                await session.execute(delete(models.BugAttachment).where(models.BugAttachment.bug_id.in_(bug_ids)))
                await session.execute(delete(models.BugComment).where(models.BugComment.bug_id.in_(bug_ids)))
                await session.execute(delete(models.ExternalIssueLink).where(models.ExternalIssueLink.bug_id.in_(bug_ids)))
                await session.execute(delete(models.BugIssue).where(models.BugIssue.id.in_(bug_ids)))
            if execution_ids:
                snapshot_ids = [row[0] for row in (await session.execute(select(models.SnapshotPaso.id).where(models.SnapshotPaso.ejecucion_caso_id.in_(execution_ids)))).all()]
                if snapshot_ids:
                    await session.execute(delete(models.SnapshotAttachment).where(models.SnapshotAttachment.snapshot_id.in_(snapshot_ids)))
                await session.execute(delete(models.AutomationJob).where(models.AutomationJob.ejecucion_id.in_(execution_ids)))
            if run_ids:
                await session.execute(delete(models.TestRun).where(models.TestRun.id.in_(run_ids)))
            if build_ids:
                await session.execute(delete(models.BuildCaso).where(models.BuildCaso.build_id.in_(build_ids)))
                await session.execute(delete(models.Build).where(models.Build.id.in_(build_ids)))

            await session.execute(delete(models.IntegrationInstance).where(models.IntegrationInstance.proyecto_id.in_(project_ids)))
            await session.execute(delete(models.FuncionAutomatizada).where(models.FuncionAutomatizada.proyecto_id.in_(project_ids)))
            await session.execute(delete(models.Entorno).where(models.Entorno.proyecto_id.in_(project_ids)))
            await session.execute(delete(models.CasoPrueba).where(models.CasoPrueba.proyecto_id.in_(project_ids)))
            await session.execute(delete(models.Suite).where(models.Suite.proyecto_id.in_(project_ids)))
            await session.execute(delete(models.Componente).where(models.Componente.proyecto_id.in_(project_ids)))
            await session.execute(delete(models.ProyectoMiembro).where(models.ProyectoMiembro.proyecto_id.in_(project_ids)))
            await session.execute(delete(models.Proyecto).where(models.Proyecto.id.in_(project_ids)))

        await session.execute(delete(models.OrganizacionMiembro).where(models.OrganizacionMiembro.organizacion_id == org.id))
        await session.delete(org)
    await session.flush()


async def upsert_org(session, admin: models.Usuario) -> models.Organizacion:
    result = await session.execute(select(models.Organizacion).where(models.Organizacion.nombre == ORG_NAME))
    org = result.scalar_one_or_none()
    if not org:
        org = models.Organizacion(id=new_id(), nombre=ORG_NAME, tipo="Demo", activo=True)
        session.add(org)
        await session.flush()
    org.descripcion = f"{SEED_MARK}: solucion demo para presentaciones comerciales y QA realista."
    org.activo = True
    await ensure_code(session, org, models.Organizacion, "SOL", "SOL-INMSER-DEMO")

    membership = await session.execute(
        select(models.OrganizacionMiembro).where(
            models.OrganizacionMiembro.organizacion_id == org.id,
            models.OrganizacionMiembro.usuario_id == admin.id,
        )
    )
    if not membership.scalar_one_or_none():
        session.add(models.OrganizacionMiembro(id=new_id(), organizacion_id=org.id, usuario_id=admin.id, rol_cliente="OWNER"))
    return org


async def upsert_project(session, org: models.Organizacion, admin: models.Usuario, spec: ProjectSpec) -> models.Proyecto:
    result = await session.execute(select(models.Proyecto).where(models.Proyecto.nombre == spec.name))
    project = result.scalar_one_or_none()
    if not project:
        project = models.Proyecto(id=new_id(), organizacion_id=org.id, nombre=spec.name, activo=True)
        session.add(project)
        await session.flush()
    project.organizacion_id = org.id
    project.descripcion = f"{SEED_MARK}: {spec.description}"
    project.estado = "Activo"
    project.activo = True
    project.report_settings = {"seed": SEED_MARK, "default_view": "qa_release"}
    await ensure_code(session, project, models.Proyecto, "PRJ", spec.code)

    membership = await session.execute(
        select(models.ProyectoMiembro).where(
            models.ProyectoMiembro.proyecto_id == project.id,
            models.ProyectoMiembro.usuario_id == admin.id,
        )
    )
    if not membership.scalar_one_or_none():
        session.add(models.ProyectoMiembro(id=new_id(), proyecto_id=project.id, usuario_id=admin.id, rol_proyecto="OWNER"))
    return project


async def upsert_components(session, project: models.Proyecto, spec: ProjectSpec) -> list[models.Componente]:
    components = []
    for code, name, stack in spec.components:
        result = await session.execute(
            select(models.Componente).where(models.Componente.proyecto_id == project.id, models.Componente.nombre == name)
        )
        component = result.scalar_one_or_none()
        if not component:
            component = models.Componente(id=new_id(), proyecto_id=project.id, nombre=name)
            session.add(component)
            await session.flush()
        component.descripcion = f"{SEED_MARK}: componente demo {name}."
        component.tech_stack = stack
        component.variables = {"seed": SEED_MARK, "owner": "QA Demo Team"}
        await ensure_code(session, component, models.Componente, "CMP", code)
        components.append(component)
    return components


async def upsert_environments(session, project: models.Proyecto, spec: ProjectSpec, base_time: datetime) -> list[models.Entorno]:
    environments = []
    for name, url, key in spec.environments:
        result = await session.execute(
            select(models.Entorno).where(models.Entorno.proyecto_id == project.id, models.Entorno.nombre == name)
        )
        env = result.scalar_one_or_none()
        if not env:
            env = models.Entorno(id=new_id(), proyecto_id=project.id, nombre=name, url=url)
            session.add(env)
            await session.flush()
        env.url = url
        env.status = "Online"
        env.version = "demo"
        env.variables = {"seed": SEED_MARK, "ENV_KEY": key, "BASE_URL": url}
        env.activo = True
        env.ultima_verificacion = base_time - timedelta(hours=2)
        environments.append(env)

        ds_result = await session.execute(
            select(models.EntornoDataset).where(
                models.EntornoDataset.entorno_id == env.id,
                models.EntornoDataset.nombre == "Dataset demo principal",
            )
        )
        dataset = ds_result.scalar_one_or_none()
        if not dataset:
            dataset = models.EntornoDataset(id=new_id(), entorno_id=env.id, nombre="Dataset demo principal")
            session.add(dataset)
        dataset.descripcion = f"{SEED_MARK}: datos no sensibles para demo."
        dataset.variables = {"seed": SEED_MARK, "user": "qa.demo@example.com", "account": "demo-standard"}
        dataset.activo = True
        dataset.es_default = True
    return environments


async def upsert_builds(session, project: models.Proyecto, component: models.Componente, spec: ProjectSpec, base_time: datetime) -> list[models.Build]:
    builds = []
    for name, start_offset, end_offset, active in spec.builds:
        result = await session.execute(
            select(models.Build).where(
                models.Build.proyecto_id == project.id,
                models.Build.componente_id == component.id,
                models.Build.nombre == name,
            )
        )
        build = result.scalar_one_or_none()
        if not build:
            build = models.Build(id=new_id(), proyecto_id=project.id, componente_id=component.id, nombre=name)
            session.add(build)
            await session.flush()
        build.contexto_cambio = f"{SEED_MARK}: release demo con cambios funcionales, regresion y bugs trazables."
        build.activo = active
        build.oculto = False
        build.fecha_inicio = base_time + timedelta(days=start_offset)
        build.fecha_fin = base_time + timedelta(days=end_offset)
        await ensure_code(session, build, models.Build, "BLD", f"BLD-{spec.case_prefix}-{name.upper().replace('.', '').replace('-', '')}"[:20])
        builds.append(build)
    return builds


async def upsert_suites(session, project: models.Proyecto, component: models.Componente, spec: ProjectSpec) -> list[models.Suite]:
    suites = []
    for order, (name, color, icon) in enumerate(spec.suites, start=1):
        result = await session.execute(
            select(models.Suite).where(
                models.Suite.proyecto_id == project.id,
                models.Suite.componente_id == component.id,
                models.Suite.nombre == name,
            )
        )
        suite = result.scalar_one_or_none()
        if not suite:
            suite = models.Suite(id=new_id(), proyecto_id=project.id, componente_id=component.id, nombre=name)
            session.add(suite)
            await session.flush()
        suite.descripcion = f"{SEED_MARK}: suite demo {name}."
        suite.color = color
        suite.icono = icon
        suite.orden = order
        suite.activo = True
        suite.archivado = False
        suites.append(suite)
    return suites


def playwright_script(title: str, body: str) -> str:
    return "const { test, expect } = require('@playwright/test');\n\n" + f"test('{title}', async ({{ page }}) => {{\n{body.rstrip()}\n}});\n"


def case_plan(spec: ProjectSpec) -> list[dict]:
    cases = []
    sites = [
        ("SauceDemo", "https://www.saucedemo.com/", "Swag Labs"),
        ("DemoQA", "https://demoqa.com/text-box", "Text Box"),
        ("The Internet", "https://the-internet.herokuapp.com/login", "Login Page"),
    ]
    for index in range(1, 25):
        case_code = f"TC-{index:03d}"
        suite_index = (index - 1) % len(spec.suites)
        suite_name = spec.suites[suite_index][0]
        if index in {3, 8, 13, 18, 23}:
            test_type = models.TipoPrueba.AUTOMATIZADA_AI
            mode = models.ExecutionMode.IA
            script = None
            framework = None
        elif index % 3 == 0:
            test_type = models.TipoPrueba.AUTOMATIZADA
            mode = models.ExecutionMode.AUTOMATIZADA
            site_name, url, text = sites[index % len(sites)]
            script = playwright_script(
                f"{case_code} {site_name}",
                f"  await page.goto('{url}');\n  await expect(page.getByText('{text}', {{ exact: false }}).first()).toBeVisible();",
            )
            framework = "playwright"
        else:
            test_type = models.TipoPrueba.MANUAL
            mode = models.ExecutionMode.MANUAL
            script = None
            framework = None
        cases.append({
            "code": case_code,
            "title": f"{case_code} - {suite_name} - escenario demo {index}",
            "suite": suite_name,
            "test_type": test_type,
            "mode": mode,
            "script": script,
            "framework": framework,
            "priority": models.Prioridad.ALTA if index % 5 == 0 else models.Prioridad.MEDIA,
            "criticality": models.Criticidad.CRITICA if index % 7 == 0 else models.Criticidad.MEDIA,
        })
    return cases


def case_tags(test_type: models.TipoPrueba, framework: str | None) -> list[str]:
    if test_type == models.TipoPrueba.AUTOMATIZADA_AI:
        return ["Automatizada", "IA"]
    if test_type == models.TipoPrueba.AUTOMATIZADA:
        tags = ["Automatizada"]
        if framework:
            tags.append(framework.title())
        return tags
    return []


async def replace_steps(session, case: models.CasoPrueba, index: int) -> None:
    existing_steps = (
        await session.execute(
            select(models.PasoPrueba).where(models.PasoPrueba.caso_id == case.id)
        )
    ).scalars().all()
    for step in existing_steps:
        await session.delete(step)
    await session.flush()
    steps = [
        ("Preparar datos y abrir el flujo objetivo", "El flujo carga sin errores visibles", "Dataset demo principal"),
        ("Ejecutar la accion principal del caso", "El sistema responde con el estado esperado", None),
        ("Validar trazabilidad, mensajes y evidencia", "Resultado y evidencia quedan disponibles para QA", None),
    ]
    for step_number, (action, expected, data) in enumerate(steps, start=1):
        session.add(models.PasoPrueba(
            id=new_id(),
            caso_id=case.id,
            numero_paso=step_number,
            accion=action,
            datos=data,
            resultado_esperado=expected,
            metadata_ai={"seed": SEED_MARK, "demo_step": index},
        ))


async def upsert_cases(session, project: models.Proyecto, component: models.Componente, suites: list[models.Suite], spec: ProjectSpec, admin: models.Usuario) -> list[models.CasoPrueba]:
    suite_by_name = {suite.nombre: suite for suite in suites}
    cases = []
    for index, data in enumerate(case_plan(spec), start=1):
        result = await session.execute(
            select(models.CasoPrueba).where(
                models.CasoPrueba.proyecto_id == project.id,
                models.CasoPrueba.codigo == data["code"],
            )
        )
        case = result.scalar_one_or_none()
        if not case:
            case = models.CasoPrueba(
                id=new_id(),
                master_id=new_id(),
                proyecto_id=project.id,
                codigo=data["code"],
                titulo=data["title"],
                creado_por=admin.id,
                prioridad=data["priority"],
                tipo_prueba=data["test_type"],
            )
            session.add(case)
            await session.flush()
        case.suite_id = suite_by_name[data["suite"]].id
        case.componente_id = component.id
        case.titulo = data["title"]
        case.descripcion = f"{SEED_MARK}: caso demo mixto para {project.nombre}."
        case.precondiciones = "Ambiente demo disponible y datos de prueba no sensibles."
        case.postcondiciones = "Ejecucion visible en dashboard, historial y reportes."
        case.version = 1
        case.prioridad = data["priority"]
        case.criticidad = data["criticality"]
        case.tipo_prueba = data["test_type"]
        case.estado_caso = models.EstadoCaso.ACTIVO
        case.dataset = [{"seed": SEED_MARK, "dataset": "demo"}]
        case.etiquetas = case_tags(data["test_type"], data["framework"])
        case.script_automatizado = data["script"]
        case.framework = data["framework"]
        case.activo = True
        await replace_steps(session, case, index)
        cases.append(case)
    return cases


async def assign_cases_to_builds(session, builds: list[models.Build], cases: list[models.CasoPrueba]) -> None:
    for build in builds:
        existing = set((await session.execute(select(models.BuildCaso.caso_id).where(models.BuildCaso.build_id == build.id))).scalars())
        for case in cases:
            if case.id not in existing:
                session.add(models.BuildCaso(id=new_id(), build_id=build.id, caso_id=case.id))


def result_for(build_index: int, case_index: int, active: bool) -> models.EstadoResultado:
    if active and case_index > 12:
        return models.EstadoResultado.SIN_CORRER
    if (case_index + build_index) % 11 == 0:
        return models.EstadoResultado.BLOQUEADO
    if (case_index + build_index) % 7 == 0:
        return models.EstadoResultado.FALLO
    return models.EstadoResultado.PASO


async def create_run_for_build(
    session,
    project: models.Proyecto,
    build: models.Build,
    cases: list[models.CasoPrueba],
    env: models.Entorno,
    admin: models.Usuario,
    build_index: int,
    base_time: datetime,
) -> tuple[models.TestRun, list[models.EjecucionCaso]]:
    await session.execute(delete(models.TestRun).where(
        models.TestRun.proyecto_id == project.id,
        models.TestRun.build_id == build.id,
        models.TestRun.nombre.like(f"{SEED_MARK}%"),
    ))
    run = models.TestRun(
        id=new_id(),
        proyecto_id=project.id,
        build_id=build.id,
        origen="DEMO",
        nombre=f"{SEED_MARK} - ciclo QA {build.nombre}",
        entorno=env.nombre,
        entorno_id=env.id,
        variables_resueltas={"seed": SEED_MARK, "build": build.nombre},
        datasets_resueltos={"dataset": "Dataset demo principal"},
        estado_run=models.EstadoRun.CERRADO,
        creado_por=admin.id,
        fecha_creacion=(build.fecha_inicio or base_time) + timedelta(hours=4),
        fecha_cierre=(build.fecha_inicio or base_time) + timedelta(hours=6),
    )
    session.add(run)
    await session.flush()

    executions = []
    for index, case in enumerate(cases, start=1):
        status = result_for(build_index, index, bool(build.activo))
        mode = models.ExecutionMode.AUTOMATIZADA if case.tipo_prueba == models.TipoPrueba.AUTOMATIZADA else models.ExecutionMode.IA if case.tipo_prueba == models.TipoPrueba.AUTOMATIZADA_AI else models.ExecutionMode.MANUAL
        executed_at = (run.fecha_creacion or base_time) + timedelta(minutes=index * 3)
        execution = models.EjecucionCaso(
            id=new_id(),
            test_run_id=run.id,
            caso_id=case.id,
            version_ejecutada=case.version,
            estado_resultado=status,
            execution_mode=mode,
            ejecutado_por=admin.id,
            intento_numero=1,
            duracion_segundos=0 if status == models.EstadoResultado.SIN_CORRER else 35 + index * 4,
            observaciones=f"{SEED_MARK}: resultado demo {status.value}.",
            ai_report={"seed": SEED_MARK, "summary": "Analisis IA compacto de demo"} if mode == models.ExecutionMode.IA else {},
            ai_confidence=86 if mode == models.ExecutionMode.IA and status == models.EstadoResultado.PASO else 62 if mode == models.ExecutionMode.IA else None,
            ai_consensus="stable" if mode == models.ExecutionMode.IA else None,
            ai_failure_category="validacion_visual" if status == models.EstadoResultado.FALLO else None,
            ai_human_review_required=mode == models.ExecutionMode.IA and status != models.EstadoResultado.PASO,
            ai_review_status=models.AiReviewStatus.REQUIERE_REVISION if mode == models.ExecutionMode.IA and status != models.EstadoResultado.PASO else models.AiReviewStatus.NO_REQUIERE_REVISION,
            fecha_ejecucion=executed_at,
        )
        session.add(execution)
        executions.append(execution)
        case.ultimo_resultado = status.value
        case.ultima_ejecucion_por = admin.id
        case.ultima_ejecucion_fecha = executed_at
        await session.flush()
        steps = (await session.execute(
            select(models.PasoPrueba).where(models.PasoPrueba.caso_id == case.id).order_by(models.PasoPrueba.numero_paso)
        )).scalars().all()
        for step in steps:
            step_status = status if status != models.EstadoResultado.SIN_CORRER else models.EstadoResultado.SIN_CORRER
            session.add(models.SnapshotPaso(
                id=new_id(),
                ejecucion_caso_id=execution.id,
                paso_id=step.id,
                numero_paso=step.numero_paso,
                accion_congelada=step.accion,
                datos_congelados=step.datos,
                resultado_esperado_congelado=step.resultado_esperado,
                estado_paso=step_status,
                comentarios=f"{SEED_MARK}: snapshot demo.",
                evidencia_url=None,
                error_log="Timeout controlado en demo" if status == models.EstadoResultado.FALLO else None,
            ))
        if mode == models.ExecutionMode.AUTOMATIZADA and status != models.EstadoResultado.SIN_CORRER:
            session.add(models.AutomationJob(
                id=new_id(),
                test_run_id=run.id,
                ejecucion_id=execution.id,
                caso_id=case.id,
                build_id=build.id,
                estado=models.AutomationJobStatus.PASSED if status == models.EstadoResultado.PASO else models.AutomationJobStatus.FAILED,
                payload_congelado={"seed": SEED_MARK, "case_code": case.codigo, "secrets": "[redacted]"},
                logs=f"{SEED_MARK}: ejecucion Playwright demo.",
                metadata_resultado={"duration_ms": execution.duracion_segundos * 1000},
                creado_por=admin.id,
                fecha_creacion=executed_at - timedelta(minutes=1),
                fecha_inicio=executed_at,
                fecha_fin=executed_at + timedelta(seconds=execution.duracion_segundos or 1),
            ))
    return run, executions


async def create_demo_evidence_file(project: models.Proyecto, bug_code: str) -> tuple[str, str, int, str]:
    content = f"Evidencia sintetica {SEED_MARK} para {project.nombre} - {bug_code}\n".encode("utf-8")
    digest = hashlib.sha256(content).hexdigest()
    relative = Path("attachments") / "demo_showcase" / f"{bug_code.lower()}-{digest[:8]}.txt"
    path = BACKEND_DIR / "app" / "static" / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    return str(path), f"/static/{relative.as_posix()}", len(content), digest


async def create_bugs_for_failures(session, project: models.Proyecto, build: models.Build, run: models.TestRun, executions: Iterable[models.EjecucionCaso], env: models.Entorno, admin: models.Usuario, bug_prefix: str) -> None:
    failed = [execution for execution in executions if execution.estado_resultado == models.EstadoResultado.FALLO][:3]
    for index, execution in enumerate(failed, start=1):
        case = await session.get(models.CasoPrueba, execution.caso_id)
        snapshot = (await session.execute(select(models.SnapshotPaso).where(models.SnapshotPaso.ejecucion_caso_id == execution.id).order_by(models.SnapshotPaso.numero_paso))).scalars().first()
        code = f"BUG-DEMO-{bug_prefix}-{index:03d}"
        result = await session.execute(select(models.BugIssue).where(models.BugIssue.codigo == code))
        bug = result.scalar_one_or_none()
        if not bug:
            bug = models.BugIssue(id=new_id(), codigo=code, proyecto_id=project.id, titulo=f"{case.codigo} - falla demo trazable")
            session.add(bug)
            await session.flush()
        bug.componente_id = case.componente_id
        bug.build_id = build.id
        bug.caso_id = case.id
        bug.test_run_id = run.id
        bug.ejecucion_id = execution.id
        bug.snapshot_id = snapshot.id if snapshot else None
        bug.entorno_id = env.id
        bug.numero_paso = snapshot.numero_paso if snapshot else 1
        bug.execution_mode = execution.execution_mode.value
        bug.case_code = case.codigo
        bug.build_code = build.codigo
        bug.titulo = f"{case.codigo} - falla demo trazable"
        bug.descripcion = f"{SEED_MARK}: defecto sintetico creado desde ejecucion fallida."
        bug.severidad = "ALTA" if index == 1 else "MEDIA"
        bug.prioridad = "P1" if index == 1 else "P2"
        bug.estado = "ABIERTO"
        bug.resultado_esperado = "El flujo finaliza correctamente."
        bug.resultado_obtenido = "El flujo fallo durante la validacion demo."
        bug.ambiente_nombre = env.nombre
        bug.ambiente_url = env.url
        bug.version_app = build.nombre
        bug.logs_relevantes = "Log sintetico: selector no visible / validacion funcional fallida."
        bug.criticidad = "ALTA" if index == 1 else "MEDIA"
        bug.bloquea_release = index == 1
        bug.bloquea_caso = True
        bug.creado_por = admin.id
        bug.origen = "ejecucion_demo"
        bug.dedupe_hash = hashlib.sha256(f"{SEED_MARK}:{bug.codigo}:{case.id}".encode("utf-8")).hexdigest()
        bug.metadata_json = {"seed": SEED_MARK, "project": project.nombre, "build": build.nombre}

        path, public_url, size, digest = await create_demo_evidence_file(project, bug.codigo)
        attachment_result = await session.execute(select(models.Attachment).where(models.Attachment.sha256 == digest))
        attachment = attachment_result.scalar_one_or_none()
        if not attachment:
            attachment = models.Attachment(
                id=new_id(),
                filename_original=f"{bug.codigo.lower()}-evidencia.txt",
                content_type="text/plain",
                size=size,
                sha256=digest,
                storage_path=path,
                public_url=public_url,
                scope="BUG_EVIDENCE",
                organizacion_id=project.organizacion_id,
                proyecto_id=project.id,
                created_by=admin.id,
            )
            session.add(attachment)
            await session.flush()
        link_result = await session.execute(
            select(models.BugAttachment).where(
                models.BugAttachment.bug_id == bug.id,
                models.BugAttachment.attachment_id == attachment.id,
                models.BugAttachment.tipo == "BUG_EVIDENCE",
            )
        )
        if not link_result.scalar_one_or_none():
            session.add(models.BugAttachment(id=new_id(), bug_id=bug.id, attachment_id=attachment.id, tipo="BUG_EVIDENCE"))


async def upsert_functions(session, project: models.Proyecto, component: models.Componente, admin: models.Usuario) -> None:
    functions = {
        "openPublicDemoPage": "async function openPublicDemoPage(page, url) {\n  await page.goto(url);\n  await page.waitForLoadState('domcontentloaded');\n}",
        "assertVisibleText": "async function assertVisibleText(page, text) {\n  await expect(page.getByText(text, { exact: false }).first()).toBeVisible();\n}",
    }
    for name, code in functions.items():
        result = await session.execute(
            select(models.FuncionAutomatizada).where(
                models.FuncionAutomatizada.proyecto_id == project.id,
                models.FuncionAutomatizada.componente_id == component.id,
                models.FuncionAutomatizada.nombre == name,
            )
        )
        function = result.scalar_one_or_none()
        if not function:
            function = models.FuncionAutomatizada(
                id=new_id(),
                master_id=new_id(),
                proyecto_id=project.id,
                componente_id=component.id,
                scope="COMPONENTE",
                nombre=name,
                codigo=code,
                creado_por=admin.id,
            )
            session.add(function)
        function.descripcion = f"{SEED_MARK}: funcion reutilizable demo."
        function.codigo = code
        function.parametros = ["page"]
        function.framework = "playwright"


async def seed_extension_catalog_and_instances(session, org: models.Organizacion, projects: list[models.Proyecto], admin: models.Usuario) -> None:
    for manifest in get_registered_integrations():
        provider = (await session.execute(select(models.IntegrationProvider).where(models.IntegrationProvider.provider_id == manifest["id"]))).scalar_one_or_none()
        if not provider:
            provider = models.IntegrationProvider(id=new_id(), provider_id=manifest["id"])
            session.add(provider)
        provider.kind = "integration"
        provider.display_name = manifest["display_name"]
        provider.description = manifest.get("description") or f"{manifest['display_name']} disponible en catalogo demo."
        provider.status = manifest.get("status", "planned")
        provider.capabilities = manifest.get("capabilities", [])
        provider.metadata_json = {"seed": SEED_MARK, "builtin": manifest.get("builtin", False)}

    for manifest in get_registered_plugins():
        provider = (await session.execute(select(models.PluginProvider).where(models.PluginProvider.plugin_id == manifest["id"]))).scalar_one_or_none()
        if not provider:
            provider = models.PluginProvider(id=new_id(), plugin_id=manifest["id"])
            session.add(provider)
        provider.display_name = manifest["display_name"]
        provider.description = manifest.get("description") or f"{manifest['display_name']} disponible en catalogo demo."
        provider.status = manifest.get("status", "planned")
        provider.version = "demo"
        provider.capabilities = manifest.get("capabilities", [])
        provider.manifest_json = {"seed": SEED_MARK, **manifest}

    for project in projects:
        for provider_id in ("bug_tracker", "motor_llm", "notification_email"):
            result = await session.execute(
                select(models.IntegrationInstance).where(
                    models.IntegrationInstance.provider_id == provider_id,
                    models.IntegrationInstance.proyecto_id == project.id,
                )
            )
            instance = result.scalar_one_or_none()
            if not instance:
                instance = models.IntegrationInstance(id=new_id(), provider_id=provider_id, proyecto_id=project.id, organizacion_id=org.id)
                session.add(instance)
            instance.enabled = True
            instance.config_json = {"seed": SEED_MARK, "mode": "demo", "secrets": "not-stored"}
            instance.secrets_configured = {"token": False, "password": False}
            instance.status = "active"
            instance.last_check_at = now_utc()
            instance.last_error = None
            instance.created_by = admin.id


async def seed_project(session, org: models.Organizacion, admin: models.Usuario, spec: ProjectSpec, base_time: datetime) -> models.Proyecto:
    project = await upsert_project(session, org, admin, spec)
    components = await upsert_components(session, project, spec)
    environments = await upsert_environments(session, project, spec, base_time)
    primary_component = components[0]
    builds = await upsert_builds(session, project, primary_component, spec, base_time)
    suites = await upsert_suites(session, project, primary_component, spec)
    cases = await upsert_cases(session, project, primary_component, suites, spec, admin)
    await assign_cases_to_builds(session, builds, cases)
    await upsert_functions(session, project, primary_component, admin)
    await session.flush()
    for build_index, build in enumerate(builds, start=1):
        run, executions = await create_run_for_build(session, project, build, cases, environments[0], admin, build_index, base_time)
        await create_bugs_for_failures(session, project, build, run, executions, environments[0], admin, spec.case_prefix)
    return project


async def run(reset: bool) -> None:
    async with AsyncSessionLocal() as session:
        if reset:
            await reset_demo(session)
            await session.commit()
        admin = await get_admin(session)
        org = await upsert_org(session, admin)
        base_time = now_utc()
        projects = []
        for spec in PROJECTS:
            projects.append(await seed_project(session, org, admin, spec, base_time))
        await seed_extension_catalog_and_instances(session, org, projects, admin)
        await session.commit()

    print("Seed demo showcase creado/actualizado correctamente")
    print(f"Solucion: {ORG_NAME}")
    print("Proyectos: Commerce QA Portal, Operations Mobile/API")
    print("Casos: 48")
    print("Builds: 5")
    print("Incluye ejecuciones, bugs, evidencia sintetica y complementos demo")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Carga datos demo mixtos para entorno de desarrollo.")
    parser.add_argument("--reset-demo", action="store_true", help="Elimina primero solo la solucion demo y sus datos asociados.")
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    asyncio.run(run(reset=args.reset_demo))
