# Design Specification: Low-Level

## 1. System Overview

- **Scope**: Private, local-first knowledge repository for Markdown notes with draft-by-default authoring, explicit publish/republish to a versioned searchable corpus, citation-first answers, version history/rollback, scoped search, reading view with passage highlights, session history, and local snapshots.

- **Primary Objectives**:
    - **Search**: P50 ≤ 200 ms; P95 ≤ 500 ms on a 10k published-note corpus; ≥ 10 QPS sustained interactive.
    - **Publish→Searchable**: P50 ≤ 5 s; P95 ≤ 10 s from action to committed corpus visibility.
    - **Strict draft/publish isolation**: zero draft bleed-through in search/answers.
    - **Answers**: every claim cites ≥ 1 Version-backed passage; return no-answer if evidence insufficient or any citation is unresolved.
    - **Version history**: preserved for 100% of published notes (subject to deletion policy).

- **Out of Scope**: Non-Markdown content; multi-user/cloud sync; external connectors/plugins; web crawling/model training.

## 2. Canonical Ontology & Naming

- **Entities (canonical)**: Workspace, Collection, Note, Draft, Version, Publication, Corpus, Index, Query, Answer, Passage, Citation, Highlight, Session, Snapshot.

- **Views (non-canonical)**: ProjectTree (derived view over Notes/Collections; no identifiers of its own).

- **Relationships (conceptual)**:
    - Workspace contains Collections, Notes, Versions, Sessions, Snapshots, Corpus/Index.
    - Note has 0..1 Draft; 0..N Versions; Note ↔ Collection is many-to-many.
    - Publication creates exactly one Version; one Version may be current for a Note.
    - Query over 1..N Collections yields one Answer with 1..N Citations to Passages in a Version.
    - Session records ordered Queries, Answers, and openings anchored to Version IDs.

- **Identifiers (opaque unless noted)**: `note_<ulid>`, `col_<ulid>`, `ver_<ulid>` (with separate `content_hash`), `ses_<ulid>`, `cit_<ulid>`, `snp_<ulid>`.

- **Invariants (testable)**:
    - Drafts are never searchable or citable; only Versions enter Corpus/Index.
    - Each publication emits a new immutable Version (even if content unchanged).
    - Rollback never mutates prior Versions; activation creates a new Version referencing its source.
    - Rename/move never breaks anchors; anchors bind to structure_path, not file paths.
    - Index health: all published Versions appear in the committed Index; no partial visibility after swap.
    - Cross-collection dedup: results deduplicate by (Note, Version); keep highest-ranked passage.

- **Version labels (semantics)**: `minor` = editorial changes; `major` = structural or scope changes. History displays labels; search treats both equally but, when deduplicating multiple Versions of the same Note, prefer the latest `major`, else latest by published_at.

- **Anchor model (canonical)**: `{ structure_path, token_offset:int, token_length:int, fingerprint }`; normalization: normalized headings/paragraphs, stable tokenizer and token units, whitespace/line-ending normalization; structure_path uses stable heading identifiers. Drift: fingerprint mismatch → attempt re-anchoring via structure_path then nearest token_offset; if unresolved, mark citation unresolved and do not use in answers.

- **Tokenization Standard (Normative)**:
    - **Normalization**: Unicode NFC; line endings → LF; collapse runs of whitespace to a single space outside inline/fenced code. Do not alter text inside code spans/blocks.
    - **Parsing scope**: tokenize the rendered text of Markdown text nodes (syntax markers excluded); `structure_path` derives from the heading trail of a CommonMark-conformant tree.
    - **Token unit**: Unicode word boundaries per UAX #29; treat internal apostrophes and hyphens between letters/digits as part of the token; numbers with decimals/commas are single tokens; for CJK scripts, prefer dictionary segmentation when available; otherwise fall back to codepoint segmentation.
    - **Offsets**: `token_offset` is a 0-based index into the token sequence of the target block; `token_length` is the count of tokens; both measured after normalization.
    - **Fingerprint**: deterministic, collision-resistant hash over the normalized text within `[token_offset, token_offset + token_length)`; algorithm is implementation-defined but must remain stable across releases.
    - **Metadata**: store `tokenization_version` and `fingerprint_algo` with each anchor to support future migrations.
    - **Case policy**: anchors are case-preserving; searches may be case-insensitive. Case normalization must not alter anchor offsets or fingerprints.
    - **Separators**: treat `_` and `/` as token separators unless inside code spans/blocks.
    - **Determinism**: given identical normalized content and structure_path, anchors resolve identically across machines and releases.

## 3. Logical Data Model

