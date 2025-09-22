# Tests Roadmap

Immediate roadmap drafted across four phases to close every uncovered requirement.

## Phase Roadmap

| Phase       | Test Cases (Requirements)                                                                                                                         | Priority | Dependencies                                                                            |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------- |
| **Phase 1** | `src/tests/integration.publish-lifecycle.test.ts` – Publish validation, idempotency, immutability (Req 3,4,5,7,22,66,68)                          | CRITICAL | Existing API harness, deterministic seed data, ability to inspect versions table        |
| **Phase 1** | `src/tests/integration.visibility-pipeline.test.ts` – Visibility event emission and index commit ordering (Req 6,16)                              | CRITICAL | Stub-able indexing adapter that records enqueue/commit calls, fake clock                |
| **Phase 1** | `src/tests/integration.rollback-history.test.ts` – Rollback versioning guarantees (Req 8,9,69)                                                    | CRITICAL | Fixtures with multiple versions, storage inspection helpers                             |
| **Phase 1** | `src/tests/integration.query-answer.test.ts` – Answer correctness, scope, draft isolation, citation integrity (Req 10,11,13,21,23,24,43,44,67,70) | CRITICAL | Search adapter spy to capture results, published/draft fixtures, citation resolver mock |
| **Phase 1** | `src/tests/integration.rate-limit.test.ts` – Rate limit contract (Req 25)                                                                         | CRITICAL | Fake clock or token bucket stub, ability to reset limiter state                         |
| **Phase 2** | `src/tests/integration.visibility-slo.test.ts` – Visibility pipeline staging and health (Req 15,63,64,65)                                         | HIGH     | Observable queue with timestamp capture, clock control, health probe hooks              |
| **Phase 2** | `src/tests/integration.session-replay.test.ts` – LoadSession resilience (Req 17,18,90)                                                            | HIGH     | Session fixture generator, ability to delete versions mid-test                          |
| **Phase 2** | `src/tests/integration.snapshot-restore.test.ts` – Snapshot capture/restore integrity (Req 19,20,97)                                              | CRITICAL | Filesystem sandbox fixture, checksum utility, diff helpers                              |
| **Phase 2** | `src/tests/retrieval.defaults.test.ts` – Retrieval top_k defaults (Req 41,42)                                                                     | HIGH     | Retrieval pipeline with controllable config injection                                   |
| **Phase 2** | `src/tests/storage.collections-membership.test.ts` – Collection membership fan-out (Req 54)                                                       | HIGH     | Direct storage adapter access, factory for notes/collections                            |
| **Phase 2** | `src/tests/storage.operation-queue.test.ts` – Scheduler limits & aging (Req 56,57,58,59,60)                                                       | HIGH     | In-memory queue implementation or deterministic stub, time control                      |
| **Phase 2** | `src/tests/consistency.read-model.test.ts` – Read-your-writes & monotonic reads (Req 61,62)                                                       | HIGH     | Multi-session harness, ability to swap adapters mid-test                                |
| **Phase 2** | `src/tests/error-handling.api.test.ts` – Validation, conflict retry, not-found hints, resilience (Req 81,82,83,84,85,86,87,88)                    | HIGH     | API harness with controllable adapters to induce failures                               |
| **Phase 2** | `src/tests/domain.anchor.normalization.test.ts` – Remaining anchor edge cases (Req 27,30,38,39)                                                   | MEDIUM   | Anchor tokenizer fixtures covering CR/LF, punctuation, structure paths                  |
| **Phase 3** | `src/tests/perf.search-latency.test.ts` – Query latency & throughput (Req 14,71,72,77)                                                            | HIGH     | Benchmark dataset ~10k notes, high-resolution timers, parallel runner                   |
| **Phase 3** | `src/tests/perf.visibility-latency.test.ts` – Publish-to-visible SLOs (Req 73,74)                                                                 | HIGH     | Clock control, simulate indexing backlog, observability metrics access                  |
| **Phase 3** | `src/tests/perf.highlighting.test.ts` – Reading highlight latency (Req 75,76)                                                                     | MEDIUM   | UI adapter stub emitting timing hooks                                                   |
| **Phase 3** | `src/tests/perf.rate-limit-throughput.test.ts` – Burst and sustained limiter (Req 78,79,80)                                                       | HIGH     | Configurable limiter, ability to simulate concurrent traffic                            |
| **Phase 3** | `src/tests/security.corpus-isolation.test.ts` – Draft isolation, scoped access, abuse prevention (Req 91,93,94,98)                                | HIGH     | Auth/context injection harness, ability to toggle workspace roles                       |
| **Phase 3** | `src/tests/security.version-protection.test.ts` – Read-only versions & export defaults (Req 92,95)                                                | HIGH     | Storage adapter spy, export API toggle inspection                                       |
| **Phase 3** | `src/tests/security.telemetry-sanitization.test.ts` – Telemetry redaction (Req 96)                                                                | MEDIUM   | Observability adapter capture, sample payload comparer                                  |
| **Phase 3** | `src/tests/security.snapshot-hardening.test.ts` – Snapshot tamper detection (Req 97 complement)                                                   | MEDIUM   | Checksum validation tool, corrupted snapshot fixtures                                   |
| **Phase 3** | `src/tests/security.index-validation.test.ts` – Index input sanitization (Req 99)                                                                 | HIGH     | Index adapter that records raw payloads, malicious fixture set                          |
| **Phase 3** | `src/tests/security.session-token.test.ts` – Anti-replay guarantees (Req 100)                                                                     | HIGH     | Token issuance helper, clock skew simulation                                            |
| **Phase 4** | `src/tests/domain.anchor.internationalization.test.ts` – Numeric and CJK segmentation (Req 33,34)                                                 | MEDIUM   | CJK corpora samples, locale-aware tokenizer config                                      |

