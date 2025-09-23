# Knowledge Repository Client — TypeScript Specification

This document specifies the conceptual and contractual behavior of a TypeScript client for the Knowledge Repository system. It combines high-level explanations with complete TypeScript code examples derived from the API implementation.

## 1. System Context

The system allows a user to author, publish, and retrieve Markdown-based knowledge. The core domain objects are `Note`, `Draft`, `Version`, `Collection`, and `Publication`.

- A `Note` is the central entity for a piece of knowledge, identified by a `NoteId`.
- A `Note` can have at most one `Draft`, which is its mutable, unpublished state. Drafts are never visible in search results.
- When a `Draft` is published, an immutable `Version` is created. A `Note` can have many `Versions`, forming a history.
- `Collection`s are used to group `Note`s. A `Note` can belong to multiple `Collection`s.
- A `Publication` is a record that makes a specific `Version` visible in one or more `Collection`s.
- Search queries are scoped to `Collection`s and return `Answer`s, which are extractive summaries backed by `Citation`s that point to specific `Anchor`s within a `Version`.

All entities are identified by opaque, ULID-based, prefixed strings for type safety.

```typescript
/**
 * All entities use opaque, ULID-based, prefixed identifiers for type safety.
 * These can be represented as branded types in TypeScript.
 */
export type NoteId = string & { readonly __brand: "NoteId" };
export type CollectionId = string & { readonly __brand: "CollectionId" };
export type VersionId = string & { readonly __brand: "VersionId" };
export type DraftId = NoteId; // Drafts are identified by their parent NoteId
export type PublicationId = string & { readonly __brand: "PublicationId" };
export type QueryId = string & { readonly __brand: "QueryId" };
export type AnswerId = string & { readonly __brand: "AnswerId" };
export type CitationId = string & { readonly __brand: "CitationId" };
export type SessionId = string & { readonly __brand: "SessionId" };
export type SnapshotId = string & { readonly __brand: "SnapshotId" };
export type PassageId = string & { readonly __brand: "PassageId" };
```

## 2. Type Definitions

The following TypeScript interfaces define the data structures used in the client, derived directly from the API's schemas.

### Identifier & Primitive Types

```typescript
export type ContentHash = string & { readonly __brand: "ContentHash" };
export type VersionLabel = "minor" | "major";
export type ClientToken = string & { readonly __brand: "ClientToken" };
```

### Core Domain Entities

```typescript
export interface NoteMetadata {
    readonly tags?: readonly string[];
}

export interface Note {
    readonly id: NoteId;
    readonly title: string;
    readonly metadata: NoteMetadata;
    readonly created_at: Date;
    readonly updated_at: Date;
    readonly current_version_id?: VersionId;
}

export interface Draft {
    readonly note_id: NoteId;
    readonly body_md: string;
    readonly metadata: NoteMetadata;
    readonly autosave_ts: Date;
}

export interface Version {
    readonly id: VersionId;
    readonly note_id: NoteId;
    readonly content_md: string;
    readonly metadata: NoteMetadata;
    readonly content_hash: ContentHash;
    readonly created_at: Date;
    readonly parent_version_id?: VersionId;
    readonly label: VersionLabel;
}

export interface Collection {
    readonly id: CollectionId;
    readonly name: string;
    readonly description?: string;
    readonly created_at: Date;
}

export interface Anchor {
    readonly structure_path: string;
    readonly token_offset: number;
    readonly token_length: number;
    readonly fingerprint: string;
    readonly tokenization_version: string;
    readonly fingerprint_algo: string;
}

export interface Citation {
    readonly id: CitationId;
    readonly answer_id: AnswerId;
    readonly version_id: VersionId;
    readonly anchor: Anchor;
    readonly snippet: string;
    readonly confidence?: number;
}

export interface Answer {
    readonly id: AnswerId;
    readonly query_id: QueryId;
    readonly text: string;
    readonly citations: readonly CitationId[];
    readonly composed_at: Date;
    readonly coverage: {
        readonly claims: number;
        readonly cited: number;
    };
}
```

