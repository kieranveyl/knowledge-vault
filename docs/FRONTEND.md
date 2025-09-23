# Frontend Architecture Analysis: Knowledge Repository System

As a front-end architect reviewing these specifications, I'm assessing how to design a client application that effectively implements the API contracts while delivering a seamless user experience. Let me break this down systematically.

## Core Architecture Considerations

### 1. Data Flow & API Contracts

The system follows a clean architecture pattern with clear separation between domain logic, effects, and adapters. From the frontend perspective, I need to focus on these key interfaces:

```docs/03-SPEC.md#L182-202
- **Editor ↔ Store**
    - **Purpose**: create/edit Drafts; Publish/Republish; Rollback; manage Collections.
    - **Requests (conceptual)**: `SaveDraft{note_id, body_md, metadata}`, `Publish{note_id, collections[], label?, validation_policy:default}`, `Rollback{note_id, target_version_id}`.
    - **Responses**: `DraftSaved{note_id, autosave_ts}`, `VersionCreated{version_id, note_id}`, `RollbackApplied{new_version_id}`.
    - **Preconditions**: workspace open; note exists; publish validation passes (title length, collection exists, tags within limits).
    - **Postconditions**: Version persisted; VisibilityEvent enqueued; rollback creates new Version referencing target.
    - **Idempotency**: `SaveDraft` last-write-wins; `Publish`/`Rollback` idempotent by client token.

- **Search ↔ Reader**
    - **Purpose**: map `Query{text, scope, filters}` → `Answer{text, citations[], ranked_items}`.
    - **Contracts**: fully extractive answers; if any needed citation is unresolved, return `no_answer` with nearest passages.
    - **Pagination** on ranked list; deterministic dedup by (Note, Version).
```

These contracts define our primary frontend-backend interactions. The architecture must implement:

- A robust API client layer that handles idempotency tokens for publish/rollback operations
- Proper error handling for the specified error classes (ValidationError, ConflictError, etc.)
- State management that respects the draft/publish isolation boundary

### 2. State Management Strategy

The system's state model is complex with multiple interrelated entities. As a frontend architect, I'd implement:

- **Domain State**: Pure representations of entities (Notes, Collections, etc.) following the logical data model
- **UI State**: Presentation-specific state (active tabs, search filters, etc.)
- **Session State**: Tracking query history and session replay capabilities

```docs/03-SPEC.md#L250-260
- **Search & Answer Composition**: accept query+scope → retrieve/top-k passages → rank/select → compose fully extractive answer → attach citations → present ranked list; if evidence insufficient or any citation unresolved, return `no_answer` with nearest passages.

- **Retrieval Defaults (Deterministic)**:
    - **Candidate retrieval**: `top_k_retrieve = 128` passages after applying collection scope and filters.
    - **Rerank cutoff**: `top_k_rerank = 64` (subset of retrieved candidates).
    - **Answer composition**: use up to 3 supporting citations; require ≥ 1 to emit an answer; otherwise return `no_answer`.
```

This requires a sophisticated state management approach where search results maintain references to specific Version IDs - critical for the reading view and session replay.

### 3. Performance Constraints

The performance targets are stringent and must drive architectural decisions:

```docs/03-SPEC.md#L12-18
- **Primary Objectives**:
    - **Search**: P50 ≤ 200 ms; P95 ≤ 500 ms on a 10k published-note corpus; ≥ 10 QPS sustained interactive.
    - **Publish→Searchable**: P50 ≤ 5 s; P95 ≤ 10 s from action to committed corpus visibility.
    - **Strict draft/publish isolation**: zero draft bleed-through in search/answers.
    - **Answers**: every claim cites ≥ 1 Version-backed passage; return no-answer if evidence insufficient or any citation is unresolved.
```

To meet these:

- We'll implement client-side caching of recently viewed notes/versions
- Use virtualized lists for search results and version history
- Implement request debouncing for search inputs
- Design the UI to provide immediate feedback during publish operations (showing "Version committed" state before full visibility)
- Respect the SLO backoff mechanism that temporarily reduces `top_k_rerank` when latency exceeds targets

### 4. Citation & Anchor System

The anchor model is particularly sophisticated and requires careful frontend implementation:

```docs/03-SPEC.md#L54-75
- **Anchor model (canonical)**: `{ structure_path, token_offset:int, token_length:int, fingerprint }`; normalization: normalized headings/paragraphs, stable tokenizer and token units, whitespace/line-ending normalization; structure_path uses stable heading identifiers. Drift: fingerprint mismatch → attempt re-anchoring via structure_path then nearest token_offset; if unresolved, mark citation unresolved and do not use in answers.

- **Tokenization Standard (Normative)**:
    - **Normalization**: Unicode NFC; line endings → LF; collapse runs of whitespace to a single space outside inline/fenced code. Do not alter text inside code spans/blocks.
    - **Parsing scope**: tokenize the rendered text of Markdown text nodes (syntax markers excluded); `structure_path` derives from the heading trail of a CommonMark-conformant tree.
    - **Token unit**: Unicode word boundaries per UAX #29; treat internal apostrophes and hyphens between letters/digits as part of the token...
```

The frontend must:

- Implement the same tokenization and normalization rules as the backend
- Render stable highlights based on token offsets (not character positions)
- Handle anchor drift gracefully with fallback strategies
- Maintain structure_path references for proper navigation

This suggests we'll need a dedicated "anchor service" in the frontend that mirrors the backend tokenization logic.

## Component Architecture

Based on the feature specifications, I'd structure the frontend with these key components:

### 1. Workspace Navigation System

```docs/02-OVERVIEW.md#L123-152
### Feature 1: Project tree and collection browser

- **Intent**: Provide a structured view of collections and notes for rapid orientation and access.
- **Triggers**: App open; user selects a collection; user expands or collapses folders.
- **Preconditions**: Workspace path is available.
- **Postconditions**: The user sees collections and notes with clear draft or published status.
- **Inputs → Outputs**: Inputs: workspace state. Outputs: rendered tree with selection and status.
```

This requires:

- A tree component that shows collections and notes with visual status indicators
- State management for expanded/collapsed nodes
- Integration with the Collection API endpoints
- Visual distinction between draft and published states

### 2. Editor System

```docs/02-OVERVIEW.md#L154-182
### Feature 2: Markdown editor with draft mode

- **Intent**: Enable note creation and editing without affecting search until explicitly published.
- **Triggers**: User creates a new note or edits an existing note.
- **Preconditions**: A collection context or workspace root is selected.
- **Postconditions**: Draft changes are saved and remain excluded from search and answers.
```

Key considerations:

- Dual-mode interface (draft vs reading)
- Auto-save with visual feedback
- Publish workflow integration with validation
- Version history access from editor

### 3. Search & Answer System

```docs/02-OVERVIEW.md#L226-252
### Feature 5: Corpus search with citation-first answers

- **Intent**: Return concise answers backed by pinpoint citations into published notes.
- **Triggers**: User submits a query with optional collection scope and filters.
- **Preconditions**: At least one published note exists.
- **Postconditions**: The user receives an answer with citations and a ranked results list.
```

This is the most complex part requiring:

- Query input with collection scoping controls
- Answer display with inline citations
- Results list with deterministic deduplication
- "No answer" fallback when evidence is insufficient
- Integration with the reading view for citation navigation

### 4. Reading View System

```docs/02-OVERVIEW.md#L254-279
### Feature 6: Reading view with passage navigation

- **Intent**: Let users open a published note at the cited span and review surrounding context.
- **Triggers**: User opens a result or clicks a citation.
- **Preconditions**: The cited Version exists and is accessible.
- **Postconditions**: The note opens at the correct passage with highlights and context controls.
```

Critical features:

- Precise passage highlighting based on token offsets
- Structure-aware navigation (heading trails)
- Version switching capability
- Citation navigation controls (next/previous)

## Technical Implementation Strategy

### 1. Framework & Tooling

Given the architecture notes in the custom instructions:

```
## Architecture
Clean architecture pattern: domain (pure functions) → effects (orchestration) → adapters (I/O). Entry point: `src/runtime/main.ts`. Key layers: domain logic, Effect-based workflows, ports/adapters, pipelines (indexing/visibility), telemetry. Uses local-first storage (ElectricSQL), Orama search, Elysia API framework.

## Code Style
- **Formatting**: Tabs for indentation, double quotes, organize imports on save (Biome enforced)
- **Imports**: Use relative paths, group by type (domain → effects → adapters)
- **Types**: Strict TypeScript, Effect Schema for validation, explicit return types on public functions
```

I'd implement:

