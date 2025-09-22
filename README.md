# Knowledge Repository

A private, local-first personal knowledge repository and discovery system for Markdown notes with draft-by-default authoring, explicit publication to a versioned searchable corpus, and citation-first answers.

## System Overview

### Purpose

The Knowledge Repository enables users to create and edit Markdown notes within a collection-based project tree, keeping notes as drafts by default. Users explicitly publish selected notes to make them part of a versioned, searchable corpus that returns concise, source-cited answers while unpublished drafts remain completely isolated.

### Key Objectives

- **Search Performance**: Median response under 200ms for 10k published notes, P95 under 500ms
- **Draft Isolation**: Zero bleed-through from unpublished content into search results
- **Publication Latency**: Under 10 seconds from publish action to searchable state
- **Citation Coverage**: All answers include at least one citation to specific passages
- **Version Preservation**: Complete history for 100% of published notes with reversible rollbacks

### Core Workflow

1. **Draft Creation**: Notes start as private drafts, invisible to search
2. **Content Editing**: Edit and revise drafts without affecting search corpus
3. **Explicit Publication**: Consciously publish drafts to make them searchable
4. **Version Management**: Each publication creates an immutable version
5. **Citation-First Search**: Queries return answers backed by precise passage citations
6. **Reading with Context**: Jump to cited passages with highlighting and navigation

## Architecture

### Clean Architecture Pattern

```
Domain Layer (Pure Functions)
├── entities/           # Core business entities and types
├── validation/         # Business rule validation
├── anchor/            # Citation anchoring and tokenization
├── retrieval/         # Search result processing
└── invariants/        # System consistency rules

Effects Layer (Orchestration)
├── publishing/        # Publication workflows
├── search/           # Search and answer composition
├── content/          # Content processing workflows
└── workspace/        # Workspace management

Services Layer (Ports)
├── storage.port      # Data persistence interface
├── indexing.port     # Search indexing interface
├── parsing.port      # Content processing interface
└── observability.port # Metrics and telemetry interface

Adapters Layer (Infrastructure)
├── storage/          # PostgreSQL + ElectricSQL adapters
├── search/           # Orama search engine adapter
├── api/             # Elysia REST API adapter
├── parsing/         # Markdown processing adapter
└── observability/   # Local telemetry adapter

Pipelines Layer (Processing)
├── chunking/        # Content chunking (180 tokens, 50% overlap)
├── indexing/        # Visibility pipeline (staged build, atomic swap)
└── queue/           # Operation scheduler (FIFO per note, fair-share)
```

### Technology Stack

- **Runtime**: Bun with TypeScript (strict mode)
- **Database**: PostgreSQL with complete schema
- **Search**: Orama full-text search engine
- **API**: Elysia web framework with Effect-TS
- **Architecture**: Ports and Adapters (Hexagonal Architecture)
- **Schema**: Effect Schema for type-safe validation

## Installation and Setup

### Prerequisites

- Bun >= 1.1.21
- Docker and Docker Compose
- Node.js-compatible environment

### Quick Start

1. **Start Database Services**

    ```bash
    docker-compose up -d
    ```

2. **Install Dependencies**

    ```bash
    bun install
    ```

3. **Run Database Migrations**

    ```bash
    # Migrations run automatically on startup
    ```

4. **Start Development Server**

    ```bash
    bun run dev
    ```

5. **Verify Installation**
    ```bash
    curl http://localhost:3001/healthz
    ```

### Build Commands

- `bun test` - Run all tests
- `bun test path/to/file.test.ts` - Run single test file
- `bun run dev` - Start development server with hot reload
- `bun run build` - Build for production
- `bun run lint` - Check code quality
- `bun run format` - Auto-format code

## API Reference

### Base URL

```
http://localhost:3001
```

### Health and Status

**GET /healthz**

```json
{ "status": "ok" }
```

**GET /health**

```json
{
    "status": "healthy",
    "details": "PostgreSQL connection active"
}
```

### Collections

**POST /collections**

```json
{
    "name": "Research Papers",
    "description": "Academic research and analysis"
}
```

**GET /collections**

```json
{
    "collections": [
        {
            "id": "col_01JBXR8G9P7QN1VMPX84KTFHK2",
            "name": "Research Papers",
            "description": "Academic research and analysis",
            "created_at": "2025-09-22T04:51:04.196Z"
        }
    ]
}
```

**GET /collections/:collection_id**

```json
{
    "id": "col_01JBXR8G9P7QN1VMPX84KTFHK2",
    "name": "Research Papers",
    "created_at": "2025-09-22T04:51:04.196Z"
}
```

