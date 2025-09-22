# SCAFFOLD

Purpose

- Lay out a practical, phase‑by‑phase path to scaffold the system from empty repo to a working local‑first app, aligned with DESIGN‑SPEC.md and DESIGN‑SPEC‑LOW.md.
- Keep each phase verifiable with clear “Done when” gates and deterministic defaults.

Prerequisites

- Runtime: Bun (hot‑reload OK). TypeScript configured (strict).
- Project scripts: `bun test`, `bun run dev` (API), `bun run build` (pipelines).

Directory Skeleton (create now)

```
src/
  domain/            # pure functions (no IO)
  effects/           # Effect programs (publish, search, content, workspace)
  services/          # ports (interfaces only)
  adapters/          # impls (api, storage, search, ui)
  pipelines/         # visibility + chunking
  policy/            # retrieval, rate‑limits, publication
  runtime/           # layers, config, main
  schema/            # entities, events, api
  telemetry/         # metrics, health, gates
  tests/             # unit, property, golden, e2e
```

Phase 0 — Bootstrap

- Initialize bun + TS; add minimal scripts.
- Add repo docs links: DESIGN‑SPEC.md, DESIGN‑SPEC‑LOW.md, AGENTS.md.
- Done when: `bun test` runs a trivial test and CI script exits 0.

Phase 1 — Schemas & Policy (source of truth)

- Files: `schema/entities/*`, `schema/events/*`, `schema/api/*`.
- Define Anchor schema exactly: `{ structure_path, token_offset, token_length, fingerprint, tokenization_version, fingerprint_algo }`.
- Add policy defaults: `policy/retrieval.ts` (top_k_retrieve=128, top_k_rerank=64, page_size=10); `policy/rate-limits.ts`; `policy/publication.ts` (title 1–200, ≥1 collection, tag limits).
- Done when: schema types compile and policy exports constants with JSDoc referencing DESIGN‑SPEC‑LOW.md.

Phase 2 — Domain (pure)

- Files: `domain/anchor.ts` (Tokenization Standard: NFC, LF, UAX‑29, CJK dictionary→codepoint fallback, `_` and `/` as separators outside code; case‑preserving); `domain/retrieval.ts` (dedup, stable tie‑break: score→version_id→passage_id; SLO backoff to rerank=32); `domain/validation.ts` (publication rules); `domain/invariants.ts`.
- Tests: property tests for anchor stability; golden tests for tie‑break determinism.
- Done when: domain passes tests and exports are side‑effect free.

Phase 3 — Ports & Adapters

- Ports (interfaces): `services/storage.port.ts`, `services/indexing.port.ts`, `services/parsing.port.ts`, `services/observability.port.ts`.
- Adapters (impls): `adapters/storage/electric-sql.adapter.ts` (local‑only), `adapters/search/orama.adapter.ts`, `adapters/api/elysia.adapter.ts`.
- Done when: ports compile without adapters; adapters compile against ports but can be swapped in runtime layers.

Phase 4 — Pipelines & Queue

- Files: `pipelines/chunking/passage.ts` (180‑token chunks, 50% overlap, 20k‑token cap), `pipelines/indexing/visibility.ts` (stage→commit swap), `queue/scheduler.ts` (FIFO per note, fair‑share across notes, in‑flight caps: 1 per note, 4 per workspace; aging).
- Done when: publish emits `VisibilityEvent`; visibility pipeline generates/commits an index segment; invariants enforced (no partial visibility after swap).

Phase 5 — Effects & Runtime

- Effects: `effects/publishing/*` (publish/republish/rollback), `effects/search/*`, `effects/content/*`, `effects/workspace/*`.
- Runtime: `runtime/layers/*` binds ports→adapters; `runtime/config/*` surfaces policy overrides (workspace‑scoped); `runtime/main.ts` composes the app.
- Done when: `bun run dev` exposes health endpoint; publish creates a Version and enqueues visibility.

Phase 6 — API & Reading View Bridges

- API (adapters/api): routes for `Publish`, `Search`, `Rollback`, `SessionReplay`; map errors to taxonomy; enforce rate limits and idempotency tokens.
- Reading view bridge (adapters/ui or server handler): resolve anchors to highlights; mark unresolved and exclude from answers.
- Done when: end‑to‑end flow works on a tiny corpus; answers are fully extractive with ≥1 citation.

Phase 7 — Observability & Gates

- telemetry/metrics.ts: counters/timers for search, visibility, reading; gates.ts: SLO gates (P95 search ≤500 ms; publish→visible ≤10 s), anchor gate (unresolved_anchor_rate=0 in committed answers).
- Telemetry retention: events/counters 30d; traces 7d.
- Done when: breaching a gate surfaces a visible status and (for search) session‑scoped rerank=32 backoff.

Phase 8 — Tests & Fixtures

- Unit (domain), property (anchors/tokenization), golden (answers/citations), e2e (publish→visible, rollback→visible).
- Fixtures: sample Markdown (CJK, code spans, headings) to validate tokenization and anchors.
- Done when: `bun test` runs all suites locally within seconds and reports SLO regressions.

Phase 9 — Lifecycle & Snapshots

- Implement deletion modes (Strict Privacy default; Recoverable Window optional), session TTL with pin override, snapshot create/list/restore.
- Done when: deletion revokes visibility immediately; replay marks irreproducible steps correctly.

Operational Notes

- Determinism: avoid randomness in retrieval/rerank; document any workspace overrides that affect determinism.
- Offline posture: disable sync; keep all operations local; redact content from telemetry.
- Index health: enforce “CommittedIndexMustContain(version_id)” before swap; never expose partial segments.

Quick Start (after Phase 0–2)

```
# Run API (dev)
bun run dev
# Publish a note (pseudo)
curl -X POST :3000/publish -d '{"note_id":"note_...","collections":["col_..."],"label":"minor"}'
# Search
curl ':3000/search?q=tokenization&collections=col_...'
```
