# Knowledge Repository Backend V1 — Client-Facing Server Specification (Audit)

## System Overview

- Purpose: Private, local‑first knowledge repository for Markdown notes with draft‑by‑default safety, explicit publish→immutable versions, and citation‑first search. Client apps consume a deterministic, version‑anchored API with real‑time visibility of indexing.
- Scope: Single local user, single workspace. HTTP API exposes note lifecycle, collections, publishing/rollback visibility, search with extractive answers+citations, sessions, and snapshots. No cloud multi‑user or external connectors.
- Performance Targets: Search P50 ≤ 200 ms (P95 ≤ 500 ms) on 10k published corpus; Publish→Searchable P50 ≤ 5 s (P95 ≤ 10 s); Reading open+highlight P50 ≤ 200 ms (P95 ≤ 500 ms). Sustained interactive ≥ 10 QPS.

## API Contracts

### Conventions

- Base: `http://127.0.0.1:<port>` (loopback only by default).
- Headers:
    - `X-Session-Id: ses_<ulid>` (created via POST /sessions; server also sets cookie `kr_session`).
    - `Idempotency-Key: <opaque>` required for POST/PATCH/DELETE that mutate.
    - `X-Request-Id` returned on every response; echo supported.
    - Conditional: `ETag`/`If-None-Match` for version content; strong ETag = `content_hash`.
- Errors: Typed JSON body; see Errors section. HTTP codes map 4xx/5xx deterministically.
- Pagination: `page` (0‑based), `page_size` (default 10, max 100). Results include `total_count`.
- Determinism: Stable ordering in listings (created_at asc unless specified). Search ties broken by `version_id` asc then `passage_id` asc.

### Notes (CRUD)

- POST /notes
    - Body:
        ```json
        {
            "title": "My New Note",
            "initialContent": "# Title\n\nStart...",
            "metadata": { "tags": ["new", "draft"] }
        }
        ```
    - 201 Response (Note):
        ```json
        {
            "id": "note_01J...",
            "title": "My New Note",
            "metadata": { "tags": ["new", "draft"] },
            "created_at": "2025-09-23T17:00:00.000Z",
            "updated_at": "2025-09-23T17:00:00.000Z",
            "current_version_id": null
        }
        ```
- GET /notes?collection*id=col*…&page=0&page_size=10
    - 200 Response: `{ "items": Note[], "page": 0, "page_size": 10, "total_count": 42 }`
- GET /notes/:id → 200 Note
- PATCH /notes/:id (idempotent with `Idempotency-Key`)
    - Body:
        ```json
        { "title": "Updated", "metadata": { "tags": ["updated"] } }
        ```
    - 200 → updated Note
- DELETE /notes/:id → 204 (strict privacy: hides all Versions from normal flows immediately)

### Drafts

- POST /drafts (save or upsert)
    - Body:
        ```json
        { "note_id": "note_01J...", "body_md": "# Draft text", "metadata": { "tags": ["t"] } }
        ```
    - 200 Response:
        ```json
        { "note_id": "note_01J...", "autosave_ts": "2025-09-23T17:01:02.345Z" }
        ```
- GET /notes/:id/draft → 200 `{ "note_id": "note_…", "body_md": "…", "metadata": {...}, "autosave_ts": "…" }` (never enters search).

### Versions & Publication

- POST /publish
    - Behavior: Validates publication; creates NEW immutable Version; enqueues Visibility event transactionally; returns estimate to searchability. Requires `client_token` for idempotency.
    - Body:
        ```json
        {
            "note_id": "note_01J…",
            "collections": ["col_01J…"],
            "label": "major", // or "minor"
            "client_token": "pub_abc123"
        }
        ```
    - 202 Response:
        ```json
        {
            "status": "version_created",
            "version_id": "ver_01J…",
            "note_id": "note_01J…",
            "estimated_searchable_in_ms": 5000
        }
        ```
- GET /notes/:id/versions → 200 `Version[]` (latest first)
    - `Version` (DTO):
        ```ts
        type Version = {
            id: string; // ver_<ulid>
            note_id: string; // note_<ulid>
            content_hash: string; // hex
            label: "major" | "minor";
            parent_version_id?: string;
            created_at: string;
        };
        ```
- GET /versions/:id → 200 Version + content fields
    - Response:
        ```json
        {
            "id": "ver_01J…",
            "note_id": "note_01J…",
            "title": "My New Note",
            "content_md": "# Heading...",
            "metadata": { "tags": ["t"] },
            "content_hash": "a9f…",
            "created_at": "2025-09-23T…Z"
        }
        ```
    - Headers: `ETag: "a9f…"`