- **Conceptual Schemas (key attributes only)**:
    - **Note**: `{ id, title, metadata:{tags[]?}, created_at, updated_at, current_version_id? }`
    - **Draft**: `{ note_id, body_md, metadata, autosave_ts }`
    - **Version**: `{ id, note_id, content_md, metadata, content_hash, created_at, parent_version_id?, label: minor|major }`
    - **Collection**: `{ id, name (unique per workspace), description?, created_at }`; membership bridge `{ note_id, collection_id }`.
    - **Publication**: `{ id, note_id, version_id, collections[], published_at, label? }`
    - **Passage**: `{ id, version_id, structure_path, token_span:{offset,length}, snippet }`
    - **Citation**: `{ id, answer_id, version_id, anchor:{structure_path, token_offset, token_length, fingerprint, tokenization_version, fingerprint_algo}, snippet, confidence? }`
    - **Answer**: `{ id, query_id, text, citations[ citation_id ], composed_at, coverage:{claims:int, cited:int} }`
    - **Query**: `{ id, text, scope:{collection_ids[], filters?}, submitted_at }`
    - **Session**: `{ id, started_at, steps:[ {type:query|open_citation, ref_ids...} ], ended_at?, pinned?:bool }`
    - **Corpus**: `{ id, version_ids[], state:Fresh|Updating|Committed, created_at }`
    - **Index**: `{ id, corpus_id, state:Building|Ready|Swapping, built_at }`
    - **Snapshot**: `{ id, created_at, scope, note }` (workspace-local container).

- **Passage chunking policy (indexing)**: max 180 tokens per passage; 50% overlap (stride 90 tokens); max note size indexed = 20k tokens (excess truncated or paginated into additional chunks); retain structure_path boundaries where possible.

- **Publication validation policy (required metadata)**: title required (1..200 chars); ≥ 1 target collection required; tags optional (max 15; each 1..40 chars).

- **Keys & Uniqueness**: entity IDs; `Collection.name` unique within a Workspace.

- **Read/Write/Query Patterns**:
    - **Writes**: Draft autosaves; Publish writes Version then enqueues visibility; Rollback writes new Version.
    - **Reads**: Search retrieves passages from Index; Reading resolves anchors on Version; Session replay dereferences Version IDs.
    - **Queries**: scoped by explicit Collection IDs first, then filters (tags/date). Deduplicate by (Note, Version) and prefer highest-ranked passage.

## 4. External Interfaces & Contracts

- **Editor ↔ Store**
    - **Purpose**: create/edit Drafts; Publish/Republish; Rollback; manage Collections.
    - **Requests (conceptual)**: `SaveDraft{note_id, body_md, metadata}`, `Publish{note_id, collections[], label?, validation_policy:default}`, `Rollback{note_id, target_version_id}`.
    - **Responses**: `DraftSaved{note_id, autosave_ts}`, `VersionCreated{version_id, note_id}`, `RollbackApplied{new_version_id}`.
    - **Preconditions**: workspace open; note exists; publish validation passes (title length, collection exists, tags within limits).
    - **Postconditions**: Version persisted; VisibilityEvent enqueued; rollback creates new Version referencing target.
    - **Idempotency**: `SaveDraft` last-write-wins; `Publish`/`Rollback` idempotent by client token.

- **Store ↔ Indexer**
    - **Purpose**: transform Version changes into Corpus/Index updates and commit visibility.
    - **Inputs**: `VisibilityEvent{version_id, op:publish|republish|rollback, collections[], content_hash}`.
    - **Outputs**: `IndexUpdateStarted{version_id}`, `IndexUpdateCommitted{version_id}`, `IndexUpdateFailed{version_id, reason}`.
    - **Ordering**: per-note ordering preserved; cross-note updates may be concurrent.
    - **Idempotency**: events deduplicated by `(version_id, op)`; safe retries.
    - **Index health checks**: `CommittedIndexMustContain(version_id)` at commit; swap only after complete readiness.

- **Search ↔ Reader**
    - **Purpose**: map `Query{text, scope, filters}` → `Answer{text, citations[], ranked_items}`.
    - **Contracts**: fully extractive answers; if any needed citation is unresolved, return `no_answer` with nearest passages.
    - **Pagination** on ranked list; deterministic dedup by (Note, Version).

- **SessionReplay**
    - **Purpose**: reload prior answers and cited passages tied to Version IDs.
    - **Inputs**: `LoadSession{session_id}`; `OpenStep{session_id, step_id}`.
    - **Outputs**: reconstructed Answer and citations; errors for missing Versions with nearest-available suggestion.

