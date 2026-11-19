# Fumiao Advanced migration requirements

The user requires all three outcomes together:

1. Complete the agreed stack migration: Next.js / React / TypeScript, NestJS, PostgreSQL, Redis / BullMQ, private object storage.
2. Preserve a versioned, pluggable provider architecture. Muse, Flow, GPU and other model providers are plugins, not hard-coded application services.
3. Keep the original nvmes.com UI design and existing behavior identical. Do not redesign, remove features, change visible wording, alter layout or simplify interactions to make migration easier.

The authority for UI parity is `baseline/production/manifest.json`, its pinned production overrides, and the matching files in `legacy/pure/static`. Keep those reference files immutable. During frontend implementation changes, preserve the rendered DOM, CSS, assets and behavior; use contract and visual comparison before switching a page. UI redesign requires a new explicit user instruction.

The Python API is a temporary compatibility backend. Running the original application, or proxying it through Next, is an intermediate migration step, not completion of the stack migration. State this boundary accurately in progress reports and documentation. Do not mark migration complete until the normal application path runs on the target stack and original functional coverage is preserved.

Serving unchanged original JavaScript through Next is also an intermediate frontend step. Complete the React / TypeScript migration while preserving the original rendered structure and behavior; verify equivalent data, viewport and theme before replacing each page or interaction.

Do not mix the original numeric identifiers, sessions and SQLite writes with Advanced UUIDs, sessions and PostgreSQL writes without an explicit, tested compatibility design. Migrate related contracts as a unit; retain workspace isolation, task idempotency, billing and optimistic save semantics.

Preserve the user's local data and unrelated files. Development checks must use isolated runtimes/databases. Do not copy production credentials or call real providers/payments to prove compatibility unless specifically authorized.

Validation entry points:

- `python3 scripts/preview-original.py --check`: pinned original runtime.
- `python3 scripts/list-original-routes.py --check`: original route inventory.
- `pnpm test`: platform, plugin and streaming gateway tests.
- `pnpm build`: typechecks and Next production build.
- `pnpm test:studio`: real original API + Next integration with temporary data, HTML/static parity, session/CSRF, canvas, media and SSE.
- `pnpm test:studio:nest --routes`: isolated default production preview, all 120 original routes, default React and explicit pinned Studio, explicit Python session isolation, BullMQ and restart persistence. Add `--s3` to use disposable private SeaweedFS. Set `STUDIO_WEED` if needed.
- `pnpm test:studio:upgrade`: isolated complete Pure SQLite and private-media backup through the export/import CLI, replay and concurrent import, default development and production previews, old login/session replacement, ledger reconciliation, private access and restart. Requires a production build, pinned Python, PostgreSQL and Redis server binaries, and Chromium. Add `--s3` to verify the same import with private object storage.
- `pnpm test:web`: isolated Advanced API integration.
- `pnpm test:auth`: isolated Chromium auth parity (20 exact DOM/pixel states), real registration/credits/login/logout, request contracts and original-page fallback when the API is unavailable.
- `pnpm test:home`: isolated real-server Chromium differential tests against the pinned homepage; 8 viewport/theme/session states require identical UI DOM and zero pixel differences, plus interaction checks. Install Chromium with `pnpm exec playwright install chromium` first.

Run the application with Docker Compose by default. From the initialized deployment directory, run `docker compose up -d --wait` and open `http://localhost:3000/studio`. See README for first-time setup and data import. Use `pnpm dev:web` and `pnpm start:studio` only in an isolated host development environment. Explicit `STUDIO_BACKEND=python` selects the isolated compatibility backend. For an existing Pure workspace set `STUDIO_LEGACY_SOURCE` and follow the backup/import runbook before admitting writes. The alternate Advanced prototype is available only in explicitly selected `STUDIO_MODE=advanced` development mode; it is not the UI migration target.