## Detailed Test Specs

### Phase 1 - Critical Integration Tests

#### `src/tests/integration.publish-lifecycle.test.ts`

**Publish validation:**

- `it("rejects title shorter than 1 char")` - asserting 400 + validation detail
- `it("rejects title longer than 200 chars")` - asserting 400 + validation detail

**Collection requirement:**

- `it("rejects publish without collections")` - asserting 422 and error code

**Idempotency:**

- `it("returns same version on repeated publish with identical client_token")` - comparing version_id and ensuring second call is 200 no-op

**Version immutability:**

- `it("prevents updates to published version body")` - expecting storage error and verifying version record unchanged

_Requires stubbing deps.storage ULID generator for deterministic comparisons._

#### `src/tests/integration.visibility-pipeline.test.ts`

**Visibility event emission:**

- `it("queues VisibilityEvent when publishing note")` - asserting indexing adapter received enqueue payload matching version id

**Index commit ordering:**

- `it("does not expose version before IndexUpdateCommitted emitted")` - using fake clock and capturing that search adapter remains stale until commit hook fires

#### `src/tests/integration.rollback-history.test.ts`

**Rollback versioning:**

- `it("creates new version referencing target version_id")` - verifying rollback_version.parent_version_id

**Rollback immutability:**

- `it("preserves previous versions untouched")` - diffing stored snapshots before/after rollback

#### `src/tests/integration.query-answer.test.ts`

**Answer composition:**

- `it("returns no_answer when retrieval score below threshold")`

**Citation requirements:**

- `it("enforces at least one citation per answer")` - verifying HTTP 409 or empty answer when citations missing
- `it("anchors citations to token spans")` - ensuring offsets map to tokenizer output
- `it("limits supporting citations to 3")` - citation cap enforcement

**Scoped queries:**

- `it("filters results to selected collection IDs")`

**Draft isolation:**

- `it("excludes draft content from results and citations")`

#### `src/tests/integration.rate-limit.test.ts`

**Rate limiting:**

- `it("returns 429 and retry-after when exceeding burst limit")` - using fake clock to exceed 5 QPS
- `it("resets after retry-after window")`

