# Alpha API Gap Analysis (code-based)

Purpose: Document exactly what exists in the repo today vs. what must land to reach an ALPHA API that a client can use without reaching into storage internals. Source-of-truth used: repomix-output.xml plus direct inspection of src/\*.

## Where We Are (implemented today)

- API Adapter (Elysia)
    - Health: `/healthz`, `/health` implemented; simple storage health pass-through. File: src/adapters/api/elysia.adapter.ts:351, 352
    - Drafts: `POST /drafts`, `GET /drafts/:note_id` implemented; rate limits enforced for drafts. File: src/adapters/api/elysia.adapter.ts:359, 388
    - Publish/Rollback: `POST /publish`, `POST /rollback` implemented; emits a VisibilityEvent via `deps.indexing.enqueueVisibilityEvent`. File: src/adapters/api/elysia.adapter.ts:401, 455
    - Search: `GET /search` implemented with collection-scope enforcement and answer/citation sanity checks. File: src/adapters/api/elysia.adapter.ts:510
    - Versions: `GET /notes/:note_id/versions`, `GET /versions/:version_id` implemented. File: src/adapters/api/elysia.adapter.ts:573, 600
    - Collections: `GET /collections`, `POST /collections`, `GET /collections/:collection_id` implemented. File: src/adapters/api/elysia.adapter.ts:612, 627, 646
    - Sessions (read-only): `GET /sessions`, `GET /sessions/:session_id` implemented. File: src/adapters/api/elysia.adapter.ts:658, 672
    - Reading: `POST /resolve-anchor` implemented using parsing adapter. File: src/adapters/api/elysia.adapter.ts:685
    - Global error mapping and rate-limit checks are wired. File: src/adapters/api/elysia.adapter.ts (mapToApiError, handleEffectError)

- Storage Adapters
    - Memory adapter: Notes CRUD, Drafts, Versions (createVersion), Publish (returns version + ETA), Rollback; Collections (create/list/get). Membership/sessions/snapshots/publications are placeholders (no-ops). File: src/adapters/storage/memory.adapter.ts:78, 160, 520
    - Postgres adapter: Notes CRUD, Draft upsert, Publish (inserts Publication and publication_collections), Rollback, Collections (create/get/list). Membership/sessions/snapshots/publications remain placeholders. File: src/adapters/storage/postgres.adapter.ts:240, 640

- Search/Indexing
    - Orama adapter (complete variant): class implements IndexingPort; `search` exists; `retrieveCandidates` and `rerankCandidates` exist (currently mocked); `indexVersion` uses chunking pipeline but isn’t called by event processing; visibility event handling simulates work and sets a status map. File: src/adapters/search/orama.adapter.ts:114, 148, 290, 340, 393, 529
    - Orama adapter (stub variant) also exists and overlaps capability; should not be used concurrently. File: src/adapters/search/orama.adapter.stub.ts
    - Visibility pipeline and operation scheduler exist but are not integrated with API wiring. Files: src/pipelines/indexing/visibility.ts, src/queue/scheduler.ts

- Parsing/Anchors
    - Markdown parsing adapter implements normalization, tokenization, structure, chunking, and anchor resolution helpers. File: src/adapters/parsing/markdown.adapter.ts

- Runtime
    - App uses `createKnowledgeApiApp` with memory or Postgres storage and the Orama adapter. File: src/runtime/main.ts

## Gaps Blocking ALPHA (exact deltas)

1. Notes CRUD is not exposed via API

