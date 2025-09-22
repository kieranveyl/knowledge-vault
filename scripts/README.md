# Knowledge Repository Demo Scripts

This directory contains comprehensive demo scripts that showcase the complete functionality of the Knowledge Repository system according to the SPEC.md requirements.

## Quick Start

```bash
# Run complete end-to-end demo
bun scripts/demo-workflow.ts

# Or run individual demos
bun scripts/create-draft.ts
bun scripts/manage-collections.ts
bun scripts/publish-note.ts
bun scripts/version-history.ts
bun scripts/search-notes.ts
```

## Prerequisites

1. **Database Setup**

    ```bash
    docker-compose up -d  # Start PostgreSQL
    bun scripts/migrate.ts  # Apply schema migrations
    ```

2. **Dependencies**
    ```bash
    bun install  # Install all dependencies
    ```

## Script Overview

### [ARCH] Infrastructure Scripts

#### `migrate.ts`

- **Purpose**: Database schema setup and migrations
- **Usage**: `bun scripts/migrate.ts`
- **Features**: Applies migration files, creates tables, sets up constraints

### [SPEC] Core Workflow Scripts

#### `create-draft.ts`

- **Purpose**: Demonstrates draft-by-default authoring workflow
- **SPEC Reference**: Section 4 (Editor ↔ Store contract)
- **Features**:
    - Note creation with initial content
    - Draft saving with autosave timestamps
    - Rich metadata support
    - Multiple autosave iterations
- **Key Concepts**: Draft isolation, autosave behavior, markdown content

#### `manage-collections.ts`

- **Purpose**: Collection management and organization
- **SPEC Reference**: Section 3 (Collection entity)
- **Features**:
    - Collection creation with unique names
    - Collection CRUD operations
    - Name uniqueness constraint validation
    - Collection retrieval by name and ID
- **Key Concepts**: Workspace organization, many-to-many relationships

#### `publish-note.ts`

- **Purpose**: Two-phase publication workflow demonstration
- **SPEC Reference**: Section 4 (Two-phase publish), Section 5 (Publish/Republish)
- **Features**:
    - Draft validation and preparation
    - Version creation with content hashing
    - Publication to multiple collections
    - Version labeling (minor/major)
    - Publication metadata tracking
- **Key Concepts**: Version immutability, publication workflow, collection associations

#### `version-history.ts`

- **Purpose**: Version control and rollback functionality
- **SPEC Reference**: Section 5 (Rollback), Section 2 (Version entity)
- **Features**:
    - Multiple version creation (v1.0 → v1.1 → v2.0)
    - Complete version history tracking
    - Rollback workflow (creates new version referencing target)
    - Parent-child version relationships
    - Version metadata comparison
- **Key Concepts**: Version immutability, rollback safety, audit trails

#### `search-notes.ts`

- **Purpose**: Search and discovery functionality demonstration
- **SPEC Reference**: Section 4 (Search ↔ Reader contract), Section 5 (Search & Answer Composition)
- **Status**: 🟡 Implementation pending (shows expected workflow)
- **Features**:
    - Query processing with collection scoping
    - SPEC-compliant retrieval pipeline (top_k_retrieve = 128)
    - Reranking and deduplication (top_k_rerank = 64)
    - Answer composition with citations
    - Citation anchor resolution
- **Key Concepts**: Fully extractive answers, citation-first results, performance SLOs

### === Integration Scripts

#### `demo-workflow.ts`

- **Purpose**: Complete end-to-end system demonstration
- **Usage**: `bun scripts/demo-workflow.ts`
- **Features**:
    - Runs all core workflows in sequence
    - System-wide validation and testing
    - Performance measurement
    - SPEC compliance verification
    - Architecture validation
- **Output**: Comprehensive system status report

## SPEC Compliance Matrix

