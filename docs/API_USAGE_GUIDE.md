# Documentación de APIs - QA Platform

## Base URL
```
http://localhost:8000
```

## Autenticación

### Login
```http
POST /auth/login
Content-Type: application/json

{
  "email": "admin@qa.local",
  "password": "<contraseña-temporal-o-personal>"
}
```

**Respuesta:**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "bearer"
}
```

### Usar Token
Todas las peticiones autenticadas deben incluir el header:
```
Authorization: Bearer <access_token>
```

---

## Proyectos

### Listar Proyectos
```http
GET /proyectos/
Authorization: Bearer <token>
```

**Respuesta:**
```json
[
  {
    "id": "uuid",
    "nombre": "E-Commerce Platform",
    "descripcion": "Plataforma de comercio electrónico",
    "activo": true,
    "fecha_creación": "2026-01-15T10:30:00"
  }
]
```

### Crear Proyecto
```http
POST /proyectos/
Authorization: Bearer <token>
Content-Type: application/json

{
  "nombre": "Nuevo Proyecto",
  "descripcion": "Descripción del proyecto"
}
```

### Obtener Proyecto
```http
GET /proyectos/{proyecto_id}
Authorization: Bearer <token>
```

### Actualizar Proyecto
```http
PATCH /proyectos/{proyecto_id}
Authorization: Bearer <token>
Content-Type: application/json

{
  "nombre": "Nombre Actualizado",
  "activo": false
}
```

---

## Suites

### Listar Suites de un Proyecto
```http
GET /proyectos/{proyecto_id}/suites/
Authorization: Bearer <token>
```

**Respuesta:**
```json
[
  {
    "id": "uuid",
    "nombre": "Autenticación",
    "descripcion": "Pruebas de login y registro",
    "parent_id": null,
    "proyecto_id": "uuid",
    "children": [
      {
        "id": "uuid",
        "nombre": "Login",
        "parent_id": "uuid-padre"
      }
    ]
  }
]
```

### Crear Suite
```http
POST /suites/
Authorization: Bearer <token>
Content-Type: application/json

{
  "nombre": "Nueva Suite",
  "descripcion": "Descripción",
  "proyecto_id": "uuid",
  "parent_id": "uuid-padre-opcional"
}
```

### Actualizar Suite
```http
PATCH /suites/{suite_id}
Authorization: Bearer <token>
Content-Type: application/json

{
  "nombre": "Nombre Actualizado",
  "descripcion": "Nueva descripcion"
}
```

### Eliminar Suite
```http
DELETE /suites/{suite_id}
Authorization: Bearer <token>
```

---

## Casos de Prueba

### Listar Casos de un Proyecto
```http
GET /proyectos/{proyecto_id}/casos/
Authorization: Bearer <token>
```

**Respuesta:**
```json
[
  {
    "id": "uuid",
    "master_id": "uuid",
    "codigo": "TC-001",
    "titulo": "Login exitoso",
    "descripcion": "Verificar login con credenciales válidas",
    "version": 1,
    "prioridad": "ALTA",
    "criticidad": "CRITICA",
    "tipo_prueba": "MANUAL",
    "estado_caso": "ACTIVO",
    "suite_id": "uuid",
    "componente_id": "uuid",
    "script_automatizado": null,
    "framework": null,
    "pasos": [
      {
        "id": "uuid",
        "numero_paso": 1,
        "accion": "Ingresar usuario",
        "resultado_esperado": "Campo aceptado"
      }
    ]
  }
]
```

### Crear Caso Manual
```http
POST /casos/
Authorization: Bearer <token>
Content-Type: application/json

{
  "codigo": "TC-010",
  "titulo": "Login con usuario inválido",
  "descripcion": "Verificar mensaje de error",
  "proyecto_id": "uuid",
  "suite_id": "uuid",
  "componente_id": "uuid",
  "prioridad": "ALTA",
  "criticidad": "ALTA",
  "tipo_prueba": "MANUAL",
  "creado_por": "uuid-usuario",
  "pasos": [
    {
      "numero_paso": 1,
      "accion": "Ingresar usuario inválido",
      "resultado_esperado": "Mensaje de error visible"
    }
  ]
}
```

### Crear Caso Automatizado
```http
POST /casos/
Authorization: Bearer <token>
Content-Type: application/json

