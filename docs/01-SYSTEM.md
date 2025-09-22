# The Knowledge Repository System: A Technical Deep Dive

## Chapter 0: Understanding the Problem Space

### What We're Building and Why

Imagine you're a researcher, writer, or knowledge worker drowning in your own notes. You have hundreds of Markdown documents scattered across folders, each representing hours of careful thought and research. But when you need to find that brilliant insight you wrote three months ago about quantum computing, you're stuck grepping through files, hoping you remember the exact phrasing you used.

This is the problem the Knowledge Repository System solves. It's not just another note-taking app – it's a private, local-first knowledge management system that treats your notes as an evolving corpus of searchable, citable knowledge.

### Core Design Philosophy

The system operates on three fundamental principles:

1. **Draft-by-Default Safety**: Your work-in-progress thoughts remain private and unsearchable until you explicitly publish them. This separation prevents half-baked ideas from polluting your knowledge base.

2. **Immutable Version History**: Every publication creates a permanent version. You can't accidentally destroy past insights – they're preserved forever, like commits in Git but for knowledge.

3. **Citation-First Search**: When you search, the system doesn't just find relevant documents – it composes answers from your notes with precise citations, turning your personal knowledge into a queryable database.

### The Technical Challenge

Building this system requires solving several interconnected problems:

```
User's Question → Search Engine → Your Published Notes
                      ↓
                  Composed Answer
                      ↓
                 Precise Citations → Exact Passages in Versions
```

The system must maintain sub-second search performance across thousands of notes while guaranteeing that every claim in an answer can be traced back to a specific passage in a specific version of a note. This isn't trivial – content changes over time, but citations must remain stable.

### System Boundaries

What this system **is**:

- A local-first Markdown knowledge repository
- A versioning system for written content
- A search engine with extractive question-answering
- A citation management system with stable anchoring

What this system **is not**:

- A cloud collaboration platform
- A general-purpose database
- A web crawler or content aggregator
- An AI that generates new knowledge

### Performance Targets

The specification defines aggressive performance requirements that shape the entire architecture:

| Operation            | P50 Target | P95 Target | Context               |
| -------------------- | ---------- | ---------- | --------------------- |
| Search               | ≤ 200ms    | ≤ 500ms    | 10,000 note corpus    |
| Publish → Searchable | ≤ 5s       | ≤ 10s      | End-to-end visibility |
| Reading View         | ≤ 200ms    | ≤ 500ms    | Open and highlight    |

These aren't arbitrary numbers – they represent the difference between a tool that feels instantaneous versus one that interrupts your flow of thought.

### Knowledge Check - Chapter 0

After reading this chapter, you should understand:

- The fundamental problem the system solves (knowledge retrieval and citation)
- The three core principles (draft safety, version immutability, citation-first search)
- The key performance requirements that drive architectural decisions
- What the system includes and explicitly excludes from scope

---

## Chapter 1: Architecture Overview

### The Layered Architecture

The Knowledge Repository follows a ports-and-adapters (hexagonal) architecture, organized into distinct layers that separate concerns and enable testing:

```
┌─────────────────────────────────────────────────┐
│                HTTP API Layer                    │
│              (Elysia REST Server)                │
└─────────────────┬───────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────┐
│              Service Layer                       │
│        (Ports: Abstract Interfaces)              │
│  ┌──────────┬──────────┬──────────┬──────────┐ │
│  │ Storage  │ Indexing │ Parsing  │ Observ.  │ │
│  │  Port    │   Port   │  Port    │  Port    │ │
│  └──────────┴──────────┴──────────┴──────────┘ │
└─────────────────┬───────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────┐
│              Domain Layer                        │
│         (Pure Business Logic)                    │
│  ┌──────────┬──────────┬──────────┬──────────┐ │
│  │ Anchors  │Retrieval │Validation│Invariants│ │
│  └──────────┴──────────┴──────────┴──────────┘ │
└─────────────────┬───────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────┐
│              Adapter Layer                       │
│        (Concrete Implementations)                │
│  ┌──────────┬──────────┬──────────────────────┐│
│  │ Memory   │  Orama   │   (Parsing TBD)      ││
│  │ Storage  │  Search  │                      ││
│  └──────────┴──────────┴──────────────────────┘│
└──────────────────────────────────────────────────┘
```

