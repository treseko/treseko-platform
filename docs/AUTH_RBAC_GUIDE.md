# Auth/RBAC Guide

Fecha de revision: 2026-06-14.

Este documento centraliza el estado actual de autenticacion, usuarios, roles y permisos.

## Objetivo

La plataforma debe permitir:

- autenticacion local con email y contrasena,
- preparacion para Active Directory/LDAP/OIDC,
- usuarios administrables,
- roles base de sistema,
- roles personalizados creados desde la aplicación,
- permisos por módulo con nivel `read` o `edit`,
- protecciones básicas para evitar acciones peligrosas, por ejemplo auto-inactivar la propia cuenta,
- refresh de tokens para sesiones persistentes,
- logout con invalidación de tokens,
- auditoría de cambios en usuarios, roles y permisos,
- rate limiting en login para prevencion de fuerza bruta.

## Roles base

Los roles base siguen existiendo como roles técnicos del sistema.

| Rol | Uso |
|---|---|
| `ADMIN` | Acceso total y administracion global. |
| `QA_LEAD` | Gestion QA de proyectos, ejecuciones, reportes e integraciones. |
| `TESTER` | Creacion y ejecucion de pruebas. |
| `VIEWER` | Consulta sin modificacion. |

Estos roles sirven como base para permisos por defecto y validaciones internas del backend.

## Roles personalizados

Los roles personalizados se crean desde:

```text
Configuracion > Roles > + Nuevo Rol
```

Cada rol personalizado tiene:

- nombre,
- descripción,
- estado,
- permisos por módulo.

Un usuario puede tener:

- un rol base técnico,
- y opcionalmente un rol personalizado.

Si se asigna un rol personalizado, el usuario hereda los permisos de ese rol.

## Permisos por módulo

Cada módulo puede tener uno de estos niveles:

| Nivel UI | Valor backend | Significado |
|---|---|---|
| Sin acceso | sin clave en `permisos` | El módulo no aparece/no deberia poder consultarse. |
| Lector | `read` | Puede ver datos del módulo. |
| Editor | `edit` | Puede crear, editar o inactivar cuando la ruta backend tenga esa validación aplicada. |

`edit` incluye lectura.

Formato backend:

```json
{
  "reportes": "read",
  "proyectos": "edit",
  "configuracion": "edit"
}
```

## Diseno futuro: permisos agrupados por funciones

La idea para una fase final es ampliar el formulario RBAC para que no muestre solamente módulos del menu, sino dominios de seguridad con funciones agrupables. El objetivo es que un admin pueda entender y asignar permisos por capacidad real de negocio, manteniendo inicialmente el mapeo hacia los módulos actuales.

Modelo visual recomendado:

```text
Dominio
  Grupo funcional
    Funcion
      Sin acceso | Lectura | Edicion
```

Ejemplo:

```text
Ejecucion de Pruebas
  Ejecucion manual            none/read/edit
  Ejecucion automatizada      none/read/edit
  Ejecucion IA                none/read/edit
  Evidencias                  none/read/edit
  Snapshots                   none/read/edit
```

### Dominios propuestos

| Dominio | Funciones agrupables | Módulos actuales relacionados |
|---|---|---|
| Administracion Global | configuracion general, usuarios, roles, API keys, adjuntos, integraciones globales, Motor IA | `configuracion`, `clientes` |
| Clientes / Organizaciones | ver clientes, editar clientes, asignar usuarios, quitar usuarios, ver proyectos por cliente | `clientes` |
| Gestion de Proyectos | proyecto, equipo, componentes, builds, ambientes, datasets, wiki, tickets internos | `proyectos` |
| Repositorio de Pruebas | suites, casos, versiones, adjuntos de referencia, metadata, pasos | `crear_pruebas` |
| Ejecucion de Pruebas | seleccion, manual, automatizada, IA, evidencias, snapshots, programacion | `ejecutar` |
| Automatizacion | scripts, validación, funciones reutilizables, variables, workers, jobs | `automatizacion` |
| Motor IA | estado, configuracion, logs, misiones, scheduler IA | `motor_ia` |
| Reportes y Dashboard | dashboard, layout, métricas, exportacion, compartir, snapshots de reporte | `dashboard`, `reportes` |
| Historial y Trazabilidad | runs, detalle, filtros, evidencias historicas, version ejecutada | `historial` |
| Integraciones | Redmine, Git, webhooks, futuras integraciones externas | `redmine`, `configuracion` |
| Inventario | categorias, ambientes operativos, dispositivos, agentes/nodos, estado | `inventario` |

### Subdivisiones sugeridas