- Missing endpoints: `POST /notes`, `GET /notes`, `GET /notes/:id`, `PATCH /notes/:id`, `DELETE /notes/:id`.
- Evidence: Only versions and drafts are exposed; tests create notes by calling storage directly. File: src/adapters/api/elysia.adapter.ts (no `/notes` routes); tests: src/tests/integration.api.test.ts: it creates notes via `deps.storage.createNote(...)`.
- Alpha action: Add these routes in API (delegate to `StoragePort` createNote/listNotes/getNote/updateNoteMetadata/deleteNote`).

2. Collection membership endpoints are missing

- Missing endpoints: `POST /collections/:id/notes` (add note to collection), `DELETE /collections/:id/notes/:noteId`, `GET /notes/:id/collections`.
- Evidence: StoragePort declares membership ops, memory/postgres adapters have placeholders; API has no routes. Files: src/services/storage.port.ts (addToCollections/removeFromCollections/getNoteCollections), src/adapters/storage/\* (placeholders around 520+), src/adapters/api/elysia.adapter.ts (no routes).
- Alpha action: Implement membership in memory adapter; expose the three routes. Postgres can remain TODO for ALPHA if in-memory is the target.

3. Search response shape mismatch causes `/search` to reject valid answers

- Fact: API route checks top-level `searchResponse.citations` and enforces ≥1 when `answer` exists. File: src/adapters/api/elysia.adapter.ts: search handler around 510–560
- Fact: Orama adapter returns citations only inside `answer.citations` and does not include top-level `citations`. File: src/adapters/search/orama.adapter.ts: return object in `search` (~290–330)
- Result: With any non-empty `answer`, route returns `ValidationError` (CITATION_REQUIRED).
- Alpha action: Either (a) include top-level `citations` array in adapter’s `search` return, or (b) relax API check to read citations from `answer.citations` when top-level missing (preferred for ALPHA: adapter returns both for compatibility).

4. Publish→Searchable path is not truly wired to content

- Fact: `/publish` emits a VisibilityEvent using `deps.indexing.enqueueVisibilityEvent`. File: src/adapters/api/elysia.adapter.ts: around 430–448
- Fact: Orama adapter’s `processVisibilityEvent` only marks status and simulates a delay; it does not load the Version nor call `indexVersion`. File: src/adapters/search/orama.adapter.ts:114–147
- Fact: Visibility pipeline exists with staged build/commit APIs but isn’t used by the API. File: src/pipelines/indexing/visibility.ts
- Alpha action: Minimal functional path: in `enqueueVisibilityEvent` (orama adapter) fetch the Version body via StoragePort (inject or pass through) and call `indexVersion(version, collections)`; then mark committed. Full pipeline + scheduler can be deferred.

5. Visibility pipeline & scheduler not integrated

- Evidence: OperationScheduler and VisibilityPipeline are present but nothing starts them nor routes events through them; API uses indexing adapter directly.
- Alpha action: Either wire the pipeline minimally (single in-process worker) or keep adapter self-contained for ALPHA and leave pipeline for Beta. Document clearly in code.

6. Sessions & snapshots are read-only or placeholders

- Sessions: Only `GET /sessions` and `GET /sessions/:id` exist; no `POST /sessions`, no `POST /sessions/:id/steps`, no `PATCH /sessions/:id`.
- Snapshots: No API routes; storage implementations are placeholders (return empty objects). Files: src/adapters/api/elysia.adapter.ts (no routes), src/adapters/storage/\* (placeholders ~520+)
- Alpha action: For ALPHA, defer snapshots entirely; add `POST /sessions` (create session) only if client needs one to hold SLO backoff state; steps logging can be deferred.

7. SSE `/events` not present

- Evidence: No SSE endpoint; spec requires real-time visibility cues eventually.
- Alpha action: Defer for ALPHA; rely on polling `GET /versions/:id` or an ad-hoc `GET /visibility/:version_id` wrapper around `getVisibilityEventStatus`. If easy, add a basic SSE that streams `IndexUpdateCommitted|Failed` from adapter state.

8. Rate-limit headers and idempotency store are not implemented

- Rate limits: Enforcement exists, but responses don’t include `RateLimit-*` headers. File: src/policy/rate-limits.ts; handler sets status but not headers.
- Idempotency: API accepts `client_token`, but there’s no persisted idempotency key store; repeated POSTs re-execute.
- Alpha action: Defer headers and idempotency store; keep structured error with `retry_after` for now.

9. Duplicate Orama adapters present

- Evidence: Both `orama.adapter.ts` ("complete") and `orama.adapter.stub.ts` exist. repomix-output.xml shows both. Imports use the complete variant. Files: src/adapters/search/orama.adapter.ts, src/adapters/search/orama.adapter.stub.ts
- Risk: Confusion and drift; ensure only one is compiled/used.
- Alpha action: Remove or quarantine the stub, or rename to `.bak` to avoid accidental imports.

10. Minor API/Schema mismatches to track

- `ResolveAnchorResponse`: API route returns `resolved`, `content`, `error` but not `highlighted_range`/`context` (optional in schema). OK for ALPHA. File: src/adapters/api/elysia.adapter.ts:685 ff
- `GET /notes/:id/versions`: Pagination `has_more` hardcoded false. File: src/adapters/api/elysia.adapter.ts:593–606
- `ETag`/conditional GET: not implemented. Defer for ALPHA.

## Minimal Cut (what to land for ALPHA)

1. Expose Notes CRUD

- Add routes in API: `POST /notes`, `GET /notes`, `GET /notes/:id`, `PATCH /notes/:id`, `DELETE /notes/:id` → delegate to StoragePort.
- Client unblocks: create note, list, open note, rename/tag, delete without touching storage directly.

2. Fix Search contract so `/search` succeeds

- Adapter: include top-level `citations` alongside `answer`; ensure at least one citation when `answer` present.
- Keep deterministic ordering and collection-scope filtering enforced by route.

3. Make Publish produce searchable content (single-process ALPHA)

- In Orama adapter: on `enqueueVisibilityEvent`, load Version (inject `storage` or expose a `deps.loadVersion(version_id)`), call `indexVersion(version, collections)`, then immediately mark `IndexUpdateCommitted` in state.
- Optional: Add `GET /visibility/:version_id` for client polling.

4. Implement basic Collection membership

- Memory storage: implement `addToCollections`, `removeFromCollections`, `getNoteCollections` with in-memory maps already present.
- API routes: `POST /collections/:id/notes`, `DELETE /collections/:id/notes/:noteId`, `GET /notes/:id/collections`.

5. Sessions (minimum viable)

- Add `POST /sessions` returning `{ id, started_at }` and set `X-Session-Id` echo behavior (no cookie needed for ALPHA). Steps logging can wait.

6. Tighten imports (remove stub)

- Delete or ignore `src/adapters/search/orama.adapter.stub.ts` to avoid confusion.

Optional-but-small ALPHA wins:

- Return `citations` list also at top-level in `/search` to match schema strictly.
- Add `/events` SSE that streams from adapter’s `processingEvents` Map if trivial.

## Exact Code Hotspots To Change (surgical)

- Add Notes routes beside drafts/publish
    - Implement handlers mirroring storage methods. File target: src/adapters/api/elysia.adapter.ts (insert after health routes, before drafts)

- Orama adapter: search shape + event processing
    - Add `citations` at top-level of return in `readonly search` (keep nested inside `answer` too). File: src/adapters/search/orama.adapter.ts:290–340
    - In `enqueueVisibilityEvent`/`processVisibilityEvent`, actually index content: call `indexVersion(...)` using Version loaded from storage (pass storage into adapter or refactor to have a small indexing service that has both). File: src/adapters/search/orama.adapter.ts:114–147, 659

- Membership in Memory storage
    - Fill `addToCollections`, `removeFromCollections`, `getNoteCollections`, `getCollectionNotes` using `collectionMemberships` Map. File: src/adapters/storage/memory.adapter.ts:520–920

- API membership routes
    - Add: `POST /collections/:id/notes`, `DELETE /collections/:id/notes/:noteId`, `GET /notes/:id/collections`. File: src/adapters/api/elysia.adapter.ts (near collections block around 612–746)

- Sessions route (create only)
    - Add: `POST /sessions` → `storage.createSession()`. File: src/adapters/api/elysia.adapter.ts (near 658)

- Remove stub adapter
    - Delete or rename `src/adapters/search/orama.adapter.stub.ts`.

## Verification (ALPHA readiness)

- Manual flows supported end-to-end:
    - Create note → save draft → publish → poll visibility or immediate commit → search returns answer with ≥1 citation → open citation via resolve-anchor.
    - Manage collections and membership → search scoped by selected collection(s).

- Tests to prioritize next (already sketched in repo):
    - storage.collections-membership (exists): ensure membership ops work with memory adapter. File: src/tests/storage.collections-membership.test.ts
    - error-handling.api (exists): keep current shapes valid when adding new routes. File: src/tests/error-handling.api.test.ts
    - add minimal `/search` happy-path test asserting top-level `citations` non-empty.

That’s the precise delta to reach a workable ALPHA without over-building pipeline/SSE/headers. The next phase can wire the VisibilityPipeline + OperationScheduler and SSE once the client is unblocked.