{
  "codigo": "TC-020",
  "titulo": "Login automatizado",
  "descripcion": "Test automatizado con Playwright",
  "proyecto_id": "uuid",
  "suite_id": "uuid",
  "componente_id": "uuid",
  "prioridad": "ALTA",
  "criticidad": "CRITICA",
  "tipo_prueba": "AUTOMATIZADA",
  "script_automatizado": "async ({ page }) => {\n  await page.goto('{{URL_BASE}}/login');\n  await page.fill('#email', 'test@test.com');\n  await page.fill('#password', 'password123');\n  await page.click('button[type=submit]');\n  await expect(page).toHaveURL('**/dashboard');\n};",
  "framework": "playwright",
  "creado_por": "uuid-usuario",
  "pasos": [
    {
      "numero_paso": 1,
      "accion": "Navegar a login",
      "resultado_esperado": "Página de login visible"
    }
  ]
}
```

### Actualizar Caso (Nueva Versión)
```http
PUT /casos/{master_id}
Authorization: Bearer <token>
Content-Type: application/json

{
  "titulo": "Título Actualizado",
  "descripcion": "Nueva descripcion",
  "proyecto_id": "uuid",
  "suite_id": "uuid",
  "componente_id": "uuid",
  "prioridad": "MEDIA",
  "creado_por": "uuid-usuario",
  "pasos": [
    {
      "numero_paso": 1,
      "accion": "Paso actualizado",
      "resultado_esperado": "Nuevo resultado esperado"
    }
  ]
}
```

### Obtener Historial de Versiones
```http
GET /casos/{master_id}/versions
Authorization: Bearer <token>
```

---

## Builds

### Listar Builds de un Proyecto
```http
GET /proyectos/{proyecto_id}/builds/
Authorization: Bearer <token>
```

**Respuesta:**
```json
[
  {
    "id": "uuid",
    "nombre": "v1.0.0",
    "proyecto_id": "uuid",
    "componente_id": "uuid",
    "activo": true,
    "fecha_inicio": "2026-01-20T10:00:00",
    "fecha_fin": "2026-01-27T18:00:00",
    "fecha_creación": "2026-01-20T10:00:00"
  }
]
```

### Crear Build
```http
POST /builds/
Authorization: Bearer <token>
Content-Type: application/json

{
  "nombre": "v2.0.0",
  "proyecto_id": "uuid",
  "componente_id": "uuid",
  "fecha_inicio": "2026-01-20T10:00:00",
  "fecha_fin": "2026-01-27T18:00:00",
  "activo": true
}
```

`fecha_inicio` y `fecha_fin` son informativas para la ventana de evaluacion de la build. No bloquean ejecuciónes ni modifican el estado activo/inactivo.

### Activar Build
```http
PATCH /builds/{build_id}
Authorization: Bearer <token>
Content-Type: application/json

{
  "activo": true
}
```

---

## Dashboard

### Resumen configurable
```http
GET /dashboard/summary?proyecto_id={proyecto_id}&build_id={build_id}&component_id={component_id}&date_from={iso}&date_to={iso}
Authorization: Bearer <token>
```

Devuelve los datos normalizados que consumen los widgets del dashboard configurable: resumen de calidad, mis pruebas de hoy, ejecuciónes por build, ultimas ejecuciónes, ventana de evaluacion de build, tendencia por build, bugs abiertos, duracion promedio, distribucion por tipo y fallos recientes.

`build_id`, `component_id`, `date_from` y `date_to` son opcionales.

---

## Alcance de Build (Build-Casos)

### Obtener Casos Asignados a una Build
```http
GET /builds/{build_id}/casos/
Authorization: Bearer <token>
```

**Respuesta:**
```json
[
  {
    "id": "uuid-caso",
    "codigo": "TC-001",
    "titulo": "Login exitoso"
  }
]
```

### Asignar Casos a una Build
```http
PUT /builds/{build_id}/casos/
Authorization: Bearer <token>
Content-Type: application/json

