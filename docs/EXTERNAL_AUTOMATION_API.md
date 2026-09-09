# API externa para reportar ejecuciones automatizadas

Este documento define el contrato Premium para que runners externos, como
Playwright, Selenium, Cypress, Pytest o pipelines CI/CD, reporten resultados al
sistema. Confirmá que la licencia incluya la API externa antes de integrarla.

El objetivo es cubrir el flujo equivalente a `reportTCResult` de TestLink, pero
adaptado a la jerarquía y los formatos disponibles en Treseko 1.0.3:

```mermaid
flowchart LR
  S[Solución] --> P[Proyecto]
  P --> C[Componente]
  C --> B[Build]
  B --> TC[Caso]
  TC --> CL[CLÁSICA: pasos]
  TC --> API[API: requests y aserciones]
  TC --> CHAT[CONVERSACIONAL: turnos y evaluación]
```

## Qué hace esta integración

- Usa identificadores cortos y estables para solución, proyecto, componente,
  build y caso.
- Permite reportar uno o varios casos asignados a una build activa.
- Acepta resultados generales y, cuando corresponde, resultados por paso.
- Conserva el resultado externo junto al historial de ejecuciones de Treseko.

## Códigos cortos

Cada entidad debe tener un código corto externo.

Ejemplos validos:

```text
Solución:   SOL-a8f31c22
Proyecto:   PRJ-b91e02aa
Componente: CMP-77ac10ff
Build:      BLD-3f91ad44
Caso:       TC-0005
```

Usá estos criterios al configurar el runner:

- `SOL-xxxxxxxx`, `PRJ-xxxxxxxx`, `CMP-xxxxxxxx`, `BLD-xxxxxxxx`.
- El sufijo debe generarse aleatoriamente o con un identificador compacto no semantico.
- No usar nombres como `BLD-1-5-0-RC`, porque el nombre visible puede cambiar.
- Los códigos deben ser únicos dentro de su alcance natural.

Alcance sugerido:

| Entidad | Campo | Unicidad |
|---|---|---|
| Solucion / organizacion | `codigo` | Global |
| Proyecto | `codigo` | Dentro de la solucion |
| Componente | `codigo` | Dentro del proyecto |
| Build | `codigo` | Dentro del componente |
| Caso | `codigo` | Dentro del proyecto o componente, segun regla final del sistema |

## API key de automatización externa

La API key se genera y administra desde la interfaz de Treseko, no mediante
endpoints de API:

1. Ingresá con el usuario que utilizará el runner.
2. Abrí **Configuración → Preferencias → API keys de automatización externa**.
3. Creá una clave identificable para el pipeline o runner.
4. Copiala en el momento de crearla y guardala como secreto de CI.

La clave hereda los permisos de ese usuario. Para reportar ejecuciones, el
usuario debe tener permiso de ejecución y acceso de edición al proyecto y a la
build. Revocá la clave desde la misma sección si deja de usarse o se expone.

Formato recomendado:

```http
Authorization: Bearer treseko_xxxxxxxxxxxxxxxxx
```

Tambien se acepta:

```http
X-QA-API-Key: treseko_xxxxxxxxxxxxxxxxx
```

La API key:

- pertenecer a un usuario activo,
- estar activa,
- heredar permisos del usuario,
- validar permiso de ejecucion,
- registrar ultimo uso,
- se guarda hasheada en base de datos.
- no reemplaza ni requiere un login por API.

El modelo actual no define una fecha de expiración automática para estas claves.
Revocá una clave manualmente cuando deje de usarse o se exponga.

## Endpoint principal

```http
POST /external/executions/report
Authorization: Bearer treseko_xxxxxxxxxxxxxxxxx
Content-Type: application/json
```

Este endpoint permite reportar uno o varios casos en una sola llamada.

## Payload

