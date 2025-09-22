**Traceability Matrix – API Requirements (1–25)**  
| # | Requirement | Status | Evidence / Notes |
|---|-------------|--------|------------------|
| 1 | SaveDraft must persist note content and return autosave timestamp. | Tested | `src/tests/adapters.storage.test.ts` › “saves draft content” verifies persistence and timestamp. |
| 2 | SaveDraft must be idempotent with last-write-wins semantics. | Tested | `src/tests/adapters.storage.test.ts` › “implements last-write-wins for draft saves”. |
| 3 | Publish must validate title length between 1-200 characters. | Not Tested | No API-level publish validation test exercising error response. |
| 4 | Publish must require at least one target collection. | Not Tested | No negative publish test without collections. |
| 5 | Publish must create immutable Version with unique ID. | Partially Tested | `src/tests/integration.api.test.ts` › “completes ... workflow” checks ULID pattern; no immutability assertion. |
| 6 | Publish must enqueue VisibilityEvent for indexing. | Not Tested | No verification of visibility queue; orama adapter stub untested. |
| 7 | Publish must be idempotent by client token. | Not Tested | No repeated publish call with same token. |
| 8 | Rollback must create new Version referencing target Version. | Not Tested | No rollback coverage. |
| 9 | Rollback must not mutate existing Versions. | Not Tested | No rollback coverage. |
| 10 | Query must return no_answer when evidence insufficient. | Not Tested | No search endpoint assertions. |
| 11 | Query must include at least one citation per answer. | Not Tested | No answer composition tests. |
| 12 | Query must deduplicate by (Note, Version) pairs. | Tested | `src/tests/domain.retrieval.test.ts` › “deduplicateResults…”. |
| 13 | Query must respect collection scope filters. | Not Tested | No scoped query test. |
| 14 | Query must complete within 200ms P50, 500ms P95. | Not Tested | No latency/perf tests. |
| 15 | VisibilityEvent must update corpus within 10 seconds P95. | Not Tested | No timing/visibility tests. |
| 16 | IndexUpdateCommitted must precede search visibility. | Not Tested | No sequencing assertions. |
| 17 | LoadSession must reconstruct answers with original Version IDs. | Not Tested | No session replay tests. |
| 18 | LoadSession must handle missing Versions gracefully. | Not Tested | No session replay tests. |
| 19 | CreateSnapshot must capture complete workspace state. | Not Tested | No snapshot tests. |
| 20 | RestoreSnapshot must return workspace to snapshot state. | Not Tested | No snapshot tests. |
| 21 | Draft content must never appear in search results. | Not Tested | No search vs draft isolation check. |
| 22 | Published Versions must be immutable after creation. | Not Tested | No immutability verification. |
| 23 | Citations must resolve to exact token spans in Versions. | Not Tested | No citation resolution tests tied to API outputs. |
| 24 | Unresolved citations must prevent answer composition. | Not Tested | No answer composition tests. |
| 25 | Rate limits must return RateLimitExceeded with retry-after. | Not Tested | No rate-limit scenarios. |

**Traceability Matrix – Domain Requirements (26–40)**  
| # | Requirement | Status | Evidence / Notes |
|---|-------------|--------|------------------|
| 26 | Anchor tokenization must follow Unicode NFC normalization. | Tested | `src/tests/domain.anchor.test.ts` › “normalizes Unicode to NFC form”. |
| 27 | Anchor tokenization must convert line endings to LF. | Partially Tested | Same suite converts CR/CRLF but collapses to spaces; LF preservation not explicitly asserted. |
| 28 | Anchor tokenization must collapse whitespace runs outside code. | Tested | `domain.anchor.test.ts` › “collapses whitespace runs”. |
| 29 | Anchor tokenization must preserve code spans and blocks intact. | Tested | `domain.anchor.test.ts` › “preserves code content when enabled”. |
| 30 | Anchor tokenization must use UAX #29 word boundaries. | Partially Tested | Behavioural expectations (`tokenizeText` removing punctuation) checked but no direct coverage for all boundary cases. |
| 31 | Anchor tokenization must treat apostrophes in words as non-separators. | Tested | `domain.anchor.test.ts` › “preserves internal punctuation in words”. |
| 32 | Anchor tokenization must treat hyphens between letters as non-separators. | Tested | Same test ensures `hello-world`. |
| 33 | Anchor tokenization must treat numbers with decimals as single tokens. | Not Tested | No decimal token assertion. |
| 34 | Anchor tokenization must use dictionary segmentation for CJK. | Not Tested | No CJK-specific validation. |
| 35 | Anchor tokenization must treat `_` and `/` as separators outside code. | Tested | `domain.anchor.test.ts` › “handles underscore and slash separators”. |
| 36 | Anchor fingerprints must be deterministic across machines. | Tested | `domain.anchor.test.ts` › “produces consistent fingerprints”. |
| 37 | Anchor fingerprints must detect content changes. | Tested | `domain.anchor.test.ts` › “detects content changes via fingerprint mismatch”. |
| 38 | Anchor re-anchoring must attempt structure_path first. | Not Tested | Re-anchoring behaviour not asserted. |
| 39 | Anchor re-anchoring must fall back to token_offset. | Not Tested | No fallback verification. |
| 40 | Anchor drift detection must mark unresolved citations. | Tested | `domain.anchor.test.ts` › “detects content changes” sets `fingerprint_mismatch` true, indicating unresolved state. |