{
  "caso_ids": ["uuid-1", "uuid-2", "uuid-3"]
}
```

---

## Test Runs y Ejecuciones

### Crear Test Run
```http
POST /test-runs/
Authorization: Bearer <token>
Content-Type: application/json

{
  "proyecto_id": "uuid",
  "build_id": "uuid",
  "nombre": "Smoke Test v1.0",
  "entorno": "staging",
  "creado_por": "uuid-usuario",
  "caso_ids": ["uuid-1", "uuid-2"]
}
```

**Respuesta:**
```json
{
  "id": "uuid-test-run",
  "proyecto_id": "uuid",
  "build_id": "uuid",
  "nombre": "Smoke Test v1.0",
  "entorno": "staging",
  "estado_run": "ABIERTO",
  "ejecuciónes": [
    {
      "id": "uuid-ejecución",
      "caso_id": "uuid-1",
      "estado_resultado": "SIN_CORRER"
    }
  ]
}
```

### Listar Test Runs
```http
GET /proyectos/{proyecto_id}/test-runs/
Authorization: Bearer <token>
```

### Actualizar Ejecución
```http
PATCH /ejecuciónes/{ejecución_id}
Authorization: Bearer <token>
Content-Type: application/json

{
  "estado_resultado": "PASO",
  "observaciones": "Prueba exitosa"
}
```

### Actualizar Snapshot (Paso)
```http
PATCH /snapshots/{snapshot_id}
Authorization: Bearer <token>
Content-Type: application/json

{
  "estado_paso": "PASO",
  "comentarios": "Paso completado correctamente",
  "evidencia_url": "https://..."
}
```

---

## Funciones Automatizadas

### Listar Funciones de un Proyecto
```http
GET /proyectos/{proyecto_id}/funciones/
Authorization: Bearer <token>
```

**Respuesta:**
```json
[
  {
    "id": "uuid",
    "master_id": "uuid",
    "nombre": "login",
    "descripcion": "Función de login reutilizable",
    "codigo": "async function login(page, user, pass) { ... }",
    "parametros": ["page", "user", "pass"],
    "framework": "playwright",
    "version": 1,
    "proyecto_id": "uuid",
    "suite_id": null
  }
]
```

### Crear Función
```http
POST /funciones/
Authorization: Bearer <token>
Content-Type: application/json

{
  "nombre": "login",
  "descripcion": "Función de login reutilizable",
  "codigo": "async function login(page, user, pass) {\n  await page.goto('{{URL_BASE}}/login');\n  await page.fill('#email', user);\n  await page.fill('#password', pass);\n  await page.click('button[type=submit]');\n}",
  "parametros": ["page", "user", "pass"],
  "framework": "playwright",
  "proyecto_id": "uuid",
  "suite_id": null,
  "creado_por": "uuid-usuario"
}
```

### Actualizar Función (Nueva Versión)
```http
PUT /funciones/{master_id}
Authorization: Bearer <token>
Content-Type: application/json

{
  "nombre": "login",
  "codigo": "async function login(page, user, pass) {\n  // Código actualizado\n}",
  "parametros": ["page", "user", "pass"],
  "framework": "playwright",
  "suite_id": null
}
```

### Obtener Versiones de Función
```http
GET /funciones/{master_id}/versions
Authorization: Bearer <token>
```

---

## Variables de Ejecución

### Listar Variables de un Proyecto
```http
Endpoint retirado. Usa `Proyectos > Ambientes y Datasets` y variables técnicas del componente.
Authorization: Bearer <token>
```

**Respuesta:**
```json
[
  {
    "id": "uuid",
    "nombre": "URL_BASE",
    "valor": "https://staging.example.com",
    "scope": "proyecto",
    "build_id": null,
    "proyecto_id": "uuid"
  },
  {
    "id": "uuid",
    "nombre": "URL_BASE",
    "valor": "https://v2.example.com",
    "scope": "build",
    "build_id": "uuid-build",
    "proyecto_id": "uuid"
  }
]
```

### Crear Variable
```http
Endpoint retirado. Crea datos reutilizables como datasets del ambiente.
Authorization: Bearer <token>
Content-Type: application/json

