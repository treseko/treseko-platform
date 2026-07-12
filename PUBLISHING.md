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
git commit -m "chore: publish Treseko Community 0.9.0 RC"
git remote add origin git@github.com:<owner>/treseko-platform.git
git push -u origin main
```

3. Crea el tag de release candidate:

```bash
git tag treseko-community-v0.9.0-rc.1
git push origin treseko-community-v0.9.0-rc.1
```

## Flujo recomendado

- `main`: rama publica estable o release candidate.
- `dev`: rama privada de desarrollo diario, si el repositorio se mantiene privado durante preparacion.
- Tags: `treseko-community-vX.Y.Z` para releases publicos.

## Antes de publicar

Ejecuta estas verificaciones:

```bash
rg "admin123|postgres:password|cambiar_en_entornos_reales|BEGIN .*PRIVATE KEY" .
find . -type d \( -name node_modules -o -name .venv -o -name dist -o -name logs \)
docker compose -f docker-compose.prod.yml --env-file compose.production.env config
```

Confirma que `LICENSE`, `NOTICE` y `TRADEMARKS.md` esten incluidos en el primer commit publico.