### Phase 2 - Extended Integration & Storage Tests

#### `src/tests/integration.visibility-slo.test.ts`

**Publish-to-visible SLO:**

- `it("records visibility within 10s P95 under normal load")` - capturing timestamps across 50 publishes

**Index staging:**

- `it("buffers corpus updates until swap health check passes")`

**Deduplicated events:**

- `it("drops duplicate visibility events by (version_id, op)")`

#### `src/tests/integration.session-replay.test.ts`

**LoadSession reconstruction:**

- `it("restores answers with original version IDs")`

**Missing versions:**

- `it("marks missing versions without throwing")`

#### `src/tests/integration.snapshot-restore.test.ts`

**Snapshot capture:**

- `it("captures full workspace including drafts, versions, indexes")` - verifying file manifests

**Restore:**

- `it("restores workspace exactly and validates checksum")`

**Tamper detection:**

- `it("rejects snapshot when checksum mismatch")`

#### `src/tests/retrieval.defaults.test.ts`

**Candidate retrieval defaults:**

- `it("uses top_k=128 when config omitted")`

**Rerank defaults:**

- `it("uses top_k=64 after retrieval")` - verifying call parameters

#### `src/tests/storage.collections-membership.test.ts`

**Collection membership:**

- `it("associates note with multiple collections")`
- `it("removes membership without orphaning note")`

#### `src/tests/storage.operation-queue.test.ts`

**FIFO per note:**

- `it("processes operations in submission order for same note")`

**Workspace throughput limits:**

- `it("blocks fifth concurrent operation")`

**Aging policy:**

- `it("promotes oldest queued job when starvation detected")`

**Index swap health:**

- `it("performs health check before swap commit")`

#### `src/tests/consistency.read-model.test.ts`

**Read-your-writes:**

- `it("reflects draft save immediately within session")`

**Monotonic reads:**

- `it("never returns older version after publish")`

#### `src/tests/error-handling.api.test.ts`

**Validation errors:**

- `it("lists missing fields in response payload")`

**Conflict retry:**

- `it("requeues conflicting publish and eventually succeeds")`

**Not found suggestions:**

- `it("returns nearest alternatives")`

**Rate limit headers:**

- `it("sets retry-after and remaining")`

**Visibility timeout:**

- `it("returns placeholder with persisted version")`

**Indexing failure escalation:**

- `it("retries bounded attempts then emits alert")`

**Storage IO failure:**

- `it("persists draft copy on fallback store")`

**Schema version mismatch:**

- `it("blocks startup and surfaces migration guidance")`

#### `src/tests/domain.anchor.normalization.test.ts`

**Line ending normalization:**

- `it("converts CR/CRLF to LF without stripping existing LF")`

**UAX #29 boundaries:**

- `it("keeps emoji + skin tones as single token")`

**Re-anchoring priority:**

- `it("attempts structure_path before token_offset")`

**Re-anchoring fallback:**

- `it("falls back to token offset when structure missing")`

### Phase 3 - Performance & Security Tests

#### `src/tests/perf.search-latency.test.ts`

**Latency SLO:**

- `it("keeps P50 ≤200ms on 10k corpus")`

**Throughput:**

- `it("sustains ≥10 QPS")`

#### `src/tests/perf.visibility-latency.test.ts`

**Publish latency:**

- `it("achieves P50 ≤5s")`

**P95 latency:**

- `it("achieves ≤10s")`

#### `src/tests/perf.highlighting.test.ts`

**Highlight render:**

- `it("completes within 200ms P50")`
- `it("completes within 500ms P95")`

#### `src/tests/perf.rate-limit-throughput.test.ts`

**Burst limits:**

- `it("enforces 5 QPS burst")`

**Sustained limits:**

- `it("enforces 60/min read, 12/min mutations")`

**SLO backoff:**

- `it("reduces rerank window when SLA breached")`

#### `src/tests/security.corpus-isolation.test.ts`

**Draft isolation:**

