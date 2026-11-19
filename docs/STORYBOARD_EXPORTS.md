# Original storyboard exports

`API_PROTOCOL=original` exposes storyboard create, list and subtitles through
`OriginalStoryboardExports`. The canvas shot-download action issues an owner-bound
ticket through the existing private archive service. The default `/studio` path
continues to use Next.js and the Python compatibility backend.

| Method | Path | Response |
| --- | --- | --- |
| GET | `/api/canvases/{pid}/exports` | Latest 20 exports in original order |
| POST | `/api/canvases/{pid}/exports` | Accepted export or replay of that owner's UID |
| GET | `/api/storyboard-exports/{key}/subtitles` | SRT attachment by default or inline VTT |
| POST | `/api/canvases/{pid}/shots/download` | ZIP filename and existing `/api/downloads/{secret}` ticket |

The ZIP follows the saved revision and shot order, including repeated source
media. Ticket redemption checks the owner, expiry and current access to every
private object. ZIP and subtitle responses send the entire body when a client
supplies Range. Individual video downloads use the existing media Range or
signed object URL behavior.

Migration 025 adds immutable execution version selection, lease fencing and
object cleanup records to the 022 history tables. Existing reference/baseline
files are unchanged. There are no changes to canvas save, removal or media
protection interfaces: the existing removal transaction deletes unfinished export
rows, cascades their references, and detaches completed history. The new worker
checks that authority before publishing. Existing media guards protect accepted
input references. Related integration points are the worker entry point and the
built-in plugin registry (completed history projection).

Acceptance locks the source document and a global admission lock, checks UID
replay before revision/readiness, then atomically inserts the frozen ordered
snapshot and media references. One active export per workspace and ten globally
are preserved. A deferred capacity trigger reserves 256 MiB while queued/running;
capacity and staging disk preflights match the original checks. No provider,
payment or generation ledger is called. Only completed local export history may
have price zero; other jobs retain the existing positive-price constraint.

PostgreSQL queued rows are the durable outbox. BullMQ is a delivery mechanism;
dispatch failure or Redis loss does not discard an accepted row. The worker
retries dispatch after a failed startup enqueue, and attempts object cleanup after
scheduling queued exports. A PostgreSQL claim lock permits one global encoder, in original chronological order, even
across worker processes. Claims have a 30 second lease renewed every five
seconds. Encoding and object upload occur outside transactions. Completion locks
the source document before the export, checks the lease token and expiry, and
atomically saves media, the original completed work record, captions and reference
release. Duplicate delivery cannot encode a completed row. A lost commit
acknowledgement is reconciled against the saved output before cleanup.

Queued work survives restart. Expired running work fails with the original restart
message and is never replayed; a user starts a new export with a new UID. This is
the original recovery semantics, not automatic retry of an interrupted encode.
Deletion invalidates unfinished work; late completion cannot resurrect it.
Completed media and captions survive source deletion and disappear with output
deletion. Cleanup records survive deletion of the export row. Migration 026 tracks
upload acknowledgements and schedules cleanup. Before sending a PUT, the worker
checks its lease under the export lock and records that the write may land.
Terminal exports that never started a PUT retire after staging cleanup. A
successful PUT acknowledgement allows an uncommitted object to retire after
successful deletion. Committed exports retire after staging cleanup and keep their
published object. Failed exports release their input references and quota before
object cleanup.

Existing markers and PUTs without an acknowledgement get repeat sweeps because
a late write can land after a successful DELETE. Those sweeps back off from 30
seconds to one hour. Cleanup errors back off from five seconds to five minutes.
Workers claim up to 16 due records in scheduled order with a one-minute claim
lease. Each item records its outcome independently, and a replacement worker can
retry claims left by a stopped worker. Staging cleanup addresses recorded random
work tokens. On multiple machines, each worker's staging filesystem must be
ephemeral or cleaned locally. Private object cleanup is shared.

The local `original-storyboard@1.0.0` composition contract is separate from the
simplified prototype `storyboard-export` plugin. It preserves first-video geometry
(1920 longest-edge cap), 24 fps frame rounding, longer-voice freeze frames,
replacement/original/silent audio, H264 veryfast/crf21/4M/8M, stereo AAC, sentence
weighted SRT/VTT and embedded mov_text. Limits remain 120 seconds per input,
300 seconds total, 256 MiB output and final duration tolerance of 0.25 seconds.
Subtitle splitting uses Python whitespace and Unicode code point lengths.

Validation uses local lavfi video/audio and isolated databases. The Python oracle
in `scripts/storyboard-export-fixtures.py` calls the pinned original functions in
a fresh temporary SQLite runtime and compares rejection order, actual encode
geometry/duration and exact subtitles. `storyboard-exports.test.ts` also exercises
permissions, UID replay, pending/changed narration, quota and disk rejection,
queue bounds, concurrent acceptance/delivery, Redis dispatch retry, expired lease,
late completion after deletion/recovery, corrupt video, failed DELETE recovery,
late PUTs with and without acknowledgement, abandoned cleanup claims, bounded
multi-worker batches, late database failure and lost commit acknowledgement. PostgreSQL/BullMQ tests
require TEST_DATABASE_URL and TEST_REDIS_URL and create random schemas/queue names.
CI installs `baseline/production/requirements.txt` and passes the configured
Python interpreter via `STUDIO_PYTHON`. Set `STUDIO_PYTHON` to an interpreter
with those dependencies for local runs. To run the real-encode case against
private S3, set `TEST_STORYBOARD_S3_BUCKET` to an isolated test bucket and set
the storage adapter's `S3_ENDPOINT`, region, addressing mode and test credentials.
The case uploads the inputs, encodes and publishes the output, checks workspace
access and unsigned/signed downloads, then deletes the test objects.

`pnpm test:canvas-rest --storyboard` compares these routes against the pinned
Python server over HTTP. Set `STUDIO_PYTHON`, `TEST_DATABASE_URL` and
`TEST_REDIS_URL` for an isolated run. The same optional S3 settings exercise
private archive reads, authorization before signing and signed Range downloads.
