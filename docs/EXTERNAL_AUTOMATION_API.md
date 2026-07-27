# API externa para reportar ejecuciones automatizadas

Este documento define el contrato Premium para que runners externos, como
Playwright, Selenium, Cypress, Pytest o pipelines CI/CD, reporten resultados al
sistema. Confirmá que la licencia incluya la API externa antes de integrarla.

El objetivo es cubrir el flujo equivalente a `reportTCResult` de TestLink, pero adaptado a la jerarquia real del sistema:

```text
solucion -> proyecto -> componente -> build -> caso -> pasos
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
Solucion:   SOL-a8f31c22
Proyecto:   PRJ-b91e02aa
Componente: CMP-77ac10ff
Build:      BLD-3f91ad44
Caso:       TC-0005
```

Usá estos criterios al configurar el runner:

- `SOL-xxxxxxxx`, `PRJ-xxxxxxxx`, `CMP-xxxxxxxx`, `BLD-xxxxxxxx`.
- El sufijo debe generarse aleatoriamente o con un identificador compacto no semantico.
- No usar nombres como `BLD-1-5-0-RC`, porque el nombre visible puede cambiar.
- Los códigos deben ser ?nicos dentro de su alcance natural.

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

## Endpoint principal

```http
POST /api/external/executions/report
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

## Campos por paso

| Campo | Requerido | Descripción |
|---|---:|---|
| `number` | Si | Numero de paso en el caso. |
| `status` | Si | Resultado del paso: `PASO`, `FALLO`, `BLOQUEADO`, `SIN_CORRER`. |
| `observations` | No | Observacion del paso. |
| `evidence_url` | No | Evidencia puntual del paso. |
| `error_log` | No | Log técnico del error. |

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

## Respuesta con errores parciales

El endpoint debe poder procesar los casos validos y rechazar los invalidos.

```json
{
  "run_id": "3d1c0d79-73af-4c8b-a3d9-5e8b7b0f2c10",
  "external_run_id": "pytest-2026-06-20-001",
  "processed": 1,
  "rejected": 1,
  "results": [
    {
      "case_code": "TC-0005",
      "status": "saved",
      "execution_id": "7d20f8bc-6fb4-40f7-8a36-8e8f56755829",
      "final_status": "FALLO"
    },
    {
      "case_code": "TC-9999",
      "status": "rejected",
      "error": "Caso no existe o no esta asignado a la build indicada."
    }
  ]
}
```

## Qué valida Treseko

Antes de guardar un reporte, Treseko valida:

1. API key valida, activa y no expirada.
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
- Si llega el mismo caso con `overwrite=false`, rechazar ese caso como duplicado dentro del mismo run.

## Estados

| Estado externo | Estado interno |
|---|---|
| `PASO` | `PASO` |
| `FALLO` | `FALLO` |
| `BLOQUEADO` | `BLOQUEADO` |
| `SIN_CORRER` | `SIN_CORRER`, solo valido en pasos si se acepta payload parcial |

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