Estas claves no estan implementadas todavía; son una guia para cuando el RBAC pase de módulo simple a permiso granular.

```text
proyectos.config
proyectos.equipo
proyectos.componentes
proyectos.builds
proyectos.ambientes
proyectos.datasets
proyectos.wiki
proyectos.tickets

casos.suites
casos.casos
casos.versiones
casos.adjuntos
casos.metadata
casos.pasos

ejecucion.ver
ejecucion.manual
ejecucion.automatizada
ejecucion.ia
ejecucion.evidencias
ejecucion.snapshots
ejecucion.programacion

automatizacion.scripts
automatizacion.validación
automatizacion.funciones
automatizacion.variables
automatizacion.workers
automatizacion.jobs

ia.estado
ia.configuracion
ia.logs
ia.misiones
ia.scheduler

dashboard.ver
dashboard.personalizar
reportes.ver
reportes.exportar
reportes.compartir
reportes.snapshots

historial.ver
historial.detalle
historial.evidencias
historial.trazabilidad

integraciones.redmine.ver
integraciones.redmine.editar
integraciones.redmine.reportar
integraciones.git
integraciones.webhooks

inventario.categorias
inventario.ambientes
inventario.dispositivos
inventario.agentes
inventario.estado
```

### Estrategia de implementacion recomendada

1. Mantener por ahora el contrato actual:

```json
{
  "proyectos": "edit",
  "ejecutar": "read"
}
```

2. Ampliar primero el formulario para mostrar dominios y funciones, pero guardar el permiso equivalente por módulo actual.
3. Cuando el flujo principal este estable, migrar el backend a permisos granulares por funcion.

Formato futuro posible:

```json
{
  "proyectos": {
    "config": "edit",
    "componentes": "edit",
    "builds": "edit",
    "ambientes": "read",
    "wiki": "edit"
  },
  "ejecucion": {
    "manual": "edit",
    "automatizada": "read",
    "ia": "none"
  }
}
```

Esta migración debe hacerse al final, porque impacta UI, serializacion de roles, `check_module`, endpoints backend y pruebas de seguridad.

## Módulos actuales

| ID módulo | Nombre UI |
|---|---|
| `dashboard` | Dashboard |
| `ejecutar` | Ejecutar Pruebas |
| `crear_pruebas` | Anadir Pruebas |
| `proyectos` | Proyectos |
| `inventario` | Inventario |
| `reportes` | Reportes y Métricas |
| `motor_ia` | Motor IA |
| `redmine` | Integracion Redmine |
| `historial` | Historial Runs |
| `configuracion` | Configuracion |

## Modelo de datos

### `usuarios`

Campos relevantes:

- `rol`: rol base técnico.
- `rol_custom_id`: rol personalizado opcional.
- `auth_provider`: `local` o `ad`.
- `módulos`: lista derivada/compatible de módulos visibles.
- `permisos`: mapa por módulo con `read` o `edit`.
- `activo`: inactivacion logica.

### `roles_personalizados`

Campos relevantes:

- `nombre`,
- `descripcion`,
- `módulos`,
- `permisos`,
- `activo`.

## Endpoints

### Autenticacion

| Metodo | Ruta | Descripción |
|---|---|---|
| `POST` | `/auth/register/` | Registra usuario local público como `TESTER`; ignora rol, rol custom, proveedor y permisos enviados por el cliente. |
| `POST` | `/auth/login/` | Devuelve un JWT bearer único con duración configurable. Aplica rate limiting (5 intentos/15 min). |
| `POST` | `/auth/logout/` | Registra el cierre de sesión; el frontend elimina el token local. |
| `GET` | `/users/me/` | Devuelve usuario actual con rol, proveedor, módulos y permisos. |

### Usuarios

| Metodo | Ruta | Permiso | Descripción |
|---|---|---|---|
| `GET` | `/usuarios/` | `ADMIN` o `QA_LEAD` | Lista usuarios para administracion/asignaciones. |
| `POST` | `/usuarios/` | `configuracion:edit` | Crea usuario local o AD. Registra auditoría. |
| `PATCH` | `/usuarios/{usuario_id}` | `configuracion:edit` | Edita usuario. Registra auditoría. |
| `DELETE` | `/usuarios/{usuario_id}` | `configuracion:edit` | Inactiva usuario. Registra auditoría. Bloquea auto-inactivacion. |

### Roles personalizados