### API Request & Response DTOs

```typescript
// Shared
export interface PaginationRequest {
    readonly page?: number;
    readonly page_size?: number;
}

export interface PaginationResponse {
    readonly page: number;
    readonly page_size: number;
    readonly total_count: number;
    readonly has_more: boolean;
}

// POST /drafts
export interface SaveDraftRequest {
    readonly note_id: NoteId;
    readonly body_md: string;
    readonly metadata: NoteMetadata;
    readonly client_token?: ClientToken;
}

export interface SaveDraftResponse {
    readonly note_id: NoteId;
    readonly autosave_ts: Date;
    readonly status: "saved";
}

// POST /publish
export interface PublishRequest {
    readonly note_id: NoteId;
    readonly collections: readonly CollectionId[];
    readonly label?: VersionLabel;
    readonly client_token: ClientToken;
}

export interface PublishResponse {
    readonly version_id: VersionId;
    readonly note_id: NoteId;
    readonly status: "version_created" | "indexing" | "committed";
    readonly estimated_searchable_in?: number;
}

// POST /rollback
export interface RollbackRequest {
    readonly note_id: NoteId;
    readonly target_version_id: VersionId;
    readonly client_token: ClientToken;
}

export interface RollbackResponse {
    readonly new_version_id: VersionId;
    readonly note_id: NoteId;
    readonly target_version_id: VersionId;
    readonly status: "version_created" | "indexing" | "committed";
}

// GET /search
export interface SearchRequest extends PaginationRequest {
    readonly q: string;
    readonly collections?: readonly CollectionId[];
    readonly filters?: Record<string, unknown>;
}

export interface SearchResultItem {
    readonly note_id: NoteId;
    readonly version_id: VersionId;
    readonly title: string;
    readonly snippet: string;
    readonly score: number;
    readonly collection_ids: readonly CollectionId[];
}

export interface SearchResponse extends PaginationResponse {
    readonly answer?: Answer;
    readonly results: readonly SearchResultItem[];
    readonly citations: readonly Citation[];
    readonly query_id: string;
    readonly no_answer_reason?: string;
}

// POST /resolve-anchor
export interface ResolveAnchorRequest {
    readonly version_id: VersionId;
    readonly anchor: {
        readonly structure_path: string;
        readonly token_offset: number;
        readonly token_length: number;
        readonly fingerprint: string;
    };
}

export interface ResolveAnchorResponse {
    readonly resolved: boolean;
    readonly content?: string;
    readonly highlighted_range?: {
        readonly start_offset: number;
        readonly end_offset: number;
    };
    readonly context?: {
        readonly heading_trail: readonly string[];
        readonly previous_section?: string;
        readonly next_section?: string;
    };
    readonly error?: string;
}
```

### Error Shapes

```typescript
export interface ValidationErrorDetail {
    readonly field: string;
    readonly message: string;
    readonly code: string;
}

export interface ApiErrorResponse {
    readonly error: {
        readonly type:
            | "ValidationError"
            | "ConflictError"
            | "NotFound"
            | "RateLimitExceeded"
            | "VisibilityTimeout"
            | "IndexingFailure"
            | "StorageIO"
            | "SchemaVersionMismatch";
        readonly message: string;
        readonly details?: readonly ValidationErrorDetail[];
        readonly retry_after?: number; // in seconds
    };
}
```

## 3. API Client Core

The client interacts with the Knowledge Repository via a REST API.

### HTTP Client

A compliant HTTP client MUST:

- Set `Content-Type: application/json` for all `POST` requests.
- Send a session identifier in the `X-Session-ID` header for all requests to enable session-based rate limiting.
- Handle JSON-formatted error responses conforming to the `ApiErrorResponse` shape.

### Authentication & Idempotency