- **TypeScript with strict configuration** - essential for handling the complex domain model
- **Effect for async operations** - to manage the state flows described in section 5 of SPEC.md
- **ElectricSQL for local storage** - to support the local-first requirement
- **Orama for client-side search capabilities** - to help meet performance targets

### 2. Error Handling Strategy

The SPEC defines a clear error taxonomy that must be reflected in the UI:

```docs/03-SPEC.md#L405-425
- **Classes**: ValidationError; ConflictError; NotFound; RateLimitExceeded; VisibilityTimeout; IndexingFailure; StorageIO; SchemaVersionMismatch.

- **User-facing messages & actions**:
    - **ValidationError** → show missing/invalid fields; block until fixed.
    - **ConflictError** → "Another operation is in progress." Auto-retry queued; show progress.
    - **RateLimitExceeded** → show retry-after seconds.
    - **VisibilityTimeout** → show "Index update delayed"; provide Retry and View Status; keep Version committed but not searchable.
```

I'd implement an error handling middleware that maps these backend errors to appropriate UI treatments, with special attention to the "VisibilityTimeout" case which requires showing partial success (Version committed but not yet searchable).

### 3. Performance Optimization Tactics

To meet the strict latency targets:

- Implement request caching with appropriate invalidation
- Use virtual scrolling for long lists (version history, search results)
- Preload likely next actions (e.g., when viewing a note, preload its versions)
- Implement the SLO backoff mechanism that temporarily reduces `top_k_rerank`
- Use Web Workers for CPU-intensive tasks like tokenization

```docs/03-SPEC.md#L268-274
- **SLO backoff**: if measured P95 search latency exceeds 500 ms within the current session, temporarily reduce `top_k_rerank` to 32 and surface a status notice; restore defaults when P95 returns to target for the session.
- **SLO alignment**: retrieval + rerank + compose must conform to Search P50 ≤ 200 ms / P95 ≤ 500 ms on the 10k corpus.
```

## Critical Implementation Challenges

### 1. Anchor Stability & Highlighting

The most technically challenging aspect is implementing stable passage highlighting:

```docs/03-SPEC.md#L63-68
- **Token unit**: Unicode word boundaries per UAX #29; treat internal apostrophes and hyphens between letters/digits as part of the token; numbers with decimals/commas are single tokens; for CJK scripts, prefer dictionary segmentation when available; otherwise fall back to codepoint segmentation.
- **Offsets**: `token_offset` is a 0-based index into the token sequence of the target block; `token_length` is the count of tokens; both measured after normalization.
```

This requires:

- A robust client-side tokenizer that matches the backend implementation
- Careful handling of Markdown rendering to maintain token alignment
- Fallback strategies for when fingerprints don't match (anchor drift)

### 2. Draft/Publish Isolation

The system must guarantee zero bleed-through between draft and published states:

```docs/03-SPEC.md#L16-18
- **Strict draft/publish isolation**: zero draft bleed-through in search/answers.
- **Answers**: every claim cites ≥ 1 Version-backed passage; return no-answer if evidence insufficient or any citation is unresolved.
```

In the frontend, this means:

- Strict separation in state management between draft and published content
- Clear visual indicators of draft vs published states
- Preventing any draft content from being included in search requests

### 3. Session Replay Consistency

Session replay must work even if content has changed since the session was recorded:

```docs/03-SPEC.md#L203-209
- **SessionReplay**
    - **Purpose**: reload prior answers and cited passages tied to Version IDs.
    - **Inputs**: `LoadSession{session_id}`; `OpenStep{session_id, step_id}`.
    - **Outputs**: reconstructed Answer and citations; errors for missing Versions with nearest-available suggestion.
```

This requires:

- Storing Version IDs (not just note IDs) in session history
- Handling cases where versions have been deleted or rolled back
- Providing graceful fallbacks when exact versions aren't available

## Next Steps for Implementation

As a front-end architect, my immediate next steps would be:

1. Define the API client interface with proper type definitions matching the SPEC
2. Design the state management structure following the domain/effects/adapters pattern
3. Create wireframes for the key user flows (draft→publish, search→read, session replay)
4. Implement the tokenization service to handle anchor resolution
5. Build the foundational component structure with strict TypeScript interfaces

The specifications provide excellent guidance with clear contracts and constraints. By adhering to the clean architecture pattern and respecting the performance targets, we can build a frontend that delivers on the system's ambitious goals while providing a seamless user experience.