- POST /rollback
    - Body:
        ```json
        {
            "note_id": "note_01J…",
            "target_version_id": "ver_01H…",
            "client_token": "rollback_xyz789"
        }
        ```
    - 202 Response: `{ "new_version_id": "ver_01J…", "status": "version_created" }`

### Collections

- GET /collections → 200 `Collection[]`
- POST /collections → 201 `Collection` (optional, if client can create collections)
- GET /notes/:id/collections → 200 `Collection[]`
- POST /collections/:id/notes
    - Body: `{ "note_id": "note_01J…" }` → 204
- DELETE /collections/:id/notes/:noteId → 204

`Collection` DTO:

```ts
type Collection = { id: string; name: string; description?: string; created_at: string };
```

### Search & Answers (Citation‑First)

- GET /search
    - Query: `q`, `collections` (repeatable or comma‑sep), `page`, `page_size`
    - 200 Response:
        ```json
        {
            "answer": {
                "id": "ans_01J…",
                "text": "Quantum entanglement occurs… [cit_01J…]",
                "citations": ["cit_01J…", "cit_01K…"],
                "coverage": { "claims": 2, "cited": 2 }
            },
            "results": [
                {
                    "note_id": "note_…",
                    "version_id": "ver_…",
                    "passage_id": "pas_…",
                    "title": "Quantum Physics Fundamentals",
                    "snippet": "…entanglement occurs…",
                    "structure_path": "/quantum-physics/entanglement",
                    "score": 0.95,
                    "token_offset": 42,
                    "token_length": 15
                }
            ],
            "page": 0,
            "total_count": 15
        }
        ```
- POST /resolve-anchor
    - Body:
        ```json
        {
            "version_id": "ver_01J…",
            "anchor": {
                "structure_path": "/a/b",
                "token_offset": 42,
                "token_length": 15,
                "fingerprint": "a3f5…",
                "tokenization_version": "1.0.0",
                "fingerprint_algo": "sha256"
            }
        }
        ```
    - 200 Response:
        ```json
        {
            "resolved": true,
            "highlight": { "start_offset": 42, "end_offset": 57 },
            "content": "particles become correlated…",
            "context": { "heading_trail": ["Quantum Physics", "Entanglement"] }
        }
        ```

### Sessions

- POST /sessions → 201 `{ "id":"ses_01J…", "created_at":"…", "pinned":false }` (also sets cookie)
- POST /sessions/:id/steps → 202 `{ "status":"recorded", "step_id":"stp_…" }`
    - Body union kinds: `{ "type":"QuerySubmitted", … }`, `{ "type":"CitationResolved", … }` etc.
- PATCH /sessions/:id → 200 (e.g., `{ "pinned": true }`)

### Snapshots

- GET /snapshots → 200 `Snapshot[]`
- POST /snapshots → 202 `{ "snapshot_id":"snp_01J…", "status":"created" }`
- POST /snapshots/:id/restore → 202 `{ "status":"restore_started" }`
- DELETE /snapshots/:id → 204

## Data Models (Canonical)

```ts
// Identifiers
type NoteId = `note_${string}`;
type VersionId = `ver_${string}`;
type CollectionId = `col_${string}`;
type SessionId = `ses_${string}`;

// Note
interface Note {
    id: NoteId;
    title: string;
    metadata: { tags?: string[] };
    created_at: string;
    updated_at: string;
    current_version_id?: VersionId | null;
}

// Draft (never searchable)
interface Draft {
    note_id: NoteId;
    body_md: string;
    metadata?: Note["metadata"];
    autosave_ts: string;
}

// Version (immutable)
interface Version {
    id: VersionId;
    note_id: NoteId;
    title?: string;
    content_md: string;
    metadata?: Note["metadata"];
    content_hash: string;
    created_at: string;
    parent_version_id?: VersionId | null;
    label: "major" | "minor";
}

// Anchor (normative)
interface Anchor {
    structure_path: string;
    token_offset: number;
    token_length: number;
    fingerprint: string;
    tokenization_version: string;
    fingerprint_algo: string;
}
```

Relationships:

- Note has 0..1 Draft; 0..N Versions. Note↔Collection many‑to‑many.
- Publication creates exactly one Version; rollback creates a new Version referencing target via `parent_version_id`.
- Only Versions enter Corpus/Index. Drafts are never searchable or citable.

## State & Caching