### Core Data Flow Patterns

The system operates through several key data flows, each carefully orchestrated to maintain consistency:

#### 1. Draft → Publish → Search Flow

```
Editor writes Draft → User publishes → Creates Version
                                           ↓
                                    Visibility Event
                                           ↓
                                    Index rebuilds
                                           ↓
                                    Search available
```

This flow ensures drafts never leak into search results. The visibility event acts as a transaction boundary – either a version is fully indexed and searchable, or it isn't visible at all.

#### 2. Query → Answer → Citation Flow

```
User Query → Search Engine → Retrieve Passages
                ↓
          Rank & Filter
                ↓
          Compose Answer
                ↓
          Attach Citations → Stable Anchors
```

Every answer is fully extractive – it only contains text that exists verbatim in your notes, with precise citations to the source passages.

#### 3. Version History & Rollback Flow

```
Current Version → User initiates rollback
                        ↓
                  Create NEW Version
                  (referencing target)
                        ↓
                  Visibility Event
                        ↓
                  Becomes searchable
```

Rollbacks never mutate history – they create new versions that reference previous states, maintaining the immutability guarantee.

### The Effect Pattern

Throughout the codebase, you'll see extensive use of the Effect library for handling async operations and errors:

```typescript
// Instead of throwing exceptions or using try/catch:
readonly getNote = (id: NoteId): Effect.Effect<Note, StorageError> =>
  Effect.sync(() => {
    const note = this.state.notes.get(id);
    if (!note) {
      throw new Error("Note not found");
    }
    return note;
  }).pipe(
    Effect.catchAll(() => storageError(notFound("Note", id)))
  );
```

Effect provides:

- Explicit error types in function signatures
- Composable error handling
- Dependency injection
- Controlled side effects

This pattern makes the system's behavior predictable and testable.

### Entity Identification Strategy

Every entity in the system uses opaque, prefixed ULIDs (Universally Unique Lexicographically Sortable Identifiers):

| Entity     | ID Format     | Example                           |
| ---------- | ------------- | --------------------------------- |
| Note       | `note_<ulid>` | `note_01JBXR8G9P7QN1VMPX84KTFHK2` |
| Version    | `ver_<ulid>`  | `ver_01JBXR8G9P7QN1VMPX84KTFHK2`  |
| Collection | `col_<ulid>`  | `col_01JBXR8G9P7QN1VMPX84KTFHK2`  |

ULIDs provide:

- Lexicographic sorting by creation time
- No coordination needed for generation
- Sufficient entropy to avoid collisions
- Human-readable prefixes for debugging

### The Anchor System

Perhaps the most sophisticated part of the architecture is the anchor system for stable citations:

```typescript
interface Anchor {
    structure_path: string; // "/heading1/heading2"
    token_offset: number; // Position in token stream
    token_length: number; // Number of tokens
    fingerprint: string; // Content hash
    tokenization_version: string;
    fingerprint_algo: string;
}
```

Anchors solve a fundamental problem: how do you maintain stable references to passages when content can change? The solution involves:

1. Normalizing content (Unicode NFC, consistent whitespace)
2. Tokenizing with stable boundaries
3. Fingerprinting token spans
4. Re-anchoring when content drifts

### Knowledge Check - Chapter 1

After reading this chapter, you should understand:

- The four-layer architecture (API → Service → Domain → Adapter)
- The three primary data flows (Draft→Publish, Query→Answer, Rollback)
- How Effect manages async operations and errors
- The ULID identification strategy and its benefits
- The anchor system's role in maintaining stable citations

---

## Chapter 2: Module Walkthrough

### Domain Layer Modules

The domain layer contains pure business logic with no external dependencies. Let's explore each module:

#### `domain/anchor.ts` - The Citation Foundation

This module implements the tokenization and anchoring logic that enables stable citations:

```typescript
// Core operations:
normalizeText(text: string) → string
tokenizeText(text: string) → TokenizationResult
createAnchor(content, path, offset, length) → Anchor
resolveAnchor(anchor, content) → AnchorResolution
```

