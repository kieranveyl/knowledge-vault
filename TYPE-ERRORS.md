# Type Errors Report

## Critical Errors (Prevent Compilation)

### HTTP Status Code Type Mismatch

**File**: src/adapters/api/elysia.adapter.ts
**Functions**: `handlePublish`, `handleRollback`, `handleIndexStatus`, `handleSearch`, `handleAnswer`, `handleGetNote`, `handleGetVersion`, `handleGetDraft`
**Error**: The code is trying to use HTTP status codes as string names (like "OK" or "Created") when the Elysia framework expects numeric status codes (like 200 or 201). TypeScript is correctly flagging this as incompatible because string values can't be used where numbers are required.

### Empty Collections Array in Visibility Events

**File**: src/adapters/api/elysia.adapter.ts
**Function**: `handleRollback`
**Error**: When creating a rollback event, the code passes an empty array for `collections`, but the system requires at least one collection ID. The type system expects a non-empty array (a tuple with at least one element), but gets an empty array instead.

### Missing 'message' Property on Error Objects

**File**: src/adapters/api/elysia.adapter.ts
**Functions**: `handlePublish`, `handleRollback`
**Error**: The code tries to access a `.message` property on error objects, but some possible error types (specifically `ElysiaCustomStatusResponse`) don't have this property. This could cause runtime errors when trying to access a property that doesn't exist.

### Type-Only Imports Used as Values

**File**: src/adapters/observability/local.adapter.ts
**Functions**: Multiple metric and event handling functions
**Error**: The code imports `METRIC_NAMES` and `EVENT_TYPES` using `import type`, which means they're only available during type checking, not at runtime. But the code tries to use these as actual values in the implementation, which TypeScript correctly flags as an error.

### Readonly Array Mutation Attempts

**File**: src/adapters/parsing/markdown.adapter.ts
**Functions**: `extractCodeBlocks`, `extractHeadings`, `extractImages`, `extractLinks`
**Error**: The code tries to use `.push()` on arrays that are declared as readonly. Readonly arrays cannot be modified, so attempting to add elements with `.push()` will fail at runtime.

### Missing Interface Implementation

**File**: src/adapters/search/orama.adapter.stub.ts
**Class**: `OramaSearchAdapter`
**Error**: The `OramaSearchAdapter` class claims to implement the `IndexingPort` interface but is missing the required `indexVersion` method. This breaks the contract expected by the rest of the system.

### Generator Function Signature Issues

**File**: src/runtime/layers.ts
**Functions**: Database and service layer providers
**Error**: Several functions that should be generator functions (using Effect's dependency injection system) are missing the proper iterator signature. This breaks the dependency injection system that relies on these being generator functions.

## High Severity Errors

### Schema Definition Mismatch

**File**: src/adapters/search/orama.adapter.stub.ts
**Function**: `createOramaIndex`
**Error**: The schema definition for search indexing uses string values for fields like `token_offset` and `token_length`, but the Orama library expects these to be numbers or other specific types.

### Missing Required Properties in Search Results

**File**: src/adapters/search/orama.adapter.ts
**Function**: `search`
**Error**: The search results object is missing the required `citations` property that the rest of the system expects. Instead, it provides `results` which isn't compatible with the expected structure.

### Incorrect Error Type Narrowing

**File**: src/adapters/storage/postgres.adapter.ts
**Functions**: Multiple database operation handlers
**Error**: The code passes `StorageError | DatabaseError` where only `DatabaseError` is expected. These error types have different structures - `StorageError` has a `_tag` property like "NotFound" while `DatabaseError` requires a `reason` property.

## Medium Severity Errors

### Possibly Undefined Value Access

**File**: src/adapters/storage/memory.adapter.ts
**Functions**: `getDraft`, `rollbackDraft`
**Error**: The code accesses properties on `draft` and `targetVersion` without checking if they're undefined first, which could cause runtime errors.

### Array Length Requirements Not Met

**File**: src/adapters/search/orama.adapter.ts
**Function**: `composeAnswer`
**Error**: The code tries to use a regular array where a non-empty array (with at least one element) is required by the type system.

### Incomplete Configuration Objects

**File**: src/adapters/parsing/markdown.adapter.ts
**Functions**: `chunkMarkdown`, `chunkMarkdownForVersion`
**Error**: The code passes a `ChunkingConfig` object that's missing required properties like `maxTokensPerPassage`, `overlapTokens`, and others that are defined in the expected configuration type.

### Duplicate Function Declarations

**File**: src/pipelines/indexing/visibility.ts
**Functions**: `processOperationAsync`, `buildIndexSegment`, `validateIndexHealth`
**Error**: These function names are declared multiple times in the same file, which causes naming conflicts.

## Lower Severity Errors

### Policy Configuration Mismatches

**File**: src/policy/retrieval.ts
**Function**: N/A (configuration file)
**Error**: The `stableSort` configuration uses a generic string array, but the system expects a specific array with exactly the values "score", "version_id", and "passage_id" in that order.

### Brand Type Mismatches in Tests

**File**: Multiple test files (src/tests/domain.\*.test.ts)
**Functions**: Various test assertions
**Error**: The tests use plain numbers and strings where branded types (like `TokenOffset` or `PassageId`) are required. For example, using `123` where `123 & Brand<"TokenOffset">` is expected.

### Incorrect instanceof Checks

**File**: src/adapters/parsing/markdown.adapter.ts, src/adapters/search/orama.adapter.ts
**Functions**: Multiple error handling blocks
**Error**: The code tries to use `instanceof` checks on types that aren't actual classes (like union types), which won't work at runtime.

### Missing Type Definitions

**File**: src/services/parsing.port.ts
**Function**: N/A (type definitions)
**Error**: The code references `VersionId` type which isn't properly imported or defined in this file.

### Effect Type Mismatches

**File**: Multiple files across the project
**Functions**: Various Effect-based operations
**Error**: Several functions return `Effect<void>` where `Effect<never>` is expected, or have incompatible error types in their Effect signatures.