```json
{
  "solution_code": "SOL-a8f31c22",
  "project_code": "PRJ-b91e02aa",
  "component_code": "CMP-77ac10ff",
  "build_code": "BLD-3f91ad44",
  "external_run_id": "pytest-2026-06-20-001",
  "environment": "qa",
  "overwrite": true,
  "cases": [
    {
      "case_code": "TC-0005",
      "status": "FALLO",
      "observations": "El botón de login no estuvo visible.",
      "duration_seconds": 18,
      "evidence_url": "https://ci.example.com/artifacts/login-fail.png",
      "external_case_run_id": "pytest::test_login_invalid",
      "steps": [
        {
          "number": 1,
          "status": "PASO",
          "observations": "Se abrio la pagina de login."
        },
        {
          "number": 2,
          "status": "FALLO",
          "observations": "El botón de login no estuvo visible.",
          "evidence_url": "https://ci.example.com/artifacts/step-2.png"
        }
      ]
    },
    {
      "case_code": "TC-0008",
      "status": "PASO",
      "observations": "Flujo completado correctamente.",
      "duration_seconds": 9
    }
  ]
}
```

## Campos del request

| Campo | Requerido | Descripción |
|---|---:|---|
| `solution_code` | Si | Código corto de la solucion/organizacion. |
| `project_code` | Si | Código corto del proyecto. |
| `component_code` | Si | Código corto del componente. |
| `build_code` | Si | Código corto opaco de la build. |
| `external_run_id` | Recomendado | ID del run externo. Sirve para deduplicar reintentos del CI. |
| `environment` | No | Ambiente reportado por el runner externo. Ej: `qa`, `uat`, `staging`. |
| `overwrite` | No | Si `true`, permite actualizar el resultado del mismo caso dentro del mismo `external_run_id`. |
| `cases` | Si | Lista de casos a reportar. |

Límites del request: `cases` admite entre 1 y 500 elementos; los códigos de
solución, proyecto, componente, build y caso admiten hasta 80 caracteres;
`external_run_id` admite hasta 120 y `environment` hasta 80. `overwrite` es un
booleano estricto y por defecto vale `true`.

## Campos por caso

| Campo | Requerido | Descripción |
|---|---:|---|
| `case_code` | Si | Código corto del caso. Ej: `TC-0005`. |
| `status` | Si | Resultado final del caso. Valores: `PASO`, `FALLO`, `BLOQUEADO`. |
| `observations` | No | Observacion general de la ejecucion. |
| `duration_seconds` | No | Duracion total del caso. |
| `evidence_url` | No | URL de evidencia general. |
| `external_case_run_id` | No | ID del test en el framework externo. |
| `steps` | No | Lista opcional de pasos ejecutados. |

`observations` admite hasta 4000 caracteres, `duration_seconds` va de 0 a
604800, `evidence_url` admite hasta 1000 y `external_case_run_id` hasta 120.
Un caso puede incluir como máximo 250 pasos.

## Campos por paso

| Campo | Requerido | Descripción |
|---|---:|---|
| `number` | Si | Numero de paso en el caso. |
| `status` | Si | Resultado del paso: `PASO`, `FALLO`, `BLOQUEADO`, `SIN_CORRER`. |
| `observations` | No | Observacion del paso. |
| `evidence_url` | No | Evidencia puntual del paso. |
| `error_log` | No | Log técnico del error. |

`number` debe estar entre 1 y 1000. Las observaciones admiten hasta 4000
caracteres, la URL hasta 1000 y `error_log` hasta 12000.

## Evidencia API y conversacional

La forma de `cases[].api` o `cases[].chatbot` debe coincidir con el
`formato_prueba` del caso guardado. No se pueden enviar ambos campos en el
mismo caso.

Para un caso `API`, enviá `api` como un objeto JSON de evidencia observada. Se
acepta la evidencia canónica producida por Treseko, por ejemplo:

```json
{
  "schema_version": "treseko.api-result/v1",
  "status": "PASSED",
  "duration_ms": 184,
  "steps": [
    {
      "index": 1,
      "status": "PASSED",
      "request": {"method": "GET", "url": "https://api.example.test/health"},
      "response": {"status_code": 200},
      "assertions": [
        {"status": "PASSED", "source": "response.status", "expected": 200, "actual": 200}
      ]
    }
  ],
  "variables_extracted": [],
  "variables_used": {},
  "errors": [],
  "evidence_policy": {"public_test_data": false}
}
```

Treseko no usa la evidencia externa para reemplazar la configuración esperada
del caso. El objeto `api` debe pesar como máximo 512 KiB después de serializarse
como JSON; los valores sensibles se sanean antes de persistirlos.

Para un caso `CONVERSACIONAL`, enviá `chatbot` con al menos un turno:

```json
{
  "schema_version": 1,
  "protocol": "treseko.chatbot/v1",
  "conversation_strategy": "external_api",
  "session_id": "session-ci-001",
  "turns": [
    {
      "status": "PASSED",
      "request": {"body": {"message": "Hola"}},
      "response": {"text": "Hola, ¿en qué puedo ayudarte?"},
      "latencyMs": 184,
      "assertions": [{"passed": true, "rule": "must_include", "expected": "Hola"}]
    }
  ],
  "performance": {"total_latency_ms": 184},
  "conversation": [],
  "assertions": [],
  "security_findings": [],
  "memory_checks": [],
  "tools": [],
  "http_errors": [],
  "metadata": {},
  "profile": {},
  "variables": {},
  "human_evaluation": {},
  "judge": {}
}
```

Cada turno debe tener `status` `PASSED`, `FAILED` o `BLOCKED`. `turns` admite
entre 1 y 250 turnos; si se informa `technical_index`, debe ser zero-based,
entero y consecutivo. Cada turno admite hasta 256 KiB y el objeto `chatbot`
completo hasta 512 KiB. Las listas `conversation` y `assertions` admiten 500
elementos; `security_findings` 100; `memory_checks`, `tools` y `http_errors`
250. `protocol` y `conversation_strategy` admiten 80 caracteres,
`session_id` 255, `status` 30 y `error_code` 120.

El estado final del caso debe ser coherente con la evidencia: un caso `PASO`
solo puede contener pasos o turnos exitosos; un caso `FALLO` debe contener al
menos un fallo; y un caso `BLOQUEADO`, al menos un bloqueo. En un caso
conversacional no uses `steps` clásicos.

## Respuesta exitosa

```json
{
  "run_id": "3d1c0d79-73af-4c8b-a3d9-5e8b7b0f2c10",
  "external_run_id": "pytest-2026-06-20-001",
  "solution_code": "SOL-a8f31c22",
  "project_code": "PRJ-b91e02aa",
  "component_code": "CMP-77ac10ff",
  "build_code": "BLD-3f91ad44",
  "processed": 2,
  "rejected": 0,
  "results": [
    {
      "case_code": "TC-0005",
      "status": "saved",
      "execution_id": "7d20f8bc-6fb4-40f7-8a36-8e8f56755829",
      "final_status": "FALLO"
    },
    {
      "case_code": "TC-0008",
      "status": "saved",
      "execution_id": "aa78e56d-0c71-4c4f-a2fa-f087d89d26b5",
      "final_status": "PASO"
    }
  ]
}
```

## Procesamiento atómico y errores

El endpoint valida el request completo antes de guardar. No procesa una parte
del lote: si falta un caso, no está asignado a la build, la build está inactiva,
hay una evidencia incompatible con el formato o existe un duplicado con
`overwrite=false`, rechaza toda la solicitud y no guarda sus casos.

Una respuesta HTTP 200 contiene únicamente resultados `saved`, con
`rejected: 0`. Los errores de autenticación, permisos, validación o reglas de
negocio se devuelven como error HTTP (por ejemplo, 400, 401 o 403) con un
`correlation_id`; en esos casos no uses `processed` como confirmación parcial.

## Qué valida Treseko

Antes de guardar un reporte, Treseko valida:

1. API key valida y activa.
2. Usuario activo.
3. Usuario con permiso para ejecutar pruebas.
4. `solution_code` existe.
5. `project_code` pertenece a la solucion.
6. `component_code` pertenece al proyecto.
7. `build_code` pertenece al componente.
8. La build esta activa si la política exige reportar solo sobre builds activas.
9. Cada `case_code` existe.
10. Cada caso pertenece al proyecto/componente indicado.
11. Cada caso esta asignado a la build.
12. Los estados enviados son validos.
13. Si se envian pasos, los numeros existen o se puede registrar resultado general si no hay pasos definidos.

## Semantica de `external_run_id`

`external_run_id` permite deduplicar reintentos.

Recomendacion:

- Si no existe, crear un `TestRun` de origen `EXTERNAL_API`.
- Si existe para la misma build, reutilizarlo.
- Si llega el mismo caso con `overwrite=true`, actualizar la ejecucion previa de ese caso dentro del mismo run.
- Si llega el mismo caso con `overwrite=false`, rechazar toda la solicitud como duplicada; no se guarda una parte del lote.

## Estados

| Estado externo | Estado interno |
|---|---|
| `PASO` | `PASO` |
| `FALLO` | `FALLO` |
| `BLOQUEADO` | `BLOQUEADO` |
| `SIN_CORRER` | `SIN_CORRER`, válido únicamente como estado de un paso. |

No se recomienda aceptar abreviaturas tipo `p`, `f`, `b` en el contrato principal. Si se quiere compatibilidad estilo TestLink, podria agregarse un modo opcional de normalizacion.

## Ejemplo Python

```python
import os
import requests

BASE_URL = os.getenv("TRESEKO_API_URL", "http://localhost:9095/api")
API_KEY = os.getenv("TRESEKO_EXTERNAL_API_KEY", "treseko_xxxxxxxxxxxxxxxxx")

payload = {
    "solution_code": "SOL-a8f31c22",
    "project_code": "PRJ-b91e02aa",
    "component_code": "CMP-77ac10ff",
    "build_code": "BLD-3f91ad44",
    "external_run_id": "pytest-2026-06-20-001",
    "environment": "qa",
    "overwrite": True,
    "cases": [
        {
            "case_code": "TC-0005",
            "status": "FALLO",
            "observations": "El botón de login no estuvo visible.",
            "duration_seconds": 18,
            "evidence_url": "https://ci.example.com/artifacts/login-fail.png",
            "steps": [
                {
                    "number": 1,
                    "status": "PASO",
                    "observations": "Se abrio la pagina de login."
                },
                {
                    "number": 2,
                    "status": "FALLO",
                    "observations": "El botón no estuvo visible."
                }
            ]
        }
    ]
}

response = requests.post(
    f"{BASE_URL}/external/executions/report",
    headers={
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
    },
    json=payload,
    timeout=30,
)

response.raise_for_status()
data = response.json()

print("Resultado reportado")
print("Run:", data.get("run_id"))
print("Procesados:", data.get("processed"))
print("Rechazados:", data.get("rejected"))
```

## Ejemplo minimo para un solo caso

```json
{
  "solution_code": "SOL-a8f31c22",
  "project_code": "PRJ-b91e02aa",
  "component_code": "CMP-77ac10ff",
  "build_code": "BLD-3f91ad44",
  "external_run_id": "playwright-main-20260620-001",
  "cases": [
    {
      "case_code": "TC-0008",
      "status": "PASO",
      "observations": "Prueba ejecutada desde Playwright."
    }
  ]
}
```

## Checklist antes de activar el runner

1. Generá la API key desde **Configuración → Preferencias → API keys de
   automatización externa**.
2. Confirmá que el usuario de esa clave tenga permiso de ejecución y acceso al
   proyecto y la build.
3. Probá el ejemplo mínimo con un caso de prueba no crítico.
4. Configurá un `external_run_id` estable para que los reintentos sean seguros.
5. Guardá la API key únicamente en el almacén de secretos del CI.
