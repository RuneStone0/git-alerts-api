# Contributing to GitAlerts

Thanks for taking the time to contribute. This document covers how the project is actually built and reviewed: the branch model, commit conventions, how to run the stack, and the checks expected before a pull request.

GitAlerts has three components, each with its own README:

- `api/`: Django REST API ([api/README.md](api/README.md))
- `ui/`: React frontend ([ui/README.md](ui/README.md))
- `mcp-server/`: MCP server for AI clients ([mcp-server/README.md](mcp-server/README.md))

## Branch model

- `develop` is the integration branch and the target for pull requests. Branch from it, not from `main`.
- `main` is the release branch. It moves when `develop` is merged into it, so do not open pull requests against `main`.
- Name feature branches by intent, for example `feat/scan-scheduling` or `fix/pagination-400`.

```bash
git switch -c feat/your-change origin/develop
```

## Commit messages

Use conventional commits, `type(scope): summary`, matching the history of this repo:

```text
fix(api): prevent 400 Bad Request during GitHub search pagination
fix(mcp): security hardening and dependency upgrades
build(ui): upgrade dependencies and apply security fix
docs: add CONTRIBUTING.md
```

Common types are `feat` for new behaviour, `fix` for a bug, `build` for dependency or packaging changes, and `docs` for documentation; `fix` and `build` are the ones already in the history. Scopes in use are `api`, `ui` and `mcp`. Keep the summary imperative and around 72 characters or less, and put the reasoning in the body rather than the subject.

## Pull requests

- One behaviour per pull request. If you spot an unrelated bug on the way, fix it in its own PR.
- Schema changes ship their own Django migration and nothing else in that PR: the migration files under `api/<app>/migrations/` plus the model change that requires them. A model change is easier to review when the diff is not mixed with feature work.
- Update the relevant README when setup, configuration or behaviour changes, and add any new environment variable to `.env.example`.
- There is no CI on this repository, so paste the command you ran and its result in the PR description. That is how a reviewer sees what was actually exercised.

## Running the stack

Requires Docker and Docker Compose.

```bash
git clone https://github.com/YOUR_USERNAME/git-alerts-api.git
cd git-alerts-api
cp .env.example .env
docker compose up
```

Then create an admin user:

```bash
docker compose exec api python manage.py createsuperuser
```

Once everything is up:

- UI: <http://localhost:5173>
- API: <http://localhost:8000>
- API docs (Swagger UI): <http://localhost:8000/api/docs/>

The compose stack runs Postgres, Redis, the API (migrations run on start), a Celery worker and the UI dev server. The MCP server is not part of the stack, because MCP clients launch it themselves; see [mcp-server/README.md](mcp-server/README.md).

To run a single component natively instead, follow that component's README.

## Tests

The API is tested with pytest and pytest-django:

```bash
cd api
uv sync
uv run pytest
```

`api/pytest.ini` points pytest at `api.settings`, and the Django apps keep their tests in per-app packages: `api/scans/tests/`, `api/findings/tests/` and `api/core/tests/` (`api/integrations/` still uses the single `tests.py` placeholder). Those settings take the database configuration from environment variables, so the Postgres service from `docker-compose.yml` (or an equivalent database) needs to be reachable.

The UI has no test runner configured yet. Lint plus a production build are the checks:

```bash
cd ui
npm run lint
npm run build
```

## Style

**Python** is managed with [uv](https://docs.astral.sh/uv/). Dependencies live in `api/pyproject.toml` and are pinned in `api/uv.lock`. Add or change a dependency with `uv add` or `uv remove` so the lock file stays in sync, and run tooling through `uv run` rather than a hand-managed virtualenv.

**TypeScript and React** are checked by the ESLint flat config in `ui/eslint.config.js` (typescript-eslint, react-hooks, react-refresh). Run `npm run lint` in `ui/` before pushing. `npm run build` runs `tsc -b` first, so type errors fail the build.

**Tailwind** is v4 and configured through `@theme` in `ui/src/index.css`. Colours come from semantic design tokens, so use them:

```tsx
<div className="bg-card text-foreground border border-border">
  <p className="text-muted-foreground">Secondary text</p>
</div>
```

The tokens are `background`, `foreground`, `card`, `popover`, `primary`, `secondary`, `muted`, `accent`, `destructive`, `border`, `input` and `ring`, plus the matching `-foreground` pairs where one exists. Do not use raw palette classes such as `bg-gray-100` or `text-slate-600`. The light values are defined once in `:root` and the dark equivalents in `.dark`, both in `ui/src/index.css`, and the tokens resolve through them. A hardcoded grey cannot follow a theme change, so it stays grey when the `dark` class lands on `<html>`, whereas `bg-card` and `text-foreground` switch with no component changes. The base surface is already applied in `@layer base` (`body` gets `bg-background text-foreground`), so page-level components do not need to set it again.

Keep secrets out of the repository. `.env` is ignored; only `.env.example` is committed.

## Licence

GitAlerts is released under the Apache License 2.0. See [LICENSE](LICENSE).