- **Snapshot / Export (posture)**
    - **Snapshot**: `CreateSnapshot{scope}`, `ListSnapshots{}`, `RestoreSnapshot{snapshot_id}`.
    - **Export (disabled by default)**: if enabled, exports exclude `draft_content`, `note_body`, and personal path identifiers; IDs may be pseudonymized; citations may include snippets only with explicit consent; a manifest lists included entities and schema versions.

## 5. Behavior & State Flows

- **Publish/Republish (two-phase)**: Validate (title/collections/tags) → Create Version → Enqueue VisibilityEvent → UI shows Version committed → Indexer builds/updates segment → Commit swap → Search reflects within SLA.
    - **Failure**: if indexing fails, Version remains committed but not searchable; present retry control.

- **Rollback**: `target_version_id` → Create Version referencing source → Enqueue visibility → Commit.

- **Search & Answer Composition**: accept query+scope → retrieve/top-k passages → rank/select → compose fully extractive answer → attach citations → present ranked list; if evidence insufficient or any citation unresolved, return `no_answer` with nearest passages.

- **Retrieval Defaults (Deterministic)**:
    - **Candidate retrieval**: `top_k_retrieve = 128` passages after applying collection scope and filters.
    - **Rerank cutoff**: `top_k_rerank = 64` (subset of retrieved candidates).
    - **Answer composition**: use up to 3 supporting citations; require ≥ 1 to emit an answer; otherwise return `no_answer`. No second retrieval pass.
    - **Pagination**: `page_size = 10`, `max_page_size = 50` for ranked results.
    - **Deduplication**: dedup by (Note, Version); keep the highest-ranked passage for each pair.
    - **Tie-breaking**: sort by full-precision score desc; ties next broken by `version_id` asc, then `passage_id` asc (stable ordering).
    - **Determinism**: no randomness in retrieval/rerank; same input yields identical ordering for the same committed index.
    - **Configurability**: defaults may be overridden per workspace; changing retrieval/rerank parameters impacts determinism and must be surfaced in settings/help.
    - **SLO backoff**: if measured P95 search latency exceeds 500 ms within the current session, temporarily reduce `top_k_rerank` to 32 and surface a status notice; restore defaults when P95 returns to target for the session.
    - **SLO alignment**: retrieval + rerank + compose must conform to Search P50 ≤ 200 ms / P95 ≤ 500 ms on the 10k corpus.

- **Reading View**: open Version at cited anchor → highlight token_offset..length in normalized structure → navigate citations; unresolved anchors flagged with nearest passage.

- **Scoped Search**: explicit Collection scope applied first; filters within scope; persist last scope per session.

- **Operation Queue**: fairness = FIFO per note and fair-share across notes; max in-flight visibility updates = 1 per note, 4 per workspace; starvation avoidance via aging (long-waiting items gain priority).

## 6. Event Model

- **Event Types**:
    - DraftSaved(note_id, autosave_ts)
    - VersionCreated(version_id, note_id, parent_version_id?, label?)
    - VisibilityEvent(version_id, op, collections[])
    - IndexUpdateStarted/Committed/Failed(version_id)
    - QuerySubmitted(query_id, scope)
    - AnswerComposed(answer_id, coverage)
    - CitationResolved(citation_id, resolved)
    - AnchorDriftDetected(version_id, anchor)
    - SnapshotCreated/Restored(snapshot_id)
    - IndexHealthCheckPassed(index_id) | IndexHealthCheckFailed(index_id, reason)

- **Producers/Consumers**: Editor/Store produce Draft/Version/Visibility; Indexer consumes Visibility and emits Index updates and health checks; Search produces Answer/Citation events; Reader produces CitationResolved; Snapshot manager produces snapshot events.

- **Ordering & Duplication**: per-note ordering preserved; at-least-once delivery; consumers idempotent.

- **Schema Evolution**: `schema_version` per entity/event; additive-first; removals use a deprecation window.

## 7. Consistency & Concurrency Model

- **Read Consistency**: read-your-writes within the same session; monotonic reads otherwise; freshness bound by visibility SLA (≤ 10 s P95).

- **Corpus Visibility**: staged build then atomic swap; search reads committed segments only; index health enforced before swap.

- **Concurrency & Conflicts**: operation queue serializes corpus-affecting actions per note; conflicts detected by in-flight operations; bounded retries with backoff; user feedback shows queue state.

- **Rate Limits (per session, defaults)**:
    - **Queries**: burst ≤ 5 QPS, sustained ≤ 60/min
    - **Mutations (publish/republish/rollback)**: burst ≤ 1/5 s, sustained ≤ 12/min
    - Exceeding limits returns RateLimitExceeded with retry-after.

- **Idempotency**: Visibility events dedup by `(version_id, op)`; publish/rollback guarded by client tokens; draft saves are last-write-wins.