The tokenization follows strict rules:

- Unicode normalization (NFC form)
- Whitespace collapsing (except in code blocks)
- UAX #29 word boundaries
- Deterministic token boundaries

When content changes, the module attempts re-anchoring through progressively weaker matching:

1. Exact fingerprint match at original position
2. Fingerprint match at nearby positions
3. Structure path matching with new fingerprint

#### `domain/retrieval.ts` - Search Result Processing

This module handles the deterministic ranking and deduplication of search results:

```typescript
// Key functions:
deduplicateResults(results: SearchResultItem[]) → unique results
sortSearchResults(results: SearchResultItem[]) → stable ordering
paginateResults(results: T[], params) → PaginatedResults<T>
applySloBackoff(latencyMs: number, config) → adjusted rerank window
```

The deduplication strategy is crucial: when the same note appears in multiple collections, we keep only the highest-scoring passage per (note_id, version_id) pair.

#### `domain/validation.ts` - Business Rule Enforcement

Before any operation succeeds, it must pass validation:

```typescript
validateNote(note: Note) → ValidationResult
validatePublicationReadiness(title, content, metadata, collections) → PublicationValidationResult
validateVersionTransition(current, new) → ValidationResult
```

Key validation rules:

- Title: 1-200 characters
- Tags: max 15, each 1-40 characters
- Content: max 1MB
- Collections: at least 1 required for publication

#### `domain/invariants.ts` - System Consistency Checks

This module verifies that the system maintains its core guarantees:

```typescript
checkDraftIsolationInvariant(); // Drafts never in search
checkVersionImmutabilityInvariant(); // Versions never change
checkAnchorStabilityInvariant(); // Anchors remain resolvable
checkIndexHealthInvariant(); // All published versions indexed
```

These invariants can be run as part of testing or health checks to ensure system integrity.

### Service Layer (Ports)

The service layer defines abstract interfaces that the domain depends on:

#### `services/storage.port.ts` - Persistence Interface

```typescript
interface StoragePort {
  // Note operations
  createNote(title, content, metadata) → Effect<Note, StorageError>
  saveDraft(request) → Effect<SaveDraftResponse, StorageError>

  // Version operations
  createVersion(noteId, content, metadata, label) → Effect<Version, StorageError>
  publishVersion(request) → Effect<PublishResponse, StorageError>

  // Transaction support
  withTransaction<A>(operation: Effect<A>) → Effect<A, StorageError>
}
```

The StoragePort abstracts all persistence operations, allowing different implementations (memory, SQLite, PostgreSQL) without changing business logic.

#### `services/indexing.port.ts` - Search Engine Interface

```typescript
interface IndexingPort {
  // Search operations
  search(request: SearchRequest) → Effect<SearchResponse, IndexingError>
  retrieveCandidates(query, collections, topK) → Effect<SearchResults[], IndexingError>

  // Index management
  buildIndex(corpusId: CorpusId) → Effect<Index, IndexingError>
  commitIndex(indexId: IndexId) → Effect<void, IndexingError>

  // Health monitoring
  performHealthCheck() → Effect<IndexHealthCheck, IndexingError>
}
```

The IndexingPort manages the search corpus and handles visibility events that make versions searchable.

### Adapter Layer

Adapters provide concrete implementations of the ports:

#### `adapters/storage/memory.adapter.ts` - In-Memory Storage

A simple but complete implementation using JavaScript Maps:

```typescript
class MemoryStorageAdapter implements StoragePort {
    private state: MemoryStorageState = {
        notes: new Map(),
        drafts: new Map(),
        versions: new Map(),
        collections: new Map(),
        // ...
    };

    // Implements all StoragePort methods
    // Perfect for development and testing
}
```

#### `adapters/search/orama.adapter.ts` - Full-Text Search

Uses the Orama library for in-memory search:

```typescript
class OramaSearchAdapter implements IndexingPort {
    private state: OramaAdapterState = {
        currentDb: null,
        currentCorpus: undefined,
        currentIndex: undefined,
        // ...
    };

    // Implements search and indexing operations
    // Handles visibility events and corpus updates
}
```

#### `adapters/api/elysia.adapter.ts` - REST API