- **Session ID**: The client is responsible for generating and managing a `SessionId` (e.g., a ULID prefixed with `ses_`). This ID must be sent in the `X-Session-ID` header of every request. The server uses this to apply rate limits per session.
- **Client Token**: For mutable operations (`POST /publish`, `POST /rollback`, `POST /drafts`), the client can provide a `client_token` (a unique string up to 64 chars). The server uses this token to ensure idempotency, preventing duplicate operations if a request is retried. The client should generate a unique token for each distinct user action and reuse it for retries of that same action.

### Rate Limiting

The client MUST respect the rate limits enforced by the server. When the server responds with a `429 RateLimitExceeded` error, the response will include a `retry_after` header indicating the number of seconds to wait before making another request.

The default policies are:

- **Queries**: 5 QPS burst, 60 QPS sustained.
- **Mutations (Publish/Rollback)**: 1 per 5 seconds burst, 12 per minute sustained.
- **Draft Saves**: 10 per second burst, 300 per minute sustained.

The client should implement its own rate-limiting guard to avoid hitting the server limits.

## 4. Service Interfaces

A well-structured client should abstract API interactions into domain-oriented services.

```typescript
// A simplified representation of client-side services

interface EditorService {
    getDraft(noteId: NoteId): Promise<Draft>;
    saveDraft(request: SaveDraftRequest): Promise<SaveDraftResponse>;
}

interface PublicationService {
    publish(request: PublishRequest): Promise<PublishResponse>;
    rollback(request: RollbackRequest): Promise<RollbackResponse>;
}

interface SearchService {
    search(request: SearchRequest): Promise<SearchResponse>;
}

interface VersionService {
    listVersions(noteId: NoteId, pagination?: PaginationRequest): Promise<ListVersionsResponse>;
    getVersion(versionId: VersionId): Promise<Version>;
}

interface CollectionService {
    listCollections(pagination?: PaginationRequest): Promise<readonly Collection[]>;
    createCollection(name: string, description?: string): Promise<Collection>;
}

interface ReadingService {
    resolveAnchor(request: ResolveAnchorRequest): Promise<ResolveAnchorResponse>;
}
```

## 5. Method Signatures

Methods should handle both success and typed error states, which can be modeled using a `Result` type.

```typescript
type Result<T, E> =
    | { readonly _tag: "Ok"; readonly value: T }
    | { readonly _tag: "Err"; readonly error: E };

// Example: SearchService method signature
class SearchClient implements SearchService {
    async search(request: SearchRequest): Promise<Result<SearchResponse, ApiErrorResponse>> {
        try {
            // Implementation using fetch...
            const response = await fetch("/search?" + new URLSearchParams(request as any));
            if (!response.ok) {
                const errorPayload = await response.json();
                return { _tag: "Err", error: errorPayload };
            }
            const data = await response.json();
            return { _tag: "Ok", value: data };
        } catch (e) {
            return {
                _tag: "Err",
                error: { error: { type: "StorageIO", message: "Network request failed" } },
            };
        }
    }
}
```

Each service method's error type would be a union of the possible `ApiErrorResponse` types it can return.

## 6. State & Cache Contracts

The client is responsible for managing its own state to provide a responsive user experience and to minimize redundant network requests.

- **Normalized Cache**: Entities like `Note`, `Version`, and `Collection` should be stored in a normalized cache (e.g., a map keyed by their ID). This prevents data duplication and ensures consistency.
- **Optimistic Updates**: For frequent operations like saving a draft, the client can apply changes to its local state optimistically before the server confirms the write. If the server returns an error, the client state should be rolled back.
- **Cache Invalidation**: The client must invalidate its cache in response to certain operations.
    - After a `publish` or `rollback` operation succeeds, the client should invalidate any cached version lists for that note and refetch them.
    - After creating or renaming a `Collection`, the collection list should be refetched.
- **Search Results**: Search results are generally not cached, as they depend on a query and the state of the index at a specific time. However, the client can cache the results of the _last_ query to handle simple UI changes without re-fetching.

## 7. Event Contracts

