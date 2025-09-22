/**
 * Event schema definitions for the system event model
 *
 * References SPEC.md Section 6: Event Model
 * All events follow at-least-once delivery with idempotent consumers
 */

import { Schema } from "@effect/schema";
import {
	Anchor,
	AnswerId,
	CitationId,
	CollectionId,
	IndexId,
	NoteId,
	QueryId,
	SnapshotId,
	VersionId,
	VersionLabel,
} from "./entities";

// Base event schema
export const BaseEvent = Schema.Struct({
	event_id: Schema.String,
	timestamp: Schema.Date,
	schema_version: Schema.String,
});

// Draft events
export const DraftSaved = Schema.Struct({
	...BaseEvent.fields,
	type: Schema.Literal("DraftSaved"),
	note_id: NoteId,
	autosave_ts: Schema.Date,
});
export type DraftSaved = Schema.Schema.Type<typeof DraftSaved>;

// Version events
export const VersionCreated = Schema.Struct({
	...BaseEvent.fields,
	type: Schema.Literal("VersionCreated"),
	version_id: VersionId,
	note_id: NoteId,
	parent_version_id: Schema.optional(VersionId),
	label: Schema.optional(VersionLabel),
});
export type VersionCreated = Schema.Schema.Type<typeof VersionCreated>;

// Visibility operation types
export const VisibilityOperation = Schema.Literal(
	"publish",
	"republish",
	"rollback",
);
export type VisibilityOperation = Schema.Schema.Type<
	typeof VisibilityOperation
>;

export const VisibilityEvent = Schema.Struct({
	...BaseEvent.fields,
	type: Schema.Literal("VisibilityEvent"),
	version_id: VersionId,
	op: VisibilityOperation,
	collections: Schema.NonEmptyArray(CollectionId),
});
export type VisibilityEvent = Schema.Schema.Type<typeof VisibilityEvent>;

// Index update events
export const IndexUpdateStarted = Schema.Struct({
	...BaseEvent.fields,
	type: Schema.Literal("IndexUpdateStarted"),
	version_id: VersionId,
});
export type IndexUpdateStarted = Schema.Schema.Type<typeof IndexUpdateStarted>;

export const IndexUpdateCommitted = Schema.Struct({
	...BaseEvent.fields,
	type: Schema.Literal("IndexUpdateCommitted"),
	version_id: VersionId,
});
export type IndexUpdateCommitted = Schema.Schema.Type<
	typeof IndexUpdateCommitted
>;

export const IndexUpdateFailed = Schema.Struct({
	...BaseEvent.fields,
	type: Schema.Literal("IndexUpdateFailed"),
	version_id: VersionId,
	reason: Schema.String,
});
export type IndexUpdateFailed = Schema.Schema.Type<typeof IndexUpdateFailed>;

// Query and answer events
export const QuerySubmitted = Schema.Struct({
	...BaseEvent.fields,
	type: Schema.Literal("QuerySubmitted"),
	query_id: QueryId,
	scope: Schema.Struct({
		collection_ids: Schema.Array(CollectionId),
		filters: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
	}),
});
export type QuerySubmitted = Schema.Schema.Type<typeof QuerySubmitted>;

export const AnswerComposed = Schema.Struct({
	...BaseEvent.fields,
	type: Schema.Literal("AnswerComposed"),
	answer_id: AnswerId,
	coverage: Schema.Struct({
		claims: Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(0)),
		cited: Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(0)),
	}),
});
export type AnswerComposed = Schema.Schema.Type<typeof AnswerComposed>;

// Citation events
export const CitationResolved = Schema.Struct({
	...BaseEvent.fields,
	type: Schema.Literal("CitationResolved"),
	citation_id: CitationId,
	resolved: Schema.Boolean,
});
export type CitationResolved = Schema.Schema.Type<typeof CitationResolved>;

// Anchor drift detection
export const AnchorDriftDetected = Schema.Struct({
	...BaseEvent.fields,
	type: Schema.Literal("AnchorDriftDetected"),
	version_id: VersionId,
	anchor: Anchor,
});
export type AnchorDriftDetected = Schema.Schema.Type<
	typeof AnchorDriftDetected
>;

// Snapshot events
export const SnapshotCreated = Schema.Struct({
	...BaseEvent.fields,
	type: Schema.Literal("SnapshotCreated"),
	snapshot_id: SnapshotId,
});
export type SnapshotCreated = Schema.Schema.Type<typeof SnapshotCreated>;

export const SnapshotRestored = Schema.Struct({
	...BaseEvent.fields,
	type: Schema.Literal("SnapshotRestored"),
	snapshot_id: SnapshotId,
});
export type SnapshotRestored = Schema.Schema.Type<typeof SnapshotRestored>;

// Index health events
export const IndexHealthCheckPassed = Schema.Struct({
	...BaseEvent.fields,
	type: Schema.Literal("IndexHealthCheckPassed"),
	index_id: IndexId,
});
export type IndexHealthCheckPassed = Schema.Schema.Type<
	typeof IndexHealthCheckPassed
>;

export const IndexHealthCheckFailed = Schema.Struct({
	...BaseEvent.fields,
	type: Schema.Literal("IndexHealthCheckFailed"),
	index_id: IndexId,
	reason: Schema.String,
});
export type IndexHealthCheckFailed = Schema.Schema.Type<
	typeof IndexHealthCheckFailed
>;

// Union of all event types
export const SystemEvent = Schema.Union(
	DraftSaved,
	VersionCreated,
	VisibilityEvent,
	IndexUpdateStarted,
	IndexUpdateCommitted,
	IndexUpdateFailed,
	QuerySubmitted,
	AnswerComposed,
	CitationResolved,
	AnchorDriftDetected,
	SnapshotCreated,
	SnapshotRestored,
	IndexHealthCheckPassed,
	IndexHealthCheckFailed,
);
export type SystemEvent = Schema.Schema.Type<typeof SystemEvent>;

// Event type discrimination
export const EventType = Schema.Literal(
	"DraftSaved",
	"VersionCreated",
	"VisibilityEvent",
	"IndexUpdateStarted",
	"IndexUpdateCommitted",
	"IndexUpdateFailed",
	"QuerySubmitted",
	"AnswerComposed",
	"CitationResolved",
	"AnchorDriftDetected",
	"SnapshotCreated",
	"SnapshotRestored",
	"IndexHealthCheckPassed",
	"IndexHealthCheckFailed",
);
export type EventType = Schema.Schema.Type<typeof EventType>;

// Event envelope for serialization
export const EventEnvelope = Schema.Struct({
	event: SystemEvent,
	metadata: Schema.Struct({
		producer: Schema.String,
		correlation_id: Schema.optional(Schema.String),
		causation_id: Schema.optional(Schema.String),
	}),
});
export type EventEnvelope = Schema.Schema.Type<typeof EventEnvelope>;
