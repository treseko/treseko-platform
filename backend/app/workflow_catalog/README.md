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