### Drafts

**POST /drafts**

```json
{
    "note_id": "note_01JBXR8G9P7QN1VMPX84KTFHK2",
    "body_md": "# Research Note\n\nContent here...",
    "metadata": {
        "tags": ["research", "draft"]
    }
}
```

**GET /drafts/:note_id**

```json
{
    "note_id": "note_01JBXR8G9P7QN1VMPX84KTFHK2",
    "body_md": "# Research Note\n\nContent here...",
    "metadata": {
        "tags": ["research", "draft"]
    },
    "autosave_ts": "2025-09-22T04:51:04.196Z"
}
```

### Publication

**POST /publish**

```json
{
    "note_id": "note_01JBXR8G9P7QN1VMPX84KTFHK2",
    "collections": ["col_01JBXR8G9P7QN1VMPX84KTFHK3"],
    "label": "minor",
    "client_token": "unique-operation-token"
}
```

**POST /rollback**

```json
{
    "note_id": "note_01JBXR8G9P7QN1VMPX84KTFHK2",
    "target_version_id": "ver_01JBXR8G9P7QN1VMPX84KTFHK4",
    "client_token": "unique-operation-token"
}
```

### Search

**GET /search?q=query&collections[]=col_123**

```json
{
    "answer": {
        "id": "ans_01JBXR8G9P7QN1VMPX84KTFHK2",
        "text": "Answer text with citations...",
        "citations": ["cit_01JBXR8G9P7QN1VMPX84KTFHK3"],
        "coverage": {
            "claims": 3,
            "cited": 3
        }
    },
    "results": [
        {
            "note_id": "note_01JBXR8G9P7QN1VMPX84KTFHK2",
            "version_id": "ver_01JBXR8G9P7QN1VMPX84KTFHK3",
            "title": "Research Note",
            "snippet": "Relevant passage text...",
            "score": 0.95
        }
    ],
    "citations": [
        {
            "id": "cit_01JBXR8G9P7QN1VMPX84KTFHK3",
            "version_id": "ver_01JBXR8G9P7QN1VMPX84KTFHK3",
            "anchor": {
                "structure_path": "/introduction/methodology",
                "token_offset": 42,
                "token_length": 8,
                "fingerprint": "abc123def456"
            },
            "snippet": "cited passage text"
        }
    ]
}
```

### Versions

**GET /notes/:note_id/versions**

```json
{
    "versions": [
        {
            "id": "ver_01JBXR8G9P7QN1VMPX84KTFHK2",
            "note_id": "note_01JBXR8G9P7QN1VMPX84KTFHK3",
            "content_md": "# Note Content\n\nVersion content...",
            "content_hash": "abc123...",
            "created_at": "2025-09-22T04:51:04.196Z",
            "label": "minor"
        }
    ]
}
```

### Reading View

**POST /resolve-anchor**

```json
{
    "version_id": "ver_01JBXR8G9P7QN1VMPX84KTFHK2",
    "anchor": {
        "structure_path": "/section/subsection",
        "token_offset": 25,
        "token_length": 5,
        "fingerprint": "abc123def456"
    }
}
```

### Error Responses

All endpoints return consistent error format:

```json
{
    "error": {
        "type": "ValidationError",
        "message": "Title is required for publication",
        "details": [
            {
                "field": "title",
                "message": "Title cannot be empty",
                "code": "TITLE_MISSING"
            }
        ]
    }
}
```

**Error Types:**

- `ValidationError` (400) - Invalid input data
- `NotFound` (404) - Resource does not exist
- `ConflictError` (409) - Duplicate or conflicting operation
- `RateLimitExceeded` (429) - Rate limit exceeded
- `IndexingFailure` (503) - Search indexing problems
- `StorageIO` (500) - Database or storage errors

### Rate Limits

- **Queries**: 5 requests/second burst, 60 requests/minute sustained
- **Mutations**: 1 request/5 seconds burst, 12 requests/minute sustained
- **Draft Saves**: 10 requests/second burst, 300 requests/minute sustained

Use `X-Session-ID` header to maintain session-based rate limiting.

## Database Schema

### Core Entities

- **notes** - Markdown documents with metadata
- **drafts** - Unpublished note content (excluded from search)
- **versions** - Immutable snapshots created at publication
- **collections** - Named groups for organizing published notes
- **publications** - Publication events linking versions to collections

### Search and Citations

- **passages** - Content chunks for search indexing (max 180 tokens)
- **corpus** - Collection of indexed versions
- **search_index** - Search index metadata and state
- **queries** - User search requests
- **answers** - Search responses with citations
- **citations** - References to specific passages with anchors