- Sessions: Client sends `X-Session-Id` or relies on `kr_session` cookie. Server maintains per‑session counters, last scope, and SLO backoff state (`topKRerank` may drop from 64→32 when measured P95 > 500 ms within session; restore when healthy).
- Caching Layers:
    - In‑process read‑through cache for `GET /versions/:id` by `content_hash` with `ETag` validation.
    - Optional LRU for search candidate sets keyed by `(q, collections)` per session.
    - HTTP: `Cache-Control: no-store` for mutable resources; `ETag` for version content; `Vary: X-Session-Id` on search responses.
- Idempotency:
    - Require `Idempotency-Key` for POST/PATCH/DELETE (server stores key→result for 24h) and support `client_token` for publish/rollback.
- Operation Queue:
    - Per‑note FIFO for visibility actions; max in‑flight: 1 per note, 4 per workspace; aging for fairness.

## Search & Indexing Data Flow

- Publish Flow: Draft → validate → create Version → enqueue `VisibilityEvent` → index passages → staged build → atomic swap → emit `IndexUpdateCommitted` → visible in search.
- Determinism: Chunking, retrieval, rerank, and ordering are deterministic; tie‑breaks defined; no randomness.
- Indexing Strategy: Inverted index (Orama) over passages with fields: `version_id`, `passage_id`, `content`, `structure_path`, `collection_ids[]`, `token_offset`, `token_length`, `created_at`.
- Atomicity: Search only reads committed segments. No partial visibility during swap.

## Authentication, Authorization, Sessions

- Auth Model: Single local user. Default trust boundary = loopback. Two modes:
    - Browser client: HttpOnly cookie `kr_session` + CSRF protection (SameSite=Lax by default; optional `X-CSRF-Token` double‑submit for cross‑origin dev).
    - CLI/automation: Optional `Bearer <api_key>` (disabled by default). When enabled, scope = full capabilities.
- Capabilities: `publish`, `republish`, `rollback`, `delete`, `create_snapshot`, `restore_snapshot` (export disabled by default). All actions scoped to current workspace.
- Rate Limits (per session; headers `RateLimit-Limit/Remaining/Reset`):
    - Queries: burst ≤ 5 QPS; sustained ≤ 60/min → 429 with `Retry-After`.
    - Mutations: burst ≤ 1 per 5 s; sustained ≤ 12/min.

## Errors (Taxonomy, HTTP Mapping)

Error body (all errors):

```json
{
    "error": {
        "type": "ValidationError",
        "code": "TITLE_TOO_SHORT",
        "message": "Title must be 1-200 characters",
        "details": { "min": 1, "max": 200 },
        "retry_after": null
    },
    "request_id": "req_01J…",
    "timestamp": "2025-09-23T17:02:00.000Z"
}
```

Classes and primary mappings:

- ValidationError → 400; includes per‑field reasons.
- NotFound → 404 (Note, Version, Collection).
- ConflictError → 409 (another operation in progress).
- RateLimitExceeded → 429 + `Retry-After` seconds.
- VisibilityTimeout → 202 (accepted but delayed) or 504 (only for read path timeouts), SSE event emitted.
- IndexingFailure → 502/503 depending on retryability.
- StorageIO → 500; drafts still autosaved.
- SchemaVersionMismatch → 426 Upgrade Required or 409 with remediation link.

Idempotency responses:

- 409 IdempotencyConflict if same key used with a different payload hash.
- 200/201/202 Idempotent Replayed if previous result reused (`Idempotent-Replayed: true`).

## Events (SSE Contracts)