Exposes the system through HTTP endpoints:

```typescript
// Key endpoints:
POST /drafts - Save draft content
POST /publish - Publish a version
POST /rollback - Rollback to previous version
GET /search - Search the corpus
GET /notes/:id/versions - List version history
POST /resolve-anchor - Resolve citation anchor
```

The API adapter also implements rate limiting and session management.

### Policy Modules

The policy layer defines configurable business rules:

#### `policy/publication.ts` - Publication Rules

```typescript
const PUBLICATION_POLICY = {
    TITLE_MIN_LENGTH: 1,
    TITLE_MAX_LENGTH: 200,
    MIN_COLLECTIONS: 1,
    MAX_COLLECTIONS: 10,
    MAX_TAGS: 15,
    TAG_MIN_LENGTH: 1,
    TAG_MAX_LENGTH: 40,
    MAX_CONTENT_LENGTH: 1_000_000,
};
```

#### `policy/retrieval.ts` - Search Configuration

```typescript
const RETRIEVAL_DEFAULTS = {
    topKRetrieve: 128, // Candidates to retrieve
    topKRerank: 64, // Candidates after reranking
    pageSize: 10, // Results per page
    rerankBackoff: {
        thresholdMs: 500,
        sessionTopKRerank: 32,
    },
};
```

### Knowledge Check - Chapter 2

After reading this chapter, you should understand:

- The responsibility of each domain module (anchor, retrieval, validation, invariants)
- How ports define abstract interfaces for external dependencies
- The role of adapters in providing concrete implementations
- How policy modules centralize configurable business rules
- The relationship between modules and data flow through the system

---

## Chapter 3: Tools, Libraries, and Dependencies

### Core Technology Stack

The Knowledge Repository is built on a modern TypeScript stack optimized for performance and developer experience:

#### Runtime & Framework

**Bun** serves as both the JavaScript runtime and build tool:

```json
{
    "runtime": "Bun v1.1.42",
    "why": "Native TypeScript support, fast startup, built-in testing"
}
```

Bun eliminates the need for separate build tools and provides:

- Direct TypeScript execution
- Built-in test runner
- Fast module resolution
- SQLite support (future use)

**Elysia** provides the HTTP server framework:

```typescript
new Elysia()
    .get("/health", () => ({ status: "ok" }))
    .post("/publish", async ({ body }) => {
        // Type-safe request handling
    });
```

Elysia offers:

- End-to-end type safety
- High performance (built for Bun)
- Elegant routing API
- Built-in validation

### Effect System

**Effect** is the most important library to understand – it fundamentally shapes how the entire system handles operations:

```typescript
// Traditional approach with exceptions:
async function getNote(id: string): Promise<Note> {
    const note = await db.query("SELECT ...");
    if (!note) throw new Error("Not found");
    return note;
}

// Effect approach with explicit error types:
const getNote = (id: NoteId): Effect.Effect<Note, StorageError> =>
    Effect.sync(() => {
        // ... implementation
    });
```

Effect provides several critical capabilities:

1. **Explicit Error Handling**: Every function signature declares what can go wrong
2. **Composability**: Chain operations without nested try/catch blocks
3. **Dependency Injection**: Wire up services without manual plumbing
4. **Resource Management**: Automatic cleanup of resources

Here's how Effect patterns appear throughout the codebase:

```typescript
// Chaining operations with automatic error handling:
const publishFlow = validatePublication(request).pipe(
    Effect.flatMap((valid) => createVersion(valid)),
    Effect.flatMap((version) => enqueueVisibilityEvent(version)),
    Effect.catchTag("ValidationError", (error) => Effect.fail(new PublicationError(error))),
);

// Running an Effect:
const result = await Effect.runPromise(publishFlow);
```

### Schema Validation

**@effect/schema** provides runtime type validation:

```typescript
const Note = Schema.Struct({
    id: NoteId,
    title: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(200)),
    metadata: NoteMetadata,
    created_at: Schema.Date,
    updated_at: Schema.Date,
});

// Validates unknown data at runtime:
const note = Schema.decodeUnknownSync(Note)(unknownData);
```

