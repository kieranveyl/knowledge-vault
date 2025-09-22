/**
 * API request and response schema definitions
 *
 * References SPEC.md Section 4: External Interfaces & Contracts
 * Defines REST API contracts for all operations
 */

import { Schema } from "@effect/schema";
import {
	Answer,
	Citation,
	CollectionId,
	NoteId,
	Session,
	SessionId,
	Snapshot,
	SnapshotId,
	Version,
	VersionId,
	VersionLabel,
} from "./entities";

// Common API schemas
export const ClientToken = Schema.String.pipe(
	Schema.minLength(1),
	Schema.maxLength(64),
	Schema.brand("ClientToken"),
);
export type ClientToken = Schema.Schema.Type<typeof ClientToken>;

export const PaginationRequest = Schema.Struct({
	page: Schema.optional(
		Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(0)),
	),
	page_size: Schema.optional(
		Schema.Number.pipe(Schema.int(), Schema.between(1, 50)),
	),
});
export type PaginationRequest = Schema.Schema.Type<typeof PaginationRequest>;

export const PaginationResponse = Schema.Struct({
	page: Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(0)),
	page_size: Schema.Number.pipe(Schema.int(), Schema.between(1, 50)),
	total_count: Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(0)),
	has_more: Schema.Boolean,
});
export type PaginationResponse = Schema.Schema.Type<typeof PaginationResponse>;

// Error response schemas
export const ValidationErrorDetail = Schema.Struct({
	field: Schema.String,
	message: Schema.String,
	code: Schema.String,
});
export type ValidationErrorDetail = Schema.Schema.Type<
	typeof ValidationErrorDetail
>;

export const ApiErrorResponse = Schema.Struct({
	error: Schema.Struct({
		type: Schema.Literal(
			"ValidationError",
			"ConflictError",
			"NotFound",
			"RateLimitExceeded",
			"VisibilityTimeout",
			"IndexingFailure",
			"StorageIO",
			"SchemaVersionMismatch",
		),
		message: Schema.String,
		details: Schema.optional(Schema.Array(ValidationErrorDetail)),
		retry_after: Schema.optional(
			Schema.Number.pipe(Schema.int(), Schema.greaterThan(0)),
		),
	}),
});
export type ApiErrorResponse = Schema.Schema.Type<typeof ApiErrorResponse>;

// Draft operations
export const SaveDraftRequest = Schema.Struct({
	note_id: NoteId,
	body_md: Schema.String,
	metadata: Schema.Struct({
		tags: Schema.optional(
			Schema.Array(
				Schema.String.pipe(Schema.minLength(1), Schema.maxLength(40)),
			),
		),
	}),
	client_token: Schema.optional(ClientToken),
});
export type SaveDraftRequest = Schema.Schema.Type<typeof SaveDraftRequest>;

export const SaveDraftResponse = Schema.Struct({
	note_id: NoteId,
	autosave_ts: Schema.Date,
	status: Schema.Literal("saved"),
});
export type SaveDraftResponse = Schema.Schema.Type<typeof SaveDraftResponse>;

// Publication operations
export const PublishRequest = Schema.Struct({
	note_id: NoteId,
	collections: Schema.NonEmptyArray(CollectionId),
	label: Schema.optional(VersionLabel),
	client_token: ClientToken,
});
export type PublishRequest = Schema.Schema.Type<typeof PublishRequest>;

export const PublishResponse = Schema.Struct({
	version_id: VersionId,
	note_id: NoteId,
	status: Schema.Literal("version_created", "indexing", "committed"),
	estimated_searchable_in: Schema.optional(
		Schema.Number.pipe(Schema.int(), Schema.greaterThan(0)),
	),
});
export type PublishResponse = Schema.Schema.Type<typeof PublishResponse>;

// Rollback operations
export const RollbackRequest = Schema.Struct({
	note_id: NoteId,
	target_version_id: VersionId,
	client_token: ClientToken,
});
export type RollbackRequest = Schema.Schema.Type<typeof RollbackRequest>;

export const RollbackResponse = Schema.Struct({
	new_version_id: VersionId,
	note_id: NoteId,
	target_version_id: VersionId,
	status: Schema.Literal("version_created", "indexing", "committed"),
});
export type RollbackResponse = Schema.Schema.Type<typeof RollbackResponse>;

// Search operations
export const SearchRequest = Schema.Struct({
	q: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(500)),
	collections: Schema.optional(Schema.Array(CollectionId)),
	filters: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
	...PaginationRequest.fields,
});
export type SearchRequest = Schema.Schema.Type<typeof SearchRequest>;

export const SearchResultItem = Schema.Struct({
	note_id: NoteId,
	version_id: VersionId,
	title: Schema.String,
	snippet: Schema.String,
	score: Schema.Number.pipe(Schema.between(0, 1)),
	collection_ids: Schema.Array(CollectionId),
});
export type SearchResultItem = Schema.Schema.Type<typeof SearchResultItem>;

export const SearchResponse = Schema.Struct({
	answer: Schema.optional(Answer),
	results: Schema.Array(SearchResultItem),
	citations: Schema.Array(Citation),
	query_id: Schema.String,
	no_answer_reason: Schema.optional(Schema.String),
	...PaginationResponse.fields,
});
export type SearchResponse = Schema.Schema.Type<typeof SearchResponse>;

