/**
 * Core domain entities schema definitions
 *
 * References SPEC.md Section 3: Logical Data Model
 * All entity IDs follow opaque ULID pattern: note_<ulid>, col_<ulid>, etc.
 */

import { Schema } from "@effect/schema";

// Base ID schemas with ULID patterns
export const NoteId = Schema.String.pipe(
	Schema.pattern(/^note_[0-9A-HJKMNP-TV-Z]{26}$/),
	Schema.brand("NoteId"),
);
export type NoteId = Schema.Schema.Type<typeof NoteId>;

export const CollectionId = Schema.String.pipe(
	Schema.pattern(/^col_[0-9A-HJKMNP-TV-Z]{26}$/),
	Schema.brand("CollectionId"),
);
export type CollectionId = Schema.Schema.Type<typeof CollectionId>;

export const VersionId = Schema.String.pipe(
	Schema.pattern(/^ver_[0-9A-HJKMNP-TV-Z]{26}$/),
	Schema.brand("VersionId"),
);
export type VersionId = Schema.Schema.Type<typeof VersionId>;

export const SessionId = Schema.String.pipe(
	Schema.pattern(/^ses_[0-9A-HJKMNP-TV-Z]{26}$/),
	Schema.brand("SessionId"),
);
export type SessionId = Schema.Schema.Type<typeof SessionId>;

export const CitationId = Schema.String.pipe(
	Schema.pattern(/^cit_[0-9A-HJKMNP-TV-Z]{26}$/),
	Schema.brand("CitationId"),
);
export type CitationId = Schema.Schema.Type<typeof CitationId>;

export const SnapshotId = Schema.String.pipe(
	Schema.pattern(/^snp_[0-9A-HJKMNP-TV-Z]{26}$/),
	Schema.brand("SnapshotId"),
);
export type SnapshotId = Schema.Schema.Type<typeof SnapshotId>;

export const QueryId = Schema.String.pipe(
	Schema.pattern(/^qry_[0-9A-HJKMNP-TV-Z]{26}$/),
	Schema.brand("QueryId"),
);
export type QueryId = Schema.Schema.Type<typeof QueryId>;

export const AnswerId = Schema.String.pipe(
	Schema.pattern(/^ans_[0-9A-HJKMNP-TV-Z]{26}$/),
	Schema.brand("AnswerId"),
);
export type AnswerId = Schema.Schema.Type<typeof AnswerId>;

export const PublicationId = Schema.String.pipe(
	Schema.pattern(/^pub_[0-9A-HJKMNP-TV-Z]{26}$/),
	Schema.brand("PublicationId"),
);
export type PublicationId = Schema.Schema.Type<typeof PublicationId>;

export const PassageId = Schema.String.pipe(
	Schema.pattern(/^pas_[0-9A-HJKMNP-TV-Z]{26}$/),
	Schema.brand("PassageId"),
);
export type PassageId = Schema.Schema.Type<typeof PassageId>;

export const CorpusId = Schema.String.pipe(
	Schema.pattern(/^cor_[0-9A-HJKMNP-TV-Z]{26}$/),
	Schema.brand("CorpusId"),
);
export type CorpusId = Schema.Schema.Type<typeof CorpusId>;

export const IndexId = Schema.String.pipe(
	Schema.pattern(/^idx_[0-9A-HJKMNP-TV-Z]{26}$/),
	Schema.brand("IndexId"),
);
export type IndexId = Schema.Schema.Type<typeof IndexId>;

// Common schemas
export const ContentHash = Schema.String.pipe(
	Schema.pattern(/^[a-f0-9]{64}$/), // SHA-256 hex
	Schema.brand("ContentHash"),
);
export type ContentHash = Schema.Schema.Type<typeof ContentHash>;

export const VersionLabel = Schema.Literal("minor", "major");
export type VersionLabel = Schema.Schema.Type<typeof VersionLabel>;

export const CorpusState = Schema.Literal("Fresh", "Updating", "Committed");
export type CorpusState = Schema.Schema.Type<typeof CorpusState>;

export const IndexState = Schema.Literal("Building", "Ready", "Swapping");
export type IndexState = Schema.Schema.Type<typeof IndexState>;

// Core domain entities
export const NoteMetadata = Schema.Struct({
	tags: Schema.optional(
		Schema.Array(Schema.String.pipe(Schema.minLength(1), Schema.maxLength(40))),
	),
});
export type NoteMetadata = Schema.Schema.Type<typeof NoteMetadata>;

export const Note = Schema.Struct({
	id: NoteId,
	title: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(200)),
	metadata: NoteMetadata,
	created_at: Schema.Date,
	updated_at: Schema.Date,
	current_version_id: Schema.optional(VersionId),
});
export type Note = Schema.Schema.Type<typeof Note>;

export const Draft = Schema.Struct({
	note_id: NoteId,
	body_md: Schema.String,
	metadata: NoteMetadata,
	autosave_ts: Schema.Date,
});
export type Draft = Schema.Schema.Type<typeof Draft>;