This ensures data consistency at system boundaries (API requests, database queries).

### Search Engine

**Orama** provides full-text search capabilities:

```typescript
import { create, insert, search } from "@orama/orama";

// Define searchable schema:
const db = await create({
    schema: {
        version_id: "string",
        content: "string",
        collection_ids: "string[]",
        created_at: "number",
    },
});

// Index documents:
await insert(db, document);

// Search with relevance scoring:
const results = await search(db, {
    term: "quantum computing",
    limit: 10,
});
```

Orama is chosen because it:

- Runs entirely in-memory (fast)
- Supports complex queries
- Provides relevance scoring
- Works in both Node and browser environments

### Text Processing

For tokenization, the system uses the **Intl.Segmenter** API:

```typescript
const segmenter = new Intl.Segmenter("en", {
    granularity: "word",
});

const segments = Array.from(segmenter.segment(normalizedText));

// Extract word-like segments:
const tokens = segments.filter((s) => s.isWordLike).map((s) => s.segment);
```

This provides Unicode-compliant word segmentation following UAX #29 standards.

### Cryptographic Operations

For fingerprinting anchors, the Web Crypto API is used:

```typescript
async function computeFingerprint(content: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(content);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);

    // Convert to hex string:
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}
```

### Identifier Generation

**ULID** (Universally Unique Lexicographically Sortable Identifier):

```typescript
import { ulid } from "ulid";

const noteId = `note_${ulid()}` as NoteId;
// Result: "note_01JBXR8G9P7QN1VMPX84KTFHK2"
```

ULIDs provide:

- Time-based sorting (first 48 bits encode timestamp)
- High entropy (80 bits of randomness)
- Compact encoding (26 characters)

### Development Dependencies

The development toolchain includes:

| Tool           | Purpose                       |
| -------------- | ----------------------------- |
| TypeScript 5.7 | Type checking and IDE support |
| Biome          | Fast linting and formatting   |
| Bun Test       | Unit testing framework        |

### Future Dependencies

The architecture anticipates several future integrations:

```typescript
// Planned: ElectricSQL for local-first sync
import { ElectricClient } from "electric-sql";

// Planned: Better SQLite for persistence
import Database from "better-sqlite3";

// Planned: Vector search for semantic retrieval
import { HNSWIndex } from "hnswlib-node";
```

### Dependency Injection Pattern

The system uses manual dependency injection to wire components:

```typescript
// Create implementations:
const storage = createMemoryStorageAdapter();
const indexing = createOramaSearchAdapter();
const parsing = createParsingAdapter();
const observability = createObservabilityAdapter();

// Wire into API:
const app = createApiAdapter({
    storage,
    indexing,
    parsing,
    observability,
});
```

This pattern allows easy testing with mock implementations and swapping adapters without changing business logic.

### Knowledge Check - Chapter 3

After reading this chapter, you should understand:

- Why Bun was chosen as the runtime and its key benefits
- How Effect transforms error handling and async operations
- The role of Schema in runtime validation
- How Orama provides full-text search capabilities
- The Unicode-compliant tokenization approach using Intl.Segmenter
- How ULIDs provide sortable, unique identifiers
- The dependency injection pattern used throughout the system

---

## Chapter 4: Example Flows

### Flow 1: Publishing a Note

Let's trace a complete publish operation from user action to searchable content. This flow demonstrates how the layers interact and how data transforms through the system.

```
User clicks "Publish" → API receives request → Validates → Creates Version → Indexes → Returns success
```

Here's the detailed walkthrough:

**Step 1: User Initiates Publication**

The user has been working on a draft about "Quantum Computing Basics" and decides to publish it to their "Physics" collection.

```typescript
// API receives POST /publish
{
  note_id: "note_01JBXR8G9P7QN1VMPX84KTFHK2",
  collections: ["col_01JBXR8G9P7QN1VMPX84KTFHK3"],
  label: "major",
  client_token: "pub_abc123"
}
```

**Step 2: Rate Limiting Check**

```typescript
// In elysia.adapter.ts:
const sessionContext = getOrCreateSession(headers["x-session-id"]);
checkRateLimit(sessionContext.rate_limiter, "mutation");
// Ensures max 1 mutation per 5 seconds
```