## 8. Quality Attribute Envelopes

- **Latency/Throughput Targets**: search 200/500 ms; visibility 5 s/10 s; reading open+highlight 200/500 ms.

- **Acceptance Gates (release blocking)**:
    - **SLO gates**: P95 search ≤ 500 ms; P95 publish→visible ≤ 10 s.
    - **Anchor gates**: unresolved_anchor_rate ≤ 0% in committed answers; ≤ 1% during migration validation; any unresolved citation in an answer is a release blocker.
    - **Evidence gates**: 100% of answer claims cite ≥ 1 anchor; `no_answer` emitted when coverage below threshold.

- **Observability Signals (privacy-preserving)**: counters/timers for search latency, queries, no_answer; visibility timers; reading open_highlight; citation_opens; structured events without content.

- **Telemetry Retention (local)**: events/counters 30 days; traces 7 days; purge policy documented; no content bodies stored.

## 9. Access & Capability Model

- **Subjects**: single local user.

- **Capabilities (default)**: publish, republish, rollback, delete, create_snapshot, restore_snapshot; export disabled by default (opt-in policy).

- **Preconditions**: workspace open; note exists; publish requires title and ≥ 1 collection; tags within limits.

- **Data Scoping**: actions operate within current workspace; exports are explicit artifacts.

## 10. Error Taxonomy & Recovery

- **Classes**: ValidationError; ConflictError; NotFound; RateLimitExceeded; VisibilityTimeout; IndexingFailure; StorageIO; SchemaVersionMismatch.

- **User-facing messages & actions**:
    - **ValidationError** → show missing/invalid fields; block until fixed.
    - **ConflictError** → "Another operation is in progress." Auto-retry queued; show progress.
    - **RateLimitExceeded** → show retry-after seconds.
    - **VisibilityTimeout** → show "Index update delayed"; provide Retry and View Status; keep Version committed but not searchable.
    - **IndexingFailure** → present Retry; after bounded retries, surface manual retry with diagnostics.
    - **NotFound (Version)** → mark step irreproducible; offer nearest Version.
    - **StorageIO** → autosave drafts; never lose edits.

- **Retry policies**: visibility/indexing retries = 3 attempts with exponential backoff (1s, 2s, 4s); then escalate to user control.

- **Dead-letter (conceptual)**: failed VisibilityEvents land in local retry queue with visible status and retry controls.

## 11. Data Lifecycle & Evolution

- **Ingestion**: Markdown authoring only; drafts autosaved locally.

- **Retention (defaults)**: Versions keep-all by default; Sessions TTL 180 days (pinned sessions override TTL); Snapshots retention 30 days by default.

- **Deletion Policy (workspace-configurable)**:
    - **Strict Privacy (default)**: deleting a Note hides all Versions immediately from normal flows; recovery only via pre-existing snapshots.
    - **Recoverable Window (opt-in)**: deleted items hidden but restorable within 30 days; purge after window.
    - **Search visibility revocation** is immediate.

- **Versioning & Compatibility**: per-entity `schema_version`; additive-first; removals require a deprecation window.

- **Migration Patterns**: offline anchor rebuild with validation (anchor count match; unresolved_anchor_rate < 1%; fingerprint mismatch report); feature-flag cutover; rollback to prior anchors/index on validation failure.

- **Export Posture**: if enabled, anonymize IDs where appropriate; exclude draft content and note bodies; redact personal path identifiers; include manifest with schema versions.

## 12. Compatibility Matrix

- **Ontology ↔ Data Model**: entities/IDs align; Version immutable; Anchor schema unified; ProjectTree is a view, not an entity.

- **Data Model ↔ Interfaces**: contracts reference Version IDs and Anchor fields; publish/rollback produce VisibilityEvents; Search/Reader consume only committed Index.

- **Flows ↔ SLOs**: two-phase publish/rollback meet 5 s/10 s envelopes; search meets 200/500 ms; reading highlights 200/500 ms.

- **Consistency ↔ APIs**: read-your-writes per session via visibility contract; no partial reads during swap; operation queue fairness with max in-flight limits and aging.

- **Lifecycle ↔ Observability**: retention/TTL policies measurable; no content bodies in telemetry; unresolved anchors reported and tracked.

- **Access Model ↔ Lifecycle**: deletion policy honored across search/reading/replay; snapshots gated by capability; export disabled by default, posture defined if enabled.

- **Rate Limits ↔ UX**: exceeding limits yields RateLimitExceeded with retry-after; limits configurable per workspace.

---

## Unresolved Ambiguities (to track but not blocking)

- Default values for export anonymization (hashing/salting policy) subject to workspace policy.