| Metodo | Ruta | Permiso | Descripción |
|---|---|---|---|
| `GET` | `/roles/` | `configuracion:read` | Lista roles personalizados. |
| `POST` | `/roles/` | `configuracion:edit` | Crea rol personalizado. Registra auditoría. |
| `PATCH` | `/roles/{role_id}` | `configuracion:edit` | Edita rol personalizado. Registra auditoría. |
| `DELETE` | `/roles/{role_id}` | `configuracion:edit` | Inactiva rol personalizado. Registra auditoría. |

### Auditoría

| Metodo | Ruta | Permiso | Descripción |
|---|---|---|---|
| `GET` | `/audit/logs/` | `ADMIN` | Lista registros de auditoría. Admite filtro por `usuario_id`. |

## Reglas de seguridad

- Un usuario no puede inactivar su propia cuenta.
- Inactivar no borra registros historicos.
- Ocultar un módulo en frontend no reemplaza seguridad backend.
- Las rutas sensibles deben ir migrando a validaciones con `check_module(módulo, nivel)`.
- Active Directory/OIDC esta implementado como flujo SSO opcional cuando la feature `auth.sso` esta habilitada y configurada.

## Estado actual

Implementado:

- login frontend con Local/Active Directory,
- login local real contra backend cuando esta disponible,
- `GET /users/me/`,
- usuarios con `auth_provider`, `módulos` y `permisos`,
- roles personalizados,
- permisos por módulo `read`/`edit`,
- bloqueo de auto-inactivacion,
- UI para crear roles y asignar permisos,
- token bearer único con duración configurable,
- logout con limpieza local de sesión y auditoría,
- Active Directory/OIDC con callback, exchange code corto y emisión del mismo token bearer único,
- auditoría de cambios en usuarios y roles,
- rate limiting en login (5 intentos/15 min).

Pendiente:

- aplicar `check_module` a todas las rutas sensibles (ver nota abajo),
- migraciones Alembic antes de PostgreSQL real,
- pruebas automatizadas backend para roles/permisos,
- paginación en listas de usuarios/roles,
- política de validación de contraseñas.

## Nota importante: Validación de permisos por módulo

Actualmente, solo los endpoints de usuarios, roles y configuracion tienen validación granular con `check_module`. 

**Pendiente para módulos futuros:** Al crear nuevos endpoints para proyectos, suites, casos, ejecuciones, wiki, builds, entornos, etc., se debe agregar la validación de permisos usando `check_module(módulo, nivel)`.

Ejemplo de uso:

```python
@app.get("/proyectos/", response_model=List[schemas.Proyecto])
async def read_proyectos(
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_module("proyectos", "read"))
):
    return await crud.get_proyectos(db)
```

## Pendientes documentados para fases futuras

### Paginación
- Agregar paginación en listas de usuarios, roles, auditoría y demas recursos.
- Parametros sugeridos: `skip`, `limit`, `page`, `page_size`.

### Política de contraseñas
- Validar longitud minima (8 caracteres).
- Validar complejidad (mayusculas, minusculas, numeros, especiales).
- Validar que no sea igual al email.
- Implementar reset de contrasena por administrador.

## Flujo de sesion en frontend

### Login
1. Usuario ingresa credenciales.
2. Frontend llama a `POST /auth/login/`.
3. Backend devuelve un único `access_token` JWT con `expires_in` y `session_timeout_minutes`.
4. Frontend guarda `qa_access_token` y `qa_session_expires_at` en `localStorage`.

### Duración de sesión
1. Frontend usa `fetchWithAuth()` para todas las peticiones autenticadas.
2. Si el token vence o el backend responde 401/403, se cierra la sesión local.
3. La duración se configura en `Configuracion > Inicio de sesion` y se aplica desde el próximo login.
4. La UI muestra y edita la duración en horas.

### Logout
1. Usuario hace clic en "Cerrar sesion".
2. Frontend llama a `POST /auth/logout/` con el bearer actual para registrar auditoría.
3. Frontend limpia `localStorage` y redirige al login.
4. Nota: con JWT único, un token copiado antes del logout sigue siendo válido hasta su expiración. Revocación inmediata requiere una denylist de JWT.

## Validación recomendada

1. Iniciar backend y frontend.
2. Entrar con `admin@qa.local` y la contraseña temporal impresa por `seed_admin.py` o `reset_user_password.py`.
3. Ir a `Configuracion > Roles`.
4. Crear un rol con:
   - `Reportes = Lector`,
   - `Proyectos = Editor`,
   - otros módulos en `Sin acceso`.
5. Ir a `Configuracion > Gestion Usuarios`.
6. Crear usuario local con ese rol.
7. Confirmar que hereda permisos.
8. Intentar inactivar la propia cuenta y confirmar que el sistema lo bloquea.
