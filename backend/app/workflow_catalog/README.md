# Catálogo oficial de workflows IA

Esta carpeta es la fuente versionada de los workflows universales incluidos
con Treseko.

- `sources/*.json` contiene definiciones editables y revisables en Git.
- `packages/*.treseko-workflow.zip` contiene los paquetes portables que acepta
  la importación de Treseko.
- `backend/scripts/build_builtin_workflow_packages.py` reconstruye los paquetes de
  forma determinista y verifica que no estén desactualizados.

Los paquetes no contienen ejecuciones, evidencias, credenciales ni perfiles de
proveedor. Una importación siempre crea un workflow `DRAFT`; la publicación y
activación son decisiones posteriores y auditables.

## Workflows incluidos

`chatbot-evaluation.v1` es el workflow distribuible para evaluar casos
`CONVERSACIONAL`. Recibe la configuración congelada del chatbot, el endpoint,
los turnos, las expectativas, la sesión y los datos permitidos por el
ambiente/dataset. Devuelve evaluación, transcripción, trazas y métricas que el
backend persiste según la política de evidencia.

El workflow no contiene credenciales, ejecuciones previas ni perfiles de
proveedor. Requiere Motor IA habilitado, un proveedor compatible y los permisos
correspondientes. No convierte un caso clásico o API en conversacional ni
certifica que todas las modalidades estén disponibles en cada instalación.

Para reconstruir los paquetes:

```bash
python backend/scripts/build_builtin_workflow_packages.py
```

La reconstrucción debe ser determinista y verificarse antes de publicar el
catálogo.