**Step 3: Validation Phase**

```typescript
// The request flows through validation:
const validationResult = validatePublication({
    title: note.title, // Must be 1-200 chars
    content_md: draft.body_md, // Must be < 1MB
    metadata: draft.metadata, // Tags validated
    target_collections: request.collections,
});

if (!validationResult.valid) {
    return ApiError(validationResult.errors);
}
```

**Step 4: Version Creation**

```typescript
// In storage adapter:
const version: Version = {
    id: `ver_${ulid()}`,
    note_id: request.note_id,
    content_md: draft.body_md,
    metadata: draft.metadata,
    content_hash: computeContentHash(draft.body_md),
    created_at: new Date(),
    parent_version_id: currentVersion?.id,
    label: request.label,
};

this.state.versions.set(version.id, version);
```

**Step 5: Visibility Event**

```typescript
// Event is created and enqueued:
const visibilityEvent: VisibilityEvent = {
    event_id: `evt_${Date.now()}`,
    timestamp: new Date(),
    schema_version: "1.0.0",
    type: "VisibilityEvent",
    version_id: version.id,
    op: "publish",
    collections: request.collections,
};

// Enqueue for async processing
await enqueueVisibilityEvent(visibilityEvent);
```

**Step 6: Index Update (Async)**

The indexing adapter processes the visibility event asynchronously:

```typescript
// In orama.adapter.ts:
async function processVisibilityEvent(event: VisibilityEvent) {
    // 1. Load version content
    const version = await storage.getVersion(event.version_id);

    // 2. Chunk into passages
    const chunks = await chunkContent(version.content_md);

    // 3. Index each passage
    for (const chunk of chunks) {
        await insert(this.state.currentDb, {
            version_id: event.version_id,
            passage_id: `pas_${ulid()}`,
            content: chunk.content,
            snippet: chunk.snippet,
            structure_path: chunk.structure_path,
            collection_ids: event.collections,
            token_offset: chunk.token_span.offset,
            token_length: chunk.token_span.length,
            created_at: Date.now(),
        });
    }

    // 4. Commit index
    return IndexUpdateCommitted(event.version_id);
}
```

**Step 7: Response to User**

```typescript
// API returns:
{
  version_id: "ver_01JBXR8G9P7QN1VMPX84KTFHK2",
  note_id: "note_01JBXR8G9P7QN1VMPX84KTFHK2",
  status: "version_created",
  estimated_searchable_in: 5000  // milliseconds
}
```

### Flow 2: Searching and Composing an Answer

Now let's trace a search query through the system:

**Step 1: User Searches**

```typescript
// GET /search?q=quantum+entanglement&collections=col_123
{
  q: "quantum entanglement",
  collections: ["col_01JBXR8G9P7QN1VMPX84KTFHK3"],
  page: 0,
  page_size: 10
}
```

**Step 2: Retrieval Phase**

```typescript
// In indexing adapter:
async function search(request: SearchRequest) {
    // 1. Retrieve candidates (top 128)
    const candidates = await search(this.state.currentDb, {
        term: request.q,
        limit: 128,
        where: {
            collection_ids: {
                containsAll: request.collections,
            },
        },
    });

    // 2. Convert to search results
    const searchResults = candidates.hits.map((hit) => ({
        note_id: hit.document.version_id.replace("ver_", "note_"),
        version_id: hit.document.version_id,
        passage_id: hit.document.passage_id,
        score: hit.score,
        snippet: hit.document.snippet,
        structure_path: hit.document.structure_path,
        collection_ids: hit.document.collection_ids,
    }));

    return searchResults;
}
```

**Step 3: Deduplication and Ranking**

```typescript
// In domain/retrieval.ts:
function processSearchResults(results: SearchResultItem[]) {
    // 1. Deduplicate by (note_id, version_id)
    const deduplicationMap = new Map();
    for (const item of results) {
        const key = `${item.note_id}:${item.version_id}`;
        const existing = deduplicationMap.get(key);

        // Keep highest scoring passage
        if (!existing || item.score > existing.score) {
            deduplicationMap.set(key, item);
        }
    }

    // 2. Sort with stable ordering
    const sorted = Array.from(deduplicationMap.values()).sort((a, b) => {
        if (a.score !== b.score) return b.score - a.score;
        if (a.version_id !== b.version_id) return a.version_id.localeCompare(b.version_id);
        return a.passage_id.localeCompare(b.passage_id);
    });

    // 3. Apply rerank limit (top 64)
    return sorted.slice(0, 64);
}
```