| SPEC Section               | Script                                     | Implementation Status | Key Features                              |
| -------------------------- | ------------------------------------------ | --------------------- | ----------------------------------------- |
| Section 1: System Overview | `demo-workflow.ts`                         | [OK] Complete         | Draft-by-default, version preservation    |
| Section 2: Ontology        | `create-draft.ts`, `manage-collections.ts` | [OK] Complete         | Core entities, relationships, identifiers |
| Section 3: Data Model      | `publish-note.ts`                          | [OK] Complete         | Schema implementation, content hashing    |
| Section 4: Interfaces      | All scripts                                | [TARGET] Partial      | Editor↔Store complete, Search pending    |
| Section 5: Behavior        | `version-history.ts`, `publish-note.ts`    | [OK] Complete         | Two-phase publish, rollback workflow      |

## Performance Targets

The scripts demonstrate adherence to SPEC performance requirements:

- **Search Latency**: P50 ≤ 200ms, P95 ≤ 500ms (target defined, measurement pending)
- **Publish→Searchable**: P50 ≤ 5s, P95 ≤ 10s (workflow implemented, indexing pending)
- **Version Creation**: Sub-second for typical content (achieved)

## Expected Output

Each script provides:

1. **Step-by-step execution** with clear progress indicators
2. **SPEC compliance verification** against requirements
3. **Technical validation** of implementation details
4. **Performance metrics** where applicable
5. **Next steps guidance** for continued development

## Error Handling

Scripts include comprehensive error handling:

- Database connection validation
- Migration status checking
- Proper cleanup on failure
- Clear error messages with troubleshooting steps

## Development Workflow

### For Testing Individual Components

```bash
# Test draft functionality
bun scripts/create-draft.ts

# Test collection management
bun scripts/manage-collections.ts

# Test publication workflow
bun scripts/publish-note.ts
```

### For System Integration Testing

```bash
# Complete end-to-end validation
bun scripts/demo-workflow.ts
```

### For Database Management

```bash
# Apply migrations
bun scripts/migrate.ts

# Reset database (if needed)
docker-compose down
docker-compose up -d
bun scripts/migrate.ts
```

## Implementation Status

### [OK] Fully Implemented

- Draft creation and management
- Collection operations
- Publication workflow
- Version control and rollback
- Database integration
- API error handling

### [TARGET] Partially Implemented

- Search functionality (interface defined, implementation pending)
- Indexing pipeline (architecture ready, implementation pending)
- Performance monitoring (targets defined, measurement pending)

### [ERR] Not Yet Implemented

- Session management and replay
- Snapshot and export functionality
- Real-time search indexing
- Answer composition with citations

## Next Phase Development

These scripts provide the foundation for Phase 2 development:

1. **Search Implementation**: Use `search-notes.ts` as specification for Orama adapter
2. **Indexing Pipeline**: Implement visibility → corpus → index workflow
3. **Performance Optimization**: Add measurement and optimization based on SPEC targets
4. **Session Management**: Extend scripts to include session tracking and replay

## Troubleshooting

### Common Issues

1. **Database Connection Failed**

    ```bash
    docker-compose up -d
    # Wait for PostgreSQL to be ready
    bun scripts/migrate.ts
    ```

2. **Migration Errors**

    ```bash
    # Check database logs
    docker-compose logs postgres

    # Reset if needed
    docker-compose down
    docker volume rm knowledge-repository_postgres_data
    docker-compose up -d
    ```

3. **Import/Module Errors**
    ```bash
    bun install  # Reinstall dependencies
    ```

### Script-Specific Issues

- **create-draft.ts**: Ensure collections exist (run `manage-collections.ts` first)
- **publish-note.ts**: Requires existing collections for publication
- **search-notes.ts**: Shows expected behavior (search implementation pending)
- **demo-workflow.ts**: Requires clean database state for full execution

---

**Note**: These scripts are designed to be both educational and functional, providing clear examples of how to use the Knowledge Repository system while validating SPEC compliance at every step.