**Traceability Matrix – Retrieval Requirements (41–50)**  
| # | Requirement | Status | Evidence / Notes |
|---|-------------|--------|------------------|
| 41 | Candidate retrieval must default to top_k=128 passages. | Not Tested | No candidate retrieval default test. |
| 42 | Rerank must default to top_k=64 from retrieved candidates. | Not Tested | No explicit default enforcement test. |
| 43 | Answer composition must use up to 3 supporting citations. | Not Tested | No answer composition coverage. |
| 44 | Answer composition must require ≥1 citation to emit answer. | Not Tested | No answer composition coverage. |
| 45 | Deduplication must keep highest-ranked passage per (Note, Version). | Tested | `domain.retrieval.test.ts` › “keeps highest-scored passage…”. |
| 46 | Tie-breaking must sort by score desc, then version_id asc. | Tested | `domain.retrieval.test.ts` › “breaks ties by version_id”. |
| 47 | Tie-breaking must sort by passage_id asc for final ties. | Tested | `domain.retrieval.test.ts` › “breaks ties by passage_id”. |
| 48 | SLO backoff must reduce rerank to 32 when P95 exceeds 500ms. | Tested | `domain.retrieval.test.ts` › “reduces rerank window when SLO is breached”. |
| 49 | Passage chunking must default to 180 tokens maximum. | Tested | `pipelines.chunking.test.ts` › “enforces maximum 180 tokens per passage”. |
| 50 | Passage chunking must use 50% overlap (90 token stride). | Tested | `pipelines.chunking.test.ts` › “implements 50% overlap (90 token stride)”. |

**Traceability Matrix – Storage Requirements (51–60)**  
| # | Requirement | Status | Evidence / Notes |
|---|-------------|--------|------------------|
| 51 | Version creation must generate unique ULID identifiers. | Tested | `adapters.storage.test.ts` › “creates a new version” asserts ULID format. |
| 52 | Version creation must compute content_hash for deduplication. | Tested | Same test checks SHA-256 hex. |
| 53 | Collection names must be unique within workspace. | Tested | `adapters.storage.test.ts` › “enforces unique collection names”. |
| 54 | Note-Collection relationships must support many-to-many. | Not Tested | No membership add/remove scenarios. |
| 55 | Draft saves must be atomic with autosave timestamp. | Tested | `adapters.storage.test.ts` › “saves draft content” verifies autosave_ts. |
| 56 | Publication events must be queued with FIFO per note. | Not Tested | Operation queue behaviour untested. |
| 57 | Operation queue must enforce 1 in-flight per note limit. | Not Tested | No scheduler tests. |
| 58 | Operation queue must enforce 4 in-flight per workspace limit. | Not Tested | No scheduler tests. |
| 59 | Operation queue must implement aging for starvation avoidance. | Not Tested | No scheduler tests. |
| 60 | Index swaps must be atomic with health checks. | Not Tested | No visibility/index swap tests. |

**Traceability Matrix – Consistency Requirements (61–70)**  
_All Not Tested; no tests in `src/tests` address session consistency, corpus staging, deduped visibility events, or search scope enforcement._

**Traceability Matrix – Performance Requirements (71–80)**  
_All Not Tested; no latency, throughput, or rate-limit performance assertions present._

**Traceability Matrix – Error Handling Requirements (81–90)**  
| # | Requirement | Status | Evidence / Notes |
|---|-------------|--------|------------------|
| 81 | ValidationError must show specific missing fields. | Not Tested | Integration test checks error type but not field details. |
| 82 | ConflictError must queue operations with auto-retry. | Not Tested | No queue auto-retry coverage. |
| 83 | NotFound errors must offer nearest available alternatives. | Not Tested | 404 handling tested but without alternative suggestion. |
| 84 | RateLimitExceeded must include retry-after seconds. | Not Tested | No rate limit tests. |
| 85 | VisibilityTimeout must preserve Version while showing delay. | Not Tested | No such scenario exercised. |
| 86 | IndexingFailure must provide bounded retries then escalate. | Not Tested | No failure path tests. |
| 87 | StorageIO errors must never lose draft content. | Not Tested | No simulated IO failure tests. |
| 88 | SchemaVersionMismatch must trigger migration validation. | Not Tested | No schema version mismatch tests. |
| 89 | Anchor resolution failures must be gracefully handled. | Tested | `domain.anchor.test.ts` › “returns null for unresolved anchors”. |
| 90 | Session replay must handle missing Versions gracefully. | Not Tested | No session replay coverage. |

**Traceability Matrix – Security Requirements (91–100)**  
_All Not Tested; current suite lacks security/isolation checks (user indicated lesser priority, but requirements remain uncovered)._ 

---

**Coverage Summary**

| Category | Total Reqs | Tested | Partially Tested | Tested % |
|----------|------------|--------|------------------|----------|
| API (1–25) | 25 | 3 | 1 | 12% |
| Domain (26–40) | 15 | 9 | 2 | 60% |
| Retrieval (41–50) | 10 | 6 | 0 | 60% |
| Storage (51–60) | 10 | 4 | 0 | 40% |
| Consistency (61–70) | 10 | 0 | 0 | 0% |
| Performance (71–80) | 10 | 0 | 0 | 0% |
| Error Handling (81–90) | 10 | 1 | 0 | 10% |
| Security (91–100) | 10 | 0 | 0 | 0% |
| **Overall** | **100** | **23** | **3** | **23%** |

*Partial coverage indicates tests that exercise part of the behaviour but miss critical assertions (e.g., Publish validation, normalization edge cases).* 

Key gaps:
- **Critical**: Publish/rollback validations, visibility pipeline, search answer correctness, consistency guarantees, rate limiting, snapshots.
- **High**: Performance envelopes, error-handling promises, storage operation queue guarantees.

---

**Strategic Plan**

1. **Immediate Critical-Path Tests (blockers for reliable API workflows)**
   1.1 Add API integration tests for Publish validation (title length, missing collections, client token idempotency) and Rollback behaviour to satisfy requirements 3–9.  
   1.2 Im