- `it("prevents draft fetch via search API even with collection override")`

**Collection scope enforcement:**

- `it("denies access to collections outside auth scope")`

**Abuse patterns:**

- `it("locks account after repeated rate limit violations")`

**Local storage isolation:**

- `it("rejects workspace path traversal")`

#### `src/tests/security.version-protection.test.ts`

**Version immutability:**

- `it("rejects PATCH/DELETE on versions endpoint")`

**Export defaults:**

- `it("ensures export route disabled unless feature flag on")`

#### `src/tests/security.telemetry-sanitization.test.ts`

**Telemetry payload:**

- `it("omits note bodies and personal paths")`

#### `src/tests/security.snapshot-hardening.test.ts`

**Snapshot integrity:**

- `it("fails restore when tamper detected by checksum")`

#### `src/tests/security.index-validation.test.ts`

**Index payload sanitization:**

- `it("rejects HTML/script injection tokens")`

#### `src/tests/security.session-token.test.ts`

**Replay prevention:**

- `it("rejects reused session token even across clock skew")`

### Phase 4 - Internationalization Tests

#### `src/tests/domain.anchor.internationalization.test.ts`

**Decimal tokens:**

- `it("treats 3.1415 as single token")`

**CJK segmentation:**

- `it("segments Chinese text with dictionary aware splitting")`

## Coverage Goals

| Phase             | Target Overall Coverage                                      | Category Highlights                                                   |
| ----------------- | ------------------------------------------------------------ | --------------------------------------------------------------------- |
| **Current**       | 23%                                                          | API 12%, Domain 60%, Retrieval 60%, Storage 40%, others 0%            |
| **After Phase 1** | ≈46% overall; API ≥80%; Retrieval critical behaviours ≥80%   | Closes publish, rollback, visibility emission, query/answer contracts |
| **After Phase 2** | ≈68% overall; Storage ≥85%; Error handling ≥75%; Domain ≥85% | Closes storage guarantees, error resilience, anchor normalization     |
| **After Phase 3** | ≈85% overall; Performance ≥90%; Security ≥90%                | Closes SLO validation, security model, comprehensive edge cases       |
| **After Phase 4** | ≈90% overall; All categories ≥85%                            | Full internationalization support, complete spec coverage             |

## Implementation Notes

### Test Infrastructure Requirements

**Phase 1 Dependencies:**

- Deterministic ULID generation for reproducible test runs
- Fake clock implementation for time-sensitive tests
- Indexing adapter spies/mocks for visibility pipeline testing
- Storage inspection utilities for version state verification

**Phase 2 Dependencies:**

- Observable queue implementation with timestamp capture
- Multi-session test harness for consistency testing
- Filesystem sandbox utilities for snapshot testing
- Configurable adapter injection system

**Phase 3 Dependencies:**

- High-resolution performance timing utilities
- Benchmark dataset generation (10k+ notes)
- Concurrent traffic simulation tools
- Auth/context injection framework

**Phase 4 Dependencies:**

- CJK text corpora for internationalization testing
- Locale-aware tokenizer configuration
- Unicode normalization test fixtures

### Risk Mitigation

**Critical Path Items:**

- Phase 1 tests must pass before Phase 2 begins
- Snapshot/restore integrity (Phase 2) blocks security hardening (Phase 3)
- Performance baseline establishment required before optimization

**Dependency Management:**

- All test infrastructure should be reusable across phases
- Mock/spy implementations should be consistent with production adapters
- Test data generation should be deterministic and version-controlled

### Success Criteria

**Phase Completion Gates:**

- All CRITICAL priority tests must achieve 100% pass rate
- HIGH priority tests must achieve ≥95% pass rate
- Coverage targets must be met or exceeded
- No regressions in existing test suite

**Quality Gates:**

- All tests must be deterministic (no flaky tests)
- Test execution time must remain under 5 minutes for full suite
- Memory usage during testing must not exceed 2GB
- All security tests must pass with zero tolerance for failures
