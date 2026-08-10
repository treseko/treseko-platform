# Publicacion del repositorio

Esta carpeta esta pensada como snapshot publico de Treseko Community.
No incluye servicios comerciales privados, auditorias internas ni datos de laboratorio.

## Crear el repositorio publico

1. Crea un repositorio vacio en GitHub, por ejemplo:

```text
treseko-platform
```

2. Desde esta carpeta:

```bash
cd public-release/treseko-platform
git init -b main
git add .
git commit -m "Release Treseko Community v1.0.2"
git remote add origin git@github.com:<owner>/treseko-platform.git
git push -u origin main
```

3. Crea el tag de la versión publicada:

```bash
git tag treseko-community-v1.0.2
git push origin treseko-community-v1.0.2
```

## Flujo recomendado

- `main`: rama pública estable.
- `dev`: rama privada de desarrollo diario, si el repositorio se mantiene privado durante preparacion.
- Tags: `treseko-community-vX.Y.Z` para releases publicos.

## Antes de publicar

La publicación queda bloqueada hasta que exista una traducción inglesa para
cada documento público y pase el validador desde la raíz del repositorio fuente:

```bash
python3 scripts/check_public_docs_translation.py
```

El español en `docs/*.md` es la fuente de verdad y las traducciones deben vivir
en `docs/en/` con el mismo nombre de archivo. Revisar también los enlaces,
comandos y diagramas de ambos índices.

Ejecuta estas verificaciones:

```bash
rg "admin123|postgres:password|cambiar_en_entornos_reales|BEGIN .*PRIVATE KEY" .
find . -type d \( -name node_modules -o -name .venv -o -name dist -o -name logs \)
docker compose -f docker-compose.prod.yml --env-file compose.production.env config
```

Confirma que `LICENSE`, `NOTICE` y `TRADEMARKS.md` esten incluidos en el primer commit publico.