export const Version = Schema.Struct({
	id: VersionId,
	note_id: NoteId,
	content_md: Schema.String,
	metadata: NoteMetadata,
	content_hash: ContentHash,
	created_at: Schema.Date,
	parent_version_id: Schema.optional(VersionId),
	label: VersionLabel,
});
export type Version = Schema.Schema.Type<typeof Version>;

export const Collection = Schema.Struct({
	id: CollectionId,
	name: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(100)),
	description: Schema.optional(Schema.String),
	created_at: Schema.Date,
});
export type Collection = Schema.Schema.Type<typeof Collection>;

export const Publication = Schema.Struct({
	id: PublicationId,
	note_id: NoteId,
	version_id: VersionId,
	collections: Schema.NonEmptyArray(CollectionId),
	published_at: Schema.Date,
	label: Schema.optional(VersionLabel),
});
export type Publication = Schema.Schema.Type<typeof Publication>;

export const TokenSpan = Schema.Struct({
	offset: Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(0)),
	length: Schema.Number.pipe(Schema.int(), Schema.greaterThan(0)),
});
export type TokenSpan = Schema.Schema.Type<typeof TokenSpan>;

export const Passage = Schema.Struct({
	id: PassageId,
	version_id: VersionId,
	structure_path: Schema.String,
	token_span: TokenSpan,
	snippet: Schema.String,
});
export type Passage = Schema.Schema.Type<typeof Passage>;

export const Anchor = Schema.Struct({
	structure_path: Schema.String,
	token_offset: Schema.Number.pipe(
		Schema.int(),
		Schema.greaterThanOrEqualTo(0),
	),
	token_length: Schema.Number.pipe(Schema.int(), Schema.greaterThan(0)),
	fingerprint: Schema.String.pipe(Schema.pattern(/^[a-f0-9]+$/)),
	tokenization_version: Schema.String,
	fingerprint_algo: Schema.String,
});
export type Anchor = Schema.Schema.Type<typeof Anchor>;

export const Citation = Schema.Struct({
	id: CitationId,
	answer_id: AnswerId,
	version_id: VersionId,
	anchor: Anchor,
	snippet: Schema.String,
	confidence: Schema.optional(Schema.Number.pipe(Schema.between(0, 1))),
});
export type Citation = Schema.Schema.Type<typeof Citation>;

export const AnswerCoverage = Schema.Struct({
	claims: Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(0)),
	cited: Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(0)),
});
export type AnswerCoverage = Schema.Schema.Type<typeof AnswerCoverage>;

export const Answer = Schema.Struct({
	id: AnswerId,
	query_id: QueryId,
	text: Schema.String,
	citations: Schema.NonEmptyArray(CitationId),
	composed_at: Schema.Date,
	coverage: AnswerCoverage,
});
export type Answer = Schema.Schema.Type<typeof Answer>;

export const QueryScope = Schema.Struct({
	collection_ids: Schema.NonEmptyArray(CollectionId),
	filters: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
});
export type QueryScope = Schema.Schema.Type<typeof QueryScope>;

export const Query = Schema.Struct({
	id: QueryId,
	text: Schema.String.pipe(Schema.minLength(1)),
	scope: QueryScope,
	submitted_at: Schema.Date,
});
export type Query = Schema.Schema.Type<typeof Query>;

export const SessionStepType = Schema.Literal("query", "open_citation");
export type SessionStepType = Schema.Schema.Type<typeof SessionStepType>;

export const SessionStep = Schema.Struct({
	type: SessionStepType,
	ref_ids: Schema.Array(Schema.String),
	timestamp: Schema.Date,
});
export type SessionStep = Schema.Schema.Type<typeof SessionStep>;

export const Session = Schema.Struct({
	id: SessionId,
	started_at: Schema.Date,
	steps: Schema.Array(SessionStep),
	ended_at: Schema.optional(Schema.Date),
	pinned: Schema.optional(Schema.Boolean),
});
export type Session = Schema.Schema.Type<typeof Session>;

export const Corpus = Schema.Struct({
	id: CorpusId,
	version_ids: Schema.Array(VersionId),
	state: CorpusState,
	created_at: Schema.Date,
});
export type Corpus = Schema.Schema.Type<typeof Corpus>;

export const Index = Schema.Struct({
	id: IndexId,
	corpus_id: CorpusId,
	state: IndexState,
	built_at: Schema.optional(Schema.Date),
});
export type Index = Schema.Schema.Type<typeof Index>;

export const Snapshot = Schema.Struct({
	id: SnapshotId,
	created_at: Schema.Date,
	scope: Schema.String,
	note: Schema.String, // JSON serialized workspace content
});
export type Snapshot = Schema.Schema.Type<typeof Snapshot>;

// Collection membership bridge entity
export const CollectionMembership = Schema.Struct({
	note_id: NoteId,
	collection_id: CollectionId,
	added_at: Schema.Date,
});
export type CollectionMembership = Schema.Schema.Type<
	typeof CollectionMembership
>;
