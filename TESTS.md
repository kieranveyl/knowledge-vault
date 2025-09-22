# Test Requirements

## API Test Requirements

1. SaveDraft must persist note content and return autosave timestamp.
2. SaveDraft must be idempotent with last-write-wins semantics.
3. Publish must validate title length between 1-200 characters.
4. Publish must require at least one target collection.
5. Publish must create immutable Version with unique ID.
6. Publish must enqueue VisibilityEvent for indexing.
7. Publish must be idempotent by client token.
8. Rollback must create new Version referencing target Version.
9. Rollback must not mutate existing Versions.
10. Query must return no_answer when evidence insufficient.
11. Query must include at least one citation per answer.
12. Query must deduplicate by (Note, Version) pairs.
13. Query must respect collection scope filters.
14. Query must complete within 200ms P50, 500ms P95.
15. VisibilityEvent must update corpus within 10 seconds P95.
16. IndexUpdateCommitted must precede search visibility.
17. LoadSession must reconstruct answers with original Version IDs.
18. LoadSession must handle missing Versions gracefully.
19. CreateSnapshot must capture complete workspace state.
20. RestoreSnapshot must return workspace to snapshot state.
21. Draft content must never appear in search results.
22. Published Versions must be immutable after creation.
23. Citations must resolve to exact token spans in Versions.
24. Unresolved citations must prevent answer composition.
25. Rate limits must return RateLimitExceeded with retry-after.

## Domain Test Requirements

26. Anchor tokenization must follow Unicode NFC normalization.
27. Anchor tokenization must convert line endings to LF.
28. Anchor tokenization must collapse whitespace runs outside code.
29. Anchor tokenization must preserve code spans and blocks intact.
30. Anchor tokenization must use UAX #29 word boundaries.
31. Anchor tokenization must treat apostrophes in words as non-separators.
32. Anchor tokenization must treat hyphens between letters as non-separators.
33. Anchor tokenization must treat numbers with decimals as single tokens.
34. Anchor tokenization must use dictionary segmentation for CJK.
35. Anchor tokenization must treat \_ and / as separators outside code.
36. Anchor fingerprints must be deterministic across machines.
37. Anchor fingerprints must detect content changes.
38. Anchor re-anchoring must attempt structure_path first.
39. Anchor re-anchoring must fall back to token_offset.
40. Anchor drift detection must mark unresolved citations.

## Retrieval Test Requirements

41. Candidate retrieval must default to top_k=128 passages.
42. Rerank must default to top_k=64 from retrieved candidates.
43. Answer composition must use up to 3 supporting citations.
44. Answer composition must require ≥1 citation to emit answer.
45. Deduplication must keep highest-ranked passage per (Note, Version).
46. Tie-breaking must sort by score desc, then version_id asc.
47. Tie-breaking must sort by passage_id asc for final ties.
48. SLO backoff must reduce rerank to 32 when P95 exceeds 500ms.
49. Passage chunking must default to 180 tokens maximum.
50. Passage chunking must use 50% overlap (90 token stride).

## Storage Test Requirements

51. Version creation must generate unique ULID identifiers.
52. Version creation must compute content_hash for deduplication.
53. Collection names must be unique within workspace.
54. Note-Collection relationships must support many-to-many.
55. Draft saves must be atomic with autosave timestamp.
56. Publication events must be queued with FIFO per note.
57. Operation queue must enforce 1 in-flight per note limit.
58. Operation queue must enforce 4 in-flight per workspace limit.
59. Operation queue must implement aging for starvation avoidance.
60. Index swaps must be atomic with health checks.

## Consistency Test Requirements

61. Read-your-writes must hold within same session.
62. Monotonic reads must hold across sessions.
63. Corpus updates must be staged before atomic swap.
64. Index health must be verified before swap commit.
65. Visibility events must deduplicate by (version_id, op).
66. Client tokens must prevent duplicate publish operations.
67. Draft isolation must prevent search bleed-through.
68. Version immutability must be enforced after creation.
69. Rollback operations must preserve version history.
70. Collection scope must filter search results correctly.

## Performance Test Requirements

71. Search P50 latency must not exceed 200ms on 10k corpus.
72. Search P95 latency must not exceed 500ms on 10k corpus.
73. Publish-to-visible P50 must not exceed 5 seconds.
74. Publish-to-visible P95 must not exceed 10 seconds.
75. Reading view highlighting must complete within 200ms P50.
76. Reading view highlighting must complete within 500ms P95.
77. Sustained query load must support ≥10 QPS interactive.
78. Rate limits must enforce 5 QPS burst, 60/min sustained.
79. Rate limits must enforce 1/5s burst, 12/min for mutations.
80. SLO violations must trigger automatic rerank reduction.

## Error Handling Test Requirements

81. ValidationError must show specific missing fields.
82. ConflictError must queue operations with auto-retry.
83. NotFound errors must offer nearest available alternatives.
84. RateLimitExceeded must include retry-after seconds.
85. VisibilityTimeout must preserve Version while showing delay.
86. IndexingFailure must provide bounded retries then escalate.
87. StorageIO errors must never lose draft content.
88. SchemaVersionMismatch must trigger migration validation.
89. Anchor resolution failures must be gracefully handled.
90. Session replay must handle missing Versions gracefully.

## Security Test Requirements

91. Draft content must be isolated from published corpus.
92. Published Versions must be read-only after commit.
93. Collection scope must prevent unauthorized access.
94. Rate limiting must prevent abuse patterns.
95. Export functionality must be disabled by default.
96. Telemetry must exclude content bodies and personal paths.
97. Snapshot restoration must validate integrity.
98. Local storage must prevent external access.
99. Index operations must validate input sanitization.
100.    Session tokens must prevent replay attacks.