- GET /events (SSE)
    - Headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`.
    - Heartbeat: `event: heartbeat` every 15s.
    - Events:
        - `IndexUpdateCommitted`: `data: {"version_id":"ver_…","timestamp":"…"}`
        - `IndexUpdateFailed`: `data: {"version_id":"ver_…","reason":"…","timestamp":"…"}`
        - `VisibilityTimeout`: `data: {"version_id":"ver_…","elapsed_ms":12000}`
    - Example frame:

        ```
        event: IndexUpdateCommitted
        id: evt_01J…
        data: {"version_id":"ver_01J…","timestamp":"2025-09-23T17:03:00.000Z"}

        ```

## Validation Rules & Invariants (Client‑Visible)

- Draft Isolation: Drafts never appear in search or answers.
- Version Immutability: Versions are append‑only; rollback creates NEW version.
- Anchor Integrity: Every claim in `answer.text` must cite ≥ 1 resolvable anchor; unresolved anchors are never returned in committed answers (release‑blocking invariant).
- Deterministic Retrieval: Given same committed index and request, ordering is identical.
- Read Consistency: Read‑your‑writes within session; monotonic reads otherwise; freshness bound by visibility SLA (≤ 10 s P95).
- Index Health Gate: Swap occurs only if health check passes; otherwise delayed with events.

## Performance & SLAs

- Search: P50 ≤ 200 ms; P95 ≤ 500 ms (10k corpus). If session P95 exceeds 500 ms, reduce rerank window to 32 and surface status; restore when healthy.
- Publish→Searchable: P50 ≤ 5 s; P95 ≤ 10 s from POST /publish to `IndexUpdateCommitted`.
- Reading View (open+highlight): P50 ≤ 200 ms; P95 ≤ 500 ms for `POST /resolve-anchor` + content fetch.
- Throughput: Sustain ≥ 10 QPS interactive retrieval.

## Compliance, Privacy, Retention

- Privacy Posture: Local‑first; no content bodies in telemetry or events. Only structured counters/timers.
- Retention Defaults: Versions keep‑all; Sessions TTL 180 days (pinnable); Snapshots 30 days by default.
- Deletion Policy: Strict Privacy (default) hides all Versions immediately; recovery only via existing snapshots. Search visibility revocation is immediate.
- Export: Disabled by default; if enabled, never includes drafts or note bodies; anonymize IDs; redact personal paths; include schema versions.
- Content Limits: Title 1‑200 chars; tags ≤ 15, each 1‑40 chars; content ≤ 1 MB markdown.

## Security Controls

- Binding: Listen on loopback only by default; optional explicit allowlist for CORS in dev.
- CSRF: SameSite=Lax cookies; require `X-CSRF-Token` for cross‑site POST in dev; reject missing/invalid.
- Input Validation: `@effect/schema` at boundaries; reject on first error with detailed path info.
- Body Limits: `Content-Length` ≤ 2 MB; reject larger with 413.
- Headers: `Content-Security-Policy` set by client app; API sets `X-Content-Type-Options: nosniff`.
- Logging: Structured logs without content bodies; include `request_id`, timings, and error types.

## Rate Limits & Retry Semantics

- Headers: `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`, `Retry-After`.
- Client Retries:
    - Safe GETs: exponential backoff on 408/5xx.
    - Mutations: retry only with identical `Idempotency-Key`.
    - Visibility delays: subscribe to `/events` instead of polling; server may return 202 with `retry_after_ms`.

## Example DTOs & Types (Inline)

```ts
// SearchRequest
type SearchRequest = { q: string; collections?: string[]; page?: number; page_size?: number };

// SearchResultItem
type SearchResultItem = {
    note_id: string;
    version_id: string;
    passage_id: string;
    title?: string;
    snippet: string;
    structure_path: string;
    score: number;
    token_offset: number;
    token_length: number;
};

// Answer
type Answer = {
    id: string;
    text: string;
    citations: string[];
    composed_at: string;
    coverage: { claims: number; cited: number };
};

// Citation
type Citation = {
    id: string;
    answer_id: string;
    version_id: string;
    anchor: Anchor;
    snippet: string;
    confidence: number;
};
```

## What the Backend Must Provide (Prioritized Requirements)

1. Complete CRUD for Notes with validation and idempotency.
2. Draft endpoints (save/get) with strict isolation from search.
3. Publication & Rollback endpoints that are transactional with the Visibility pipeline; enqueue only on successful version creation.
4. Fully functional Indexing adapter + Visibility pipeline with staged build and atomic swap; emit `IndexUpdateCommitted/Failed/Timeout`.
5. Deterministic Search endpoint that composes extractive answers with ≥1 anchor per claim; stable dedup/ranking; session SLO backoff.
6. Collections membership management endpoints (`POST/DELETE` membership, list for note).
7. Sessions API (create, step log, patch) with per‑session counters and last scope persistence.
8. Snapshots API (create, restore, delete) with retention policy enforcement.
9. Authentication/session handling (cookie & header), CSRF for browser clients, and loopback‑only binding by default.
10. Rate limiting, idempotency store, and retry semantics with headers.
11. Error taxonomy with typed JSON responses and precise HTTP mappings.
12. ETag/conditional GET for versions; consistent `content_hash` as strong validator.
13. SSE `/events` for real‑time visibility/indexing signals with heartbeat and reconnection support.
14. Observability without content: request metrics, search P50/P95, visibility timers, unresolved anchor counters.
15. Documentation of invariants and SLAs in this spec; clients can build against these guarantees without needing internal modules.

---

This document describes required behaviors and contracts for a client‑ready V1 backend that is deterministic, idempotent, and aligned with the draft/publish, versioning, and citation guarantees of the Knowledge Repository.