**Step 4: Answer Composition**

```typescript
// Compose extractive answer with citations:
async function composeAnswer(query: string, results: SearchResultItem[]) {
    const answer: Answer = {
        id: `ans_${ulid()}`,
        query_id: `qry_${ulid()}`,
        text: "",
        citations: [],
        composed_at: new Date(),
        coverage: { claims: 0, cited: 0 },
    };

    // Extract relevant sentences from top results
    for (const result of results.slice(0, 3)) {
        // Create citation anchor
        const citation: Citation = {
            id: `cit_${ulid()}`,
            answer_id: answer.id,
            version_id: result.version_id,
            anchor: {
                structure_path: result.structure_path,
                token_offset: result.token_offset,
                token_length: result.token_length,
                fingerprint: await computeFingerprint(result.snippet),
                tokenization_version: "1.0.0",
                fingerprint_algo: "sha256",
            },
            snippet: result.snippet,
            confidence: result.score,
        };

        answer.citations.push(citation.id);
        answer.text += `${result.snippet} [${citation.id}] `;
        answer.coverage.claims++;
        answer.coverage.cited++;
    }

    return answer;
}
```

**Step 5: Response**

```typescript
{
  answer: {
    text: "Quantum entanglement occurs when particles become correlated... [cit_123]",
    citations: ["cit_123", "cit_456"],
    coverage: { claims: 2, cited: 2 }
  },
  results: [
    {
      note_id: "note_abc",
      version_id: "ver_def",
      title: "Quantum Physics Fundamentals",
      snippet: "...entanglement occurs when...",
      score: 0.95
    }
  ],
  page: 0,
  total_count: 15
}
```

### Flow 3: Opening a Citation in Reading View

When a user clicks on a citation to see the source:

**Step 1: Citation Click**

```typescript
// POST /resolve-anchor
{
  version_id: "ver_01JBXR8G9P7QN1VMPX84KTFHK2",
  anchor: {
    structure_path: "/quantum-physics/entanglement",
    token_offset: 42,
    token_length: 15,
    fingerprint: "a3f5c2..."
  }
}
```

**Step 2: Anchor Resolution**

```typescript
// In domain/anchor.ts:
async function resolveAnchor(anchor: Anchor, content: string) {
    // 1. Normalize current content
    const normalized = normalizeText(content);
    const tokenization = tokenizeText(normalized);

    // 2. Try exact position match
    if (anchor.token_offset + anchor.token_length <= tokenization.tokens.length) {
        const currentFingerprint = await computeFingerprint(
            tokenization.tokens,
            anchor.token_offset,
            anchor.token_length,
        );

        if (currentFingerprint === anchor.fingerprint) {
            return {
                anchor,
                resolved: true,
                content: extractTokenSpan(tokenization.tokens, anchor),
            };
        }
    }

    // 3. Try re-anchoring nearby
    for (let delta = 1; delta <= 10; delta++) {
        for (const offset of [anchor.token_offset - delta, anchor.token_offset + delta]) {
            const fingerprint = await computeFingerprint(
                tokenization.tokens,
                offset,
                anchor.token_length,
            );

            if (fingerprint === anchor.fingerprint) {
                return {
                    anchor,
                    resolved: true,
                    content: extractTokenSpan(tokenization.tokens, {
                        ...anchor,
                        token_offset: offset,
                    }),
                    nearest_offset: offset,
                };
            }
        }
    }

    // 4. Failed to resolve
    return {
        anchor,
        resolved: false,
        error: "Content has changed beyond recognition",
    };
}
```

**Step 3: Highlighting**

