# Contributing

Thanks for helping improve Treseko.

By contributing to this repository, you agree that your contribution is provided under the same license as the project: AGPL-3.0-or-later.

## Development Flow

Recommended local flow:

```bash
cp .env.production.example compose.production.env
docker compose -f docker-compose.prod.yml --env-file compose.production.env up -d --build
```

Use focused branches and keep changes scoped to one feature or fix.

## Before Opening A Pull Request

Run the checks relevant to the files you changed:

```bash
npm --prefix frontend run build
npm --prefix engine run smoke
python -m py_compile backend/seed_admin.py backend/reset_user_password.py
```

For backend changes, also run the relevant tests if available in your checkout.

## Public Repo Boundary

Do not contribute private commercial infrastructure to this repository:

- license generation services;
- private update signing;
- private key material;
- customer telemetry backends;
- internal audit evidence;
- private deployment credentials.

Community/Premium gates may exist in the platform code, but the commercial authority services are intentionally separate.

## License And Trademark

- Code contributions are licensed under AGPL-3.0-or-later.
- Do not add dependencies or assets that conflict with AGPL distribution.
- Do not add brand assets unless they are intended for public use.
- The Treseko name and visual identity are governed by `TRADEMARKS.md`.

## Documentation

User-facing changes should update documentation in `docs/` when behavior, installation or operations change.
