# Lossless generation text

Migration 023 changes whole-value task JSON and the legacy audit payload from
`jsonb` to PostgreSQL `json`. PostgreSQL JSONB rejects `\u0000`; JSON retains the
JSON document and the existing pg/PGlite drivers parse it normally. There is no
sentinel, escape protocol, URL rewrite, or special reader. Literal `\\u0000`,
object keys, Unicode and existing normal values keep their original meaning.
`input`, `original_view`, `reference_packs`, `receipt`, `result` and
`submission_forecast` all use this path. No existing task or plugin version is
rewritten. Transactions, holds, ledger, outbox, leases and idempotency remain on
their existing paths. JSONB mutation in normal-data lifecycle test fixtures now
uses an explicit JSONB cast; production task storage never casts to JSONB.

Original submission uses CPython strip semantics: BOM remains, U+001C–001F and
U+0085 are stripped at the edges. Interior text remains untouched. Provider
adapters are factories whose existing exports keep JS trim behavior. New
versioned plugins use the Python-compatible factory, retaining the capabilities
of the latest canvas plugins: GPU 1.11.0, Muse 1.13.0, Flow 1.12.0, Images 1.12.0.
Existing catalog activation and connection version selection remain explicit;
installing these versions does not upgrade existing connections or frozen jobs.
The existing default UI and compatibility backend are unchanged.

Evidence and reproducible checks:

- `pnpm test:generation`: isolated pinned FastAPI/SQLite versus Advanced HTTP,
  including NUL, valid Unicode, literal escapes, BOM, U+001C and U+0085, frozen
  fields, audio instructions, and real Python export/history import. Dispatch
  is paused and all configured tokens are unusable fixtures.
- `pnpm test`: includes the Python whitespace set over all Unicode code points,
  rejection before 023 and roundtrip after 023, unchanged existing jobs/plugin
  manifests, full acceptance rollback, retry identity, real GPU worker claim,
  worker execution request construction and historical NUL snapshots.
- `pnpm test:canvas-runs`, `pnpm test:canvas-import`, `pnpm typecheck`.

Parent review also covered physical PostgreSQL and Redis in isolated schemas and
queue names: 206 platform tests passed with no skips, 102 generation comparisons,
119 identity comparisons, 95 canvas generation scenarios, 36 canvas import
scenarios, and 7 import plus 27 full-state checks passed. The production build
and Web/Nest/PostgreSQL integration also passed. No real provider or payment was
called.

Two findings were fixed during review. PostgreSQL JSON field extraction decodes
unrelated strings too, so a NUL in a completed provider response previously broke
state queries with error 22P05. State readers now parse the whole result in the
driver and resolve its first asset through a batched UUID lookup in the same
transaction. The executor-to-state test covers NUL in provider text and usage,
canvas runs, archived results and another workspace's state request. Pydantic
rejects lone surrogates in constrained strings before authentication/retry; its
error response also fails UTF-8 encoding and returns plain-text 500. The native
validator and response serializer now preserve that boundary, without creating
jobs or reserving credits, while valid Unicode and NUL remain unchanged.

Migration 023 covers generation text and frozen pack snapshots. Migration 024
adds an optional `documents.pack_text` JSON value for live pack names and
descriptions containing NUL. Existing packs continue to read from their
original title and body. Live edits use CPython strip semantics, and legacy
imports preserve the stored text while mapping the ordered media IDs.
Read the lossless JSON values through the driver because PostgreSQL JSONB and
text cannot represent NUL inside a string. Apply both migrations before running
the updated backend. Application migration is still in progress.
