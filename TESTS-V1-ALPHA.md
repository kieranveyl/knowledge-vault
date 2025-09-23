# Phase 2 Test Specifications — V1 Alpha Readiness

This document captures the remaining high-priority tests required to ship the alpha build. Each section outlines the intent, functional requirements, data setup, and implementation notes so a new engineer can author the suite without rummaging through the whole codebase.

## 1. Storage Operation Queue (`src/tests/storage.operation-queue.test.ts`)

**Goal:** validate that `OperationScheduler` enforces the pipeline guarantees described in SPEC §7.

### Functional Requirements

- **FIFO per note (Req. 56):** operations submitted for the same note must complete in submission order.
- **Per-note concurrency cap (Req. 57):** only one visibility operation per note may be in-flight at a time.
- **Workspace concurrency cap (Req. 58):** no more than four operations across all notes may be processed simultaneously.
- **Starvation avoidance (Req. 59):** long-waiting items receive a priority boost so they eventually preempt newer items.

### Test Plan

1. **`processes operations FIFO per note`:**
    - Submit three visibility operations against the same `note_id`.
    - Start the scheduler, wait for completion, stop the scheduler.
    - Assert that the processed version IDs are `ver_1`, `ver_2`, `ver_3` in order.
2. **`limits to one in-flight operation per note`:**
    - Wrap the processor with a counter stored in an `Effect.Ref`.
    - Submit three operations for the same note.
    - During processing, assert the counter never exceeds `1`.
3. **`limits total in-flight operations per workspace`:**
    - Submit one operation each for five distinct notes.
    - Record how many distinct notes are in the `concurrentNotes` set at any time.
    - Assert the set size never exceeds `DEFAULT_QUEUE_CONFIG.maxInFlightPerWorkspace`.
4. **`applies aging to long-waiting operations`:**
    - Configure the scheduler with a very small aging interval (`agingIntervalMs: 50`, `agingBoostAmount: 100`).
    - Submit a low-priority item, sleep long enough for at least two aging cycles, then submit a second item with a higher base priority.
    - Verify the first processed item is the older one (boosted).

### Implementation Notes

- Always start the scheduler in a forked fiber (via `Effect.fork`) and stop it with `scheduler.stop()` at test end.
- Use `Duration.millis(...)` for sleeps.
- The scheduler is entirely in-memory; no adapters need to be mocked beyond the processor callback.

## 2. Storage Collection Membership (`src/tests/storage.collections-membership.test.ts`)

**Goal:** prove the storage adapter supports many-to-many note↔collection relationships (Req. 54).

### Functional Requirements

- Adding a note to multiple collections should persist the membership.
- Removing a note from specific collections should only drop those associations.
- Listing collections for a note should reflect the current membership set (order-insensitive).

### Test Plan

1. Create a note and three collections using `InMemoryStorageAdapter` (or real Postgres if available).
2. Call `addToCollections(note_id, [colA, colB, colC])`.
3. Assert `getNoteCollections(note_id)` returns all three IDs.
4. Remove one collection (`removeFromCollections(note_id, [colB])`).
5. Assert the membership now contains `[colA, colC]`.
6. Optionally verify `getCollectionNotes(col_id)` mirrors the change.

### Implementation Notes

- The helper adapter already exposes `addToCollections`/`removeFromCollections`; no extra wiring needed.
- The test can run entirely against the in-memory implementation to remain deterministic.

## 3. Consistency Read Model (`src/tests/consistency.read-model.test.ts`)

**Goal:** cover the read semantics promised in SPEC §6 (Req. 61, 62, 63, 67, 70).

### Functional Requirements

- **Read-your-writes (Req. 61):** a session should see its own draft/save immediately.
- **Monotonic reads (Req. 62):** after publishing a new version, subsequent reads cannot surface older versions.
- **Staged updates (Req. 63):** visibility events should gate search exposure until indexing commits (simulate with fake adapter).
- **Draft isolation (Req. 67):** drafts never bleed into search answers.
- **Collection scope enforcement (Req. 70):** search results respect the requested collection filter.

### Test Plan

1. **Read-your-writes:**
    - Create note + draft via API (`POST /drafts`).
    - Immediately `GET /drafts/:note_id` and assert updated content.
2. **Monotonic reads:**
    - Publish version `v1`, fetch via `GET /notes/:id/versions`.
    - Publish updated draft -> version `v2`.
    - Fetch versions again; ensure newest appears first and no older version replaces it in `current_version_id`.
3. **Staged updates:**
    - Use `FakeIndexingAdapter` to simulate delayed commit: record enqueued event but do not mark committed.
    - Call `/search` before commit, assert `no_answer` or empty results.
    - Manually mark process complete (e.g., push `IndexUpdateCommitted`) and re-run search; expect result appears.
4. **Draft isolation:**
    - Create a draft without publishing and confirm `/search` does not surface draft content.
5. **Collection scope:**
    - Publish the same note into two different collections.
    - Query `/search` with a single `collections` param and ensure results only include that collection’s IDs.

### Implementation Notes

- These tests should leverage the existing `createTestApi` helper; adjust the fake indexing adapter during the test to mimic delayed visibility.
- For staged updates, you may inject a method on the fake adapter to mark events as committed when desired.

## 4. API Error Handling (`src/tests/error-handling.api.test.ts`)

**Goal:** ensure API responses surface structured error information for key failure modes (Req. 81–88, excluding security requirements).

### Functional Requirements

- **Validation detail (Req. 81):** responses include `error.details` with field-level information.
- **Conflict retry guidance (Req. 82):** conflict responses should signal retry semantics (e.g., `error.type = "ConflictError"`).
- **Not Found alternatives (Req. 83):** 404 responses should include nearest alternatives when available (can be stubbed).
- **Rate limit headers (Req. 84):** rate-limit responses expose `retry_after`.
- **Visibility timeout (Req. 85) & Indexing failure (Req. 86):** confirm respective error shapes.
- **Storage IO fallback (Req. 87):** simulate storage failure and ensure response still keeps data safe (e.g., archive last draft).
- **Schema mismatch (Req. 88):** invalid schema version yields `SchemaVersionMismatch` with expected vs actual.

### Test Plan

- Create one test case per requirement, using controlled adapters to induce each failure.
    1. **Validation**: send malformed publish payload (`client_token` missing) and assert `400` with `error.details`.
    2. **Conflict**: pre-create a collection name, attempt duplicate `POST /collections`, expect 409 with conflict message.
    3. **Not Found alternatives**: simulate storage adapter returning nearest matches; assert response includes suggestions (if not implemented, skip or mark pending).
    4. **Rate limit**: reuse Phase 1 rate-limit test, but additionally assert `error.retry_after`.
    5. **Visibility timeout/Indexing failure**: override indexing adapter to throw; assert proper status (`503`/`502`) and message.
    6. **Storage IO fallback**: stub storage adapter to throw `StorageIOError` after saving draft and confirm draft content still retrievable.
    7. **Schema mismatch**: adjust storage to throw `{ _tag: "SchemaVersionMismatch" }` and assert `422` with expected/actual versions.

### Implementation Notes

- For unimplemented behaviour (e.g., Not Found alternatives), either provide a controlled stub or mark with `test.todo` if product has explicitly deferred the capability.
- Tests should only rely on the in-memory adapters; no external services are required.
- Ensure each induced failure doesn’t pollute other tests (reset helpers in `beforeEach`).

---

Once these suites are authored and passing, the Phase 2/alpha test plan is complete. Remaining planned work (performance and security) stays in Phase 3.
