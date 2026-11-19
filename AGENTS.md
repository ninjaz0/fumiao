# Working on Fumiao

Use the current Studio at `/studio` as the product under development. Start with the [README](README.md) and the [local Studio setup](docs/STUDIO.md).

- The default stack is Next.js / React / TypeScript, NestJS, PostgreSQL, Redis / BullMQ and private storage. The Studio protocol and the v2 API use distinct identifiers and sessions.
- Implement provider-specific execution through versioned plugins. Preserve accepted jobs' plugin, pricing and billing snapshots.
- Preserve existing UI wording, layout and interactions unless the requested change calls for a product change. The static resources listed in `baseline/production/manifest.json` have pinned hashes.
- Exercise changes against the current application using isolated databases, object stores and synthetic accounts. Use loopback fixtures for provider and payment calls.
- Run `pnpm test` and `pnpm build` for platform changes. For browser, gateway or worker changes, also run `pnpm test:studio` after the build. Verify workspace isolation, idempotent submission and settlement, and revision-checked saves when touching those contracts.