{
  "nombre": "URL_BASE",
  "valor": "https://staging.example.com",
  "scope": "proyecto",
  "proyecto_id": "uuid",
  "build_id": null,
  "creado_por": "uuid-usuario"
}
```

### Actualizar Variable
```http
Endpoint retirado. Edita el dataset o las variables técnicas del componente.
Authorization: Bearer <token>
Content-Type: application/json

{
  "valor": "https://nuevo-url.example.com"
}
```

### Resolver Variables (Prioridad Build > Proyecto > Global)
```http
Endpoint retirado. La resolucion ocurre al crear el TestRun.
Authorization: Bearer <token>
```

**Respuesta:**
```json
{
  "URL_BASE": "https://v2.example.com",
  "USUARIO_TEST": "test@example.com",
  "PASSWORD_TEST": "test123"
}
```

---

## Validación de Scripts

### Validar Sintaxis de Script
```http
POST /scripts/validate/
Authorization: Bearer <token>
Content-Type: application/json

{
  "script": "async ({ page }) => {\n  await page.goto('{{URL_BASE}}');\n  await expect(page).toHaveTitle('Login');\n};",
  "framework": "playwright"
}
```

**Respuesta (válido):**
```json
{
  "valid": true,
  "message": "Sintaxis JavaScript válida"
}
```

**Respuesta (inválido):**
```json
{
  "valid": false,
  "error": "SyntaxError: Unexpected token }"
}
```

---

## Métricas y Reportes

### Obtener Métricas de Proyecto
```http
GET /proyectos/{proyecto_id}/metrics/?build_id={build_id}
Authorization: Bearer <token>
```

**Respuesta:**
```json
{
  "build_id": "uuid",
  "build_name": "v1.0.0",
  "total_casos_asignados": 50,
  "total_ejecutados": 45,
  "cobertura_porcentaje": 90.0,
  "stats": {
    "pasados": 40,
    "fallados": 3,
    "bloqueados": 2,
    "pendientes": 5
  },
  "por_tipo_ejecución": {
    "manual": 25,
    "automatizada_ia": 20
  },
  "por_prioridad": {
    "ALTA": {
      "total": 20,
      "pasados": 18,
      "fallados": 1,
      "bloqueados": 1
    },
    "MEDIA": {
      "total": 30,
      "pasados": 22,
      "fallados": 2,
      "bloqueados": 1
    }
  },
  "historico_versions": [
    {
      "build_id": "uuid",
      "build_name": "v0.9.0",
      "pasados": 35,
      "fallados": 5,
      "bloqueados": 3,
      "fecha": "2026-01-10T10:00:00"
    },
    {
      "build_id": "uuid",
      "build_name": "v1.0.0",
      "pasados": 40,
      "fallados": 3,
      "bloqueados": 2,
      "fecha": "2026-01-20T10:00:00"
    }
  ]
}
```

---

## Códigos de Estado

| Código | Significado |
|--------|-------------|
| 200 | Éxito |
| 201 | Creado |
| 400 | Solicitud inválida |
| 401 | No autenticado |
| 403 | No autorizado |
| 404 | Recurso no encontrado |
| 409 | Conflicto (ej: codigo duplicado) |
| 500 | Error interno del servidor |

---

## Tipos de Prueba

| Tipo | Descripción |
|------|-------------|
| `MANUAL` | Prueba manual con pasos definidos |
| `AUTOMATIZADA` | Prueba con script automatizado (Playwright/Selenium/Cypress/Puppeteer) |
| `AUTOMATIZADA_AI` | Prueba ejecutada por IA (motor NLP) |

---

## Estados de Ejecución

| Estado | Descripción |
|--------|-------------|
| `SIN_CORRER` | No ejecutada aún |
| `EJECUTANDO_AI` | En ejecución por IA |
| `PASO` | Prueba exitosa |
| `FALLO` | Prueba fallida |
| `BLOQUEADO` | No se pudo ejecutar |

---

## Frameworks Soportados

| Framework | Lenguaje | Uso |
|-----------|----------|-----|
| `playwright` | JavaScript/TypeScript | Automatización web moderna |
| `selenium` | Python | Automatización web tradicional |
| `cypress` | JavaScript | Testing E2E frontend |
| `puppeteer` | JavaScript | Control headless de Chrome |

---

## Datos en Scripts

Usa `{{NOMBRE_VARIABLE}}` en tus scripts para inyectar datos resueltos del ambiente, componente, dataset o caso:

```javascript
async ({ page }) => {
  await page.goto('{{URL_BASE}}/login');
  await page.fill('#email', '{{USUARIO_TEST}}');
  await page.fill('#password', '{{PASSWORD_TEST}}');
  await page.click('button[type=submit]');
};
```

Los datos se resuelven en este orden:
1. Variables base del ambiente.
2. Variables técnicas del componente.
3. Dataset seleccionado del ambiente.
4. Datos específicos del caso.
5. Overrides de build si existen para esa entrega.

---

## Ejemplos Completos

### Flujo Completo: Crear y Ejecutar Prueba Automatizada

1. **Configurar datos de ejecución:**
   - Crear ambiente QA con `base_url`.
   - Crear dataset con `usuario`, `password`, `tenant`.
   - Agregar variables técnicas del componente si el script usa endpoints o rutas compartidas.

2. **Crear función reutilizable:**
```http
POST /funciones/
{
  "nombre": "login",
  "codigo": "async function login(page, user, pass) {\n  await page.goto('{{URL_BASE}}/login');\n  await page.fill('#email', user);\n  await page.fill('#password', pass);\n  await page.click('button[type=submit]');\n}",
  "parametros": ["page", "user", "pass"],
  "framework": "playwright",
  "proyecto_id": "uuid-proyecto",
  "creado_por": "uuid-usuario"
}
```

3. **Crear caso automatizado:**
```http
POST /casos/
{
  "codigo": "TC-100",
  "titulo": "Login y navegación al dashboard",
  "tipo_prueba": "AUTOMATIZADA",
  "script_automatizado": "async ({ page }) => {\n  await login(page, '{{USUARIO_TEST}}', '{{PASSWORD_TEST}}');\n  await expect(page).toHaveURL('**/dashboard');\n  await expect(page.locator('h1')).toContainText('Bienvenido');\n};",
  "framework": "playwright",
  "proyecto_id": "uuid-proyecto",
  "suite_id": "uuid-suite",
  "creado_por": "uuid-usuario",
  "pasos": [
    {
      "numero_paso": 1,
      "accion": "Login con credenciales válidas",
      "resultado_esperado": "Redirige a dashboard"
    }
  ]
}
```

4. **Asignar caso a build:**
```http
PUT /builds/{build_id}/casos/
{
  "caso_ids": ["uuid-caso"]
}
```

5. **Crear test run:**
```http
POST /test-runs/
{
  "proyecto_id": "uuid-proyecto",
  "build_id": "uuid-build",
  "nombre": "Smoke Test",
  "entorno": "staging",
  "creado_por": "uuid-usuario",
  "caso_ids": ["uuid-caso"]
}
```

6. **Ver métricas:**
```http
GET /proyectos/{proyecto_id}/metrics/?build_id={build_id}
```

---

## Notas Importantes

1. **Versionado de Casos**: Cada actualización de un caso crea una nueva versión. El `master_id` permanece igual, pero `version` incrementa.

2. **Alcance de Build**: Solo los casos asignados a una build pueden ejecutarse en esa build.

3. **Variables Jerárquicas**: Las variables de build sobrescriben las de proyecto, que a su vez sobrescriben las globales.

4. **Funciones Reutilizables**: Las funciones se heredan de proyecto a suite. Si defines `login()` a nivel proyecto, todas las suites pueden usarla.

5. **Validación de Scripts**: Siempre valida tus scripts con `/scripts/validate/` antes de guardarlos.

---

## Soporte

Para más información, consulta:
- [DATABASE.md](./DATABASE.md) - Modelo de datos

El roadmap del producto se publica por canal oficial de release. El backlog
interno del repositorio fuente no forma parte del paquete self-hosted.