// Version history operations
export const ListVersionsRequest = Schema.Struct({
	note_id: NoteId,
	...PaginationRequest.fields,
});
export type ListVersionsRequest = Schema.Schema.Type<
	typeof ListVersionsRequest
>;

export const ListVersionsResponse = Schema.Struct({
	versions: Schema.Array(Version),
	...PaginationResponse.fields,
});
export type ListVersionsResponse = Schema.Schema.Type<
	typeof ListVersionsResponse
>;

// Session operations
export const LoadSessionRequest = Schema.Struct({
	session_id: SessionId,
});
export type LoadSessionRequest = Schema.Schema.Type<typeof LoadSessionRequest>;

export const LoadSessionResponse = Schema.Struct({
	session: Session,
	reconstructed_steps: Schema.Array(
		Schema.Struct({
			step_index: Schema.Number.pipe(
				Schema.int(),
				Schema.greaterThanOrEqualTo(0),
			),
			answer: Schema.optional(Answer),
			citations: Schema.Array(Citation),
			error: Schema.optional(Schema.String),
		}),
	),
});
export type LoadSessionResponse = Schema.Schema.Type<
	typeof LoadSessionResponse
>;

export const OpenStepRequest = Schema.Struct({
	session_id: SessionId,
	step_id: Schema.String,
});
export type OpenStepRequest = Schema.Schema.Type<typeof OpenStepRequest>;

export const OpenStepResponse = Schema.Struct({
	answer: Schema.optional(Answer),
	citations: Schema.Array(Citation),
	version_availability: Schema.Array(
		Schema.Struct({
			version_id: VersionId,
			available: Schema.Boolean,
			nearest_available: Schema.optional(VersionId),
		}),
	),
});
export type OpenStepResponse = Schema.Schema.Type<typeof OpenStepResponse>;

// Snapshot operations
export const CreateSnapshotRequest = Schema.Struct({
	scope: Schema.String, // Workspace scope identifier
	description: Schema.optional(Schema.String),
});
export type CreateSnapshotRequest = Schema.Schema.Type<
	typeof CreateSnapshotRequest
>;

export const CreateSnapshotResponse = Schema.Struct({
	snapshot_id: SnapshotId,
	created_at: Schema.Date,
	status: Schema.Literal("created"),
});
export type CreateSnapshotResponse = Schema.Schema.Type<
	typeof CreateSnapshotResponse
>;

export const ListSnapshotsRequest = PaginationRequest;
export type ListSnapshotsRequest = Schema.Schema.Type<
	typeof ListSnapshotsRequest
>;

export const ListSnapshotsResponse = Schema.Struct({
	snapshots: Schema.Array(Snapshot),
	...PaginationResponse.fields,
});
export type ListSnapshotsResponse = Schema.Schema.Type<
	typeof ListSnapshotsResponse
>;

export const RestoreSnapshotRequest = Schema.Struct({
	snapshot_id: SnapshotId,
	client_token: ClientToken,
});
export type RestoreSnapshotRequest = Schema.Schema.Type<
	typeof RestoreSnapshotRequest
>;

export const RestoreSnapshotResponse = Schema.Struct({
	snapshot_id: SnapshotId,
	status: Schema.Literal("restored", "restoring"),
	affected_notes: Schema.Array(NoteId),
});
export type RestoreSnapshotResponse = Schema.Schema.Type<
	typeof RestoreSnapshotResponse
>;

// Health and status
export const HealthResponse = Schema.Struct({
	status: Schema.Literal("healthy", "degraded", "unhealthy"),
	version: Schema.String,
	uptime_ms: Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(0)),
	checks: Schema.Record(
		Schema.String,
		Schema.Struct({
			status: Schema.Literal("pass", "fail", "warn"),
			message: Schema.optional(Schema.String),
		}),
	),
});
export type HealthResponse = Schema.Schema.Type<typeof HealthResponse>;

// Reading view operations
export const ResolveAnchorRequest = Schema.Struct({
	version_id: VersionId,
	anchor: Schema.Struct({
		structure_path: Schema.String,
		token_offset: Schema.Number.pipe(
			Schema.int(),
			Schema.greaterThanOrEqualTo(0),
		),
		token_length: Schema.Number.pipe(Schema.int(), Schema.greaterThan(0)),
		fingerprint: Schema.String,
	}),
});
export type ResolveAnchorRequest = Schema.Schema.Type<
	typeof ResolveAnchorRequest
>;

export const ResolveAnchorResponse = Schema.Struct({
	resolved: Schema.Boolean,
	content: Schema.optional(Schema.String),
	highlighted_range: Schema.optional(
		Schema.Struct({
			start_offset: Schema.Number.pipe(
				Schema.int(),
				Schema.greaterThanOrEqualTo(0),
			),
			end_offset: Schema.Number.pipe(
				Schema.int(),
				Schema.greaterThanOrEqualTo(0),
			),
		}),
	),
	context: Schema.optional(
		Schema.Struct({
			heading_trail: Schema.Array(Schema.String),
			previous_section: Schema.optional(Schema.String),
			next_section: Schema.optional(Schema.String),
		}),
	),
	error: Schema.optional(Schema.String),
});
export type ResolveAnchorResponse = Schema.Schema.Type<
	typeof ResolveAnchorResponse
>;
