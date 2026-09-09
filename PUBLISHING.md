# Publicación del repositorio

Esta carpeta contiene el snapshot público de Treseko Community. La versión que
se publica se toma de `VERSION`; no la escribas manualmente en los comandos ni
en los mensajes de commit.

## Preparar una publicación

1. Verificá que estés en el checkout independiente de
   `public-release/treseko-platform` y que su remoto apunte al repositorio
   público correcto. No inicialices otro repositorio dentro de esta carpeta.

```bash
cd public-release/treseko-platform
git rev-parse --show-toplevel
git remote -v
git status --short
```

2. Confirmá que el árbol público contiene solo archivos permitidos y que la
   versión coincide con `VERSION`:

```bash
cat VERSION
python3 ../../scripts/check_public_release_sync.py
python3 ../../scripts/check_self_hosted_package_readiness.py
python3 ../../scripts/check_install_script_readiness.py
python3 ../../scripts/check_public_docs_translation.py
git diff --check
```

3. Ejecutá las pruebas de instalación, actualización, rollback, composición y
   build que correspondan al snapshot. Revisá también que `LICENSE`, `NOTICE` y
   `TRADEMARKS.md` estén incluidos, que no haya secretos y que los enlaces de
   documentación apunten a archivos existentes.

## Promover el snapshot

El equipo responsable debe revisar el commit candidato, la rama de publicación
y el estado limpio antes de crear el commit. El flujo normal es:

```bash
git add -A
git commit -m "Release Treseko Community $(tr -d '\n' < VERSION)"
git push origin main
```

Después de la revisión final, creá el tag siguiendo el valor de `VERSION`:

```bash
RELEASE_VERSION="$(tr -d '\n' < VERSION)"
git tag "treseko-community-v${RELEASE_VERSION}"
git push origin "treseko-community-v${RELEASE_VERSION}"
```

Si el repositorio público usa una historia de commit raíz único, seguí el
procedimiento de sincronización definido por el repositorio fuente y obtené
aprobación explícita antes de reescribir `main` o un tag.

## Flujo recomendado

- `main`: rama pública estable.
- `dev`: rama de preparación no estable, si el repositorio público la utiliza.
- Tags: `treseko-community-vX.Y.Z`, derivados de `VERSION`.

## Notas de cambios públicas

Cada release debe resumirse con pocas líneas agrupadas únicamente en:

- **Mejoras**: cambios que mejoran flujos existentes.
- **Nueva funcionalidad**: capacidades nuevas para el usuario.
- **Correcciones**: problemas visibles resueltos.
- **Seguridad**: protección de datos, accesos e integridad.

Las notas deben describir el impacto para el usuario. No deben incluir commits,
rutas de código, tickets, nombres de servicios, detalles de infraestructura,
credenciales ni material operativo.

## Gates antes de crear un tag

Antes de promover `main` y crear un tag, la versión debe superar una prueba de
actualización desde la última versión estable y una prueba de rollback con un
fallo controlado de migración. También deben verificarse todos los componentes,
la base de datos, los health checks, el paquete final, la frontera pública y
las traducciones.

## Antes de publicar

La publicación queda bloqueada hasta que exista una traducción inglesa para
cada documento público y pase el validador desde la raíz del repositorio fuente:

```bash
python3 scripts/check_public_docs_translation.py
```

El español en `docs/*.md` es la fuente de verdad y las traducciones deben vivir
en `docs/en/` con el mismo nombre de archivo. Revisar también los enlaces,
comandos y diagramas de ambos índices.

Ejecutá estas verificaciones:

```bash
rg "admin123|postgres:password|cambiar_en_entornos_reales|BEGIN .*PRIVATE KEY" .
find . -type d \( -name node_modules -o -name .venv -o -name dist -o -name logs \)
docker compose -f docker-compose.prod.yml --env-file compose.production.env config
```

Confirmá que `LICENSE`, `NOTICE` y `TRADEMARKS.md` estén incluidos antes de
publicar el snapshot.