To receive real-time updates on long-running processes like indexing, the client can connect to a Server-Sent Events (SSE) stream.

- **Endpoint**: The client can connect to a `/events` endpoint.
- **Message Shape**: The server will send events with the following shape, where `data` is a JSON string of a `SystemEvent` object.

```typescript
interface ServerSentEvent {
    readonly data: string; // JSON representation of a SystemEvent
    readonly event?: string; // e.g., 'IndexUpdateCommitted'
    readonly id?: string;
    readonly retry?: number;
}

// Example SystemEvent from src/schema/events.ts
export interface IndexUpdateCommitted {
    readonly event_id: string;
    readonly timestamp: Date;
    readonly schema_version: string;
    readonly type: "IndexUpdateCommitted";
    readonly version_id: VersionId;
}
```

- **Key Events**: The client should listen for `IndexUpdateCommitted` and `IndexUpdateFailed` to provide feedback on when a new version becomes searchable.
- **Reconnection**: If the connection is lost, the client should attempt to reconnect using an exponential backoff strategy (e.g., 1s, 2s, 4s, ...).

## 8. Validation & Guards

The client should perform validation before sending requests to the server to provide immediate feedback and reduce unnecessary API calls.

### Pre-flight Validation

Based on `policy/publication.ts`, the client must validate publication requests:

- **Title**: 1-200 characters.
- **Collections**: At least 1 collection must be assigned.
- **Tags**: Max 15 tags, each 1-40 characters.
- **Content**: Max 1MB.

### Response Validation

The client should use runtime type guards to validate that the shape of server responses matches the expected TypeScript interfaces. This protects against API changes and malformed data.

```typescript
import { Schema } from "@effect/schema";
import { SearchResponse as SearchResponseSchema } from "./schemas"; // Assuming schemas are generated

function isSearchResponse(data: unknown): data is SearchResponse {
    const decoded = Schema.decodeUnknownSync(SearchResponseSchema)(data, { errors: "all" });
    return decoded !== undefined;
}
```

### Citation & Answer Integrity

- Before rendering an `Answer`, the client MUST verify that every `CitationId` in `answer.citations` corresponds to a `Citation` object in the top-level `citations` array of the `SearchResponse`.
- If a citation is missing, the answer should be considered invalid and either hidden or displayed with a warning. This prevents rendering claims that cannot be backed by evidence.

## 9. Error Handling

The client should provide distinct user experiences for different error types returned by the API.

- **`ValidationError` (400)**: The request was malformed (e.g., invalid title length). The client should highlight the specific field from the `details` array and display the error message to the user.
- **`NotFound` (404)**: The requested entity does not exist. The client should show a "Not Found" view.
- **`ConflictError` (409)**: The operation conflicts with the current state (e.g., creating a collection with a duplicate name). The client should display the error message and prompt the user to change their input.
- **`RateLimitExceeded` (429)**: The user has sent too many requests. The client should disable the UI that triggered the request and display a countdown timer based on the `retry_after` value.
- **`IndexingFailure` / `VisibilityTimeout` (503)**: A server-side process is delayed or has failed. The client should inform the user that the system is experiencing issues and offer a manual retry option.
- **`StorageIO` (500)**: A generic server error occurred. The client should display a generic error message and suggest retrying later.

## 10. Compliance Rules

The client must operate within the key invariants of the system to ensure data integrity and a correct user experience.

- **Draft Exclusion**: The client UI must ensure a strict separation between draft editing and published content views. Draft content must never be used to render search results or reading views of published notes.
- **Version Immutability**: The client must treat all `Version` data as read-only. Any modification must be done through the `publish` or `rollback` workflows, which create new versions.
- **Citation Integrity**: As stated in Section 8, the client is the final guarantor of citation integrity. It must not render an answer if its citations cannot be resolved from the search response.
- **Read-Your-Writes**: The client should use its local cache to ensure that after a user performs an action (e.g., saving a draft), the UI immediately reflects that change. This is typically achieved through optimistic updates or by refetching data after a mutation.