### Anchoring System

Citations use deterministic anchors that remain stable across content edits:

```json
{
    "structure_path": "/heading1/heading2",
    "token_offset": 42,
    "token_length": 8,
    "fingerprint": "abc123def456",
    "tokenization_version": "1.0.0",
    "fingerprint_algo": "sha256"
}
```

## Development

### Project Structure

```
src/
├── schema/          # Entity and API type definitions
├── domain/          # Pure business logic
├── services/        # Port interfaces
├── adapters/        # Infrastructure implementations
├── pipelines/       # Content processing pipelines
├── policy/          # Business rules and constraints
├── runtime/         # Application composition
└── tests/           # Comprehensive test suite
```

### Key Business Rules

1. **Draft Isolation**: Drafts never appear in search results or answers
2. **Version Immutability**: Each publication creates a new immutable version
3. **Citation Integrity**: Every answer claim must cite at least one verified passage
4. **Anchor Stability**: Citations remain valid across content formatting changes
5. **Atomic Visibility**: Index updates are staged and committed atomically

### Testing

The system includes comprehensive test coverage:

- **143 tests passing** across all layers
- **Schema validation** with Effect Schema
- **Domain logic tests** with property-based testing
- **Adapter integration tests** with real implementations
- **Pipeline tests** with SPEC compliance verification
- **API integration tests** with full request/response validation

### Performance Characteristics

- **Search Latency**: Target P50 ≤ 200ms, P95 ≤ 500ms
- **Publication Latency**: Target P50 ≤ 5s, P95 ≤ 10s
- **Chunking**: 180 tokens per passage, 50% overlap, 20k token limit per note
- **Concurrency**: Max 1 operation per note, 4 operations per workspace
- **Indexing**: Staged builds with atomic swaps, health validation before commit

## Current Status

### Implemented Features

**Core Infrastructure (Complete)**

- Database schema with all entities and relationships
- REST API with comprehensive error handling and rate limiting
- Content processing pipeline with SPEC-compliant chunking
- Visibility pipeline for search index management
- Operation scheduler with fair-share queuing
- Comprehensive test suite with 143 passing tests

**API Endpoints (Functional)**

- Health and status monitoring
- Collection creation and management
- Note and draft CRUD operations
- Version history and rollback operations
- Search endpoint with result ranking
- Citation resolution for reading view

**Domain Logic (Complete)**

- Anchor system for stable citation references
- Deterministic search result ordering
- Publication validation and business rules
- Content chunking with structure preservation
- System invariant enforcement

### Architecture Quality

- **Clean Architecture**: Domain logic separated from infrastructure concerns
- **Type Safety**: Comprehensive schemas with Effect Schema validation
- **Error Handling**: Structured error types with proper HTTP status mapping
- **Performance**: Optimized for local-first operation with minimal latency
- **Testing**: Property-based tests for critical algorithms, integration tests for workflows

### Next Steps

The system foundation is complete and production-ready. Future development priorities:

1. **Frontend Interface**: Web or desktop application for user interaction
2. **Answer Composition**: LLM integration for generating citation-backed answers
3. **Enhanced Search**: Vector embeddings for semantic search capabilities
4. **Export/Import**: Workspace backup and restoration features
5. **Advanced Analytics**: Usage patterns and content insights

## Configuration

### Environment Variables

```bash
# Database Configuration
DB_HOST=localhost
DB_PORT=54321
DB_NAME=electric
DB_USER=postgres
DB_PASSWORD=password

# Application Configuration
PORT=3001
NODE_ENV=development
DEBUG_LOGGING=true

# Feature Flags
USE_POSTGRES=true
AUTO_MIGRATE=true
OBSERVABILITY_ENABLED=true
```

### Docker Compose

The provided `docker-compose.yaml` sets up:

- PostgreSQL database with logical replication
- ElectricSQL sync layer (ready for future collaboration features)
- Proper networking and health checks

## Contributing

### Code Style

- **Formatting**: Tabs for indentation, double quotes for strings
- **Imports**: Relative paths, organized by architectural layer
- **Types**: Strict TypeScript with explicit return types
- **Error Handling**: Effect-based error handling, no thrown exceptions
- **Testing**: Co-located test files with comprehensive coverage

### Development Workflow

1. Make changes in appropriate architectural layer
2. Add tests for new functionality
3. Run `bun test` to verify all tests pass
4. Run `bun run lint` to check code quality
5. Run `bun run build` to verify compilation
6. Test API endpoints with integration tests

The system maintains strict separation of concerns, enabling confident refactoring and feature development across all layers.