```typescript
// Generate highlighted HTML for display:
function highlightPassage(content: string, anchor: Anchor, resolvedOffset: number) {
    const tokens = tokenizeText(content).tokens;
    const startToken = resolvedOffset;
    const endToken = resolvedOffset + anchor.token_length;

    let html = "";
    for (let i = 0; i < tokens.length; i++) {
        if (i === startToken) {
            html += '<mark class="citation-highlight">';
        }
        html += escapeHtml(tokens[i]) + " ";
        if (i === endToken - 1) {
            html += "</mark>";
        }
    }

    return html;
}
```

**Step 4: Response with Context**

```typescript
{
  resolved: true,
  content: "particles become correlated in such a way that the quantum state of each particle cannot be described independently",
  highlighted_range: {
    start_offset: 42,
    end_offset: 57
  },
  context: {
    heading_trail: ["Quantum Physics", "Entanglement"],
    previous_section: "Classical physics assumes...",
    next_section: "The EPR paradox demonstrates..."
  }
}
```

### Flow 4: Version Rollback

When a user wants to restore a previous version:

**Step 1: Initiate Rollback**

```typescript
// POST /rollback
{
  note_id: "note_01JBXR8G9P7QN1VMPX84KTFHK2",
  target_version_id: "ver_01JBXR8G9P7QN1VMPX84KTFHK0",  // older version
  client_token: "rollback_xyz789"
}
```

**Step 2: Create New Version**

The key insight: rollback doesn't modify history, it creates new history:

```typescript
// In storage adapter:
async function rollbackToVersion(request: RollbackRequest) {
    // 1. Load target version
    const targetVersion = await getVersion(request.target_version_id);

    // 2. Create NEW version with target's content
    const newVersion: Version = {
        id: `ver_${ulid()}`,
        note_id: request.note_id,
        content_md: targetVersion.content_md, // Copy content
        metadata: targetVersion.metadata, // Copy metadata
        content_hash: targetVersion.content_hash,
        created_at: new Date(), // New timestamp
        parent_version_id: getCurrentVersion(request.note_id).id,
        label: "minor", // Rollbacks are minor by convention
    };

    // 3. Save new version
    this.state.versions.set(newVersion.id, newVersion);

    // 4. Update note's current version
    const note = this.state.notes.get(request.note_id);
    note.current_version_id = newVersion.id;
    note.updated_at = new Date();

    // 5. Trigger visibility
    await enqueueVisibilityEvent({
        version_id: newVersion.id,
        op: "rollback",
        collections: getCollectionsForNote(request.note_id),
    });

    return {
        new_version_id: newVersion.id,
        note_id: request.note_id,
        target_version_id: request.target_version_id,
        status: "version_created",
    };
}
```

The version history now shows:

```
v4 (current) - "Rolled back to v2" - content identical to v2
v3 - "Major rewrite"
v2 - "Fixed typos" - rollback target
v1 - "Initial version"
```

### Knowledge Check - Chapter 4

After reading this chapter, you should understand:

- How a publish operation flows from API through validation to indexing
- The multi-stage process of search, retrieval, and answer composition
- How anchors enable stable citations even when content changes
- Why rollback creates new versions rather than modifying history
- The asynchronous nature of indexing and its eventual consistency model
- How deduplication and deterministic ranking ensure consistent search results

---

## Summary: Bringing It All Together

We've journeyed from the high-level problem space down to the detailed flows that make the Knowledge Repository work. The system elegantly solves a complex problem – turning personal notes into a searchable, citable knowledge base – through careful architecture and attention to detail.

The key insights to remember:

1. **Separation of Concerns**: The layered architecture keeps business logic pure and testable, with effects and I/O pushed to the boundaries.

2. **Immutability as a Feature**: Versions are never modified, only created. This provides perfect history and enables confident experimentation.

3. **Deterministic Behavior**: From tokenization to search ranking, the system avoids randomness to ensure reproducible results.

4. **Citation Stability**: The sophisticated anchor system maintains references even as content evolves, crucial for a knowledge management system.

5. **Performance Through Design**: Meeting sub-second search latency requires careful choices at every layer, from in-memory indexing to efficient deduplication.

The elegance of this system lies not in any single clever technique, but in how all the pieces fit together to create something greater than the sum of its parts – a true knowledge repository that respects both the permanence and evolution of human thought.
