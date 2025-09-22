/**
 * In-memory storage adapter for development and testing
 * 
 * Simple implementation of StoragePort for bootstrapping the system
 * TODO: Replace with ElectricSQL adapter for production use
 */

import { Effect } from "effect";
import { ulid } from "ulid";
import type {
	Note,
	Draft,
	Version,
	Collection,
	Publication,
	Session,
	Snapshot,
	NoteId,
	VersionId,
	CollectionId,
	SessionId,
	SnapshotId,
	PublicationId,
	NoteMetadata,
	VersionLabel,
	ContentHash,
} from "../../schema/entities";

import type {
	SaveDraftRequest,
	SaveDraftResponse,
	PublishRequest,
	PublishResponse,
	RollbackRequest,
	RollbackResponse,
} from "../../schema/api";

import type {
	StoragePort,
	StorageError,
	CollectionMembership,
	ListOptions,
	CollectionFilter,
} from "../../services/storage.port";

/**
 * In-memory storage state
 */
interface MemoryStorageState {
	notes: Map<NoteId, Note>;
	drafts: Map<NoteId, Draft>;
	versions: Map<VersionId, Version>;
	collections: Map<CollectionId, Collection>;
	publications: Map<PublicationId, Publication>;
	sessions: Map<SessionId, Session>;
	snapshots: Map<SnapshotId, Snapshot>;
	collectionMemberships: Map<string, CollectionMembership>; // key: noteId:collectionId
	initialized: boolean;
}

/**
 * Creates storage error effect
 */
const storageError = (error: StorageError) => Effect.fail(error);

/**
 * Creates NotFound error
 */
const notFound = (entity: string, id: string): StorageError => ({
	_tag: "NotFound",
	entity,
	id,
});

/**
 * In-memory storage adapter implementation
 */
export class MemoryStorageAdapter implements StoragePort {
	private state: MemoryStorageState = {
		notes: new Map(),
		drafts: new Map(),
		versions: new Map(),
		collections: new Map(),
		publications: new Map(),
		sessions: new Map(),
		snapshots: new Map(),
		collectionMemberships: new Map(),
		initialized: false,
	};

	// Workspace operations
	readonly initializeWorkspace = (): Effect.Effect<void, StorageError> =>
		Effect.sync(() => {
			this.state.initialized = true;
		});

	readonly isWorkspaceInitialized = (): Effect.Effect<boolean, StorageError> =>
		Effect.succeed(this.state.initialized);

	// Note operations
	readonly createNote = (
		title: string,
		initialContent: string,
		metadata: NoteMetadata,
	): Effect.Effect<Note, StorageError> =>
		Effect.sync(() => {
			const id = `note_${ulid()}` as NoteId;
			const now = new Date();
			const note: Note = {
				id,
				title,
				metadata,
				created_at: now,
				updated_at: now,
			};

			this.state.notes.set(id, note);

			// Create initial draft
			const draft: Draft = {
				note_id: id,
				body_md: initialContent,
				metadata,
				autosave_ts: now,
			};
			this.state.drafts.set(id, draft);

			return note;
		});

	readonly getNote = (id: NoteId): Effect.Effect<Note, StorageError> =>
		Effect.sync(() => {
			const note = this.state.notes.get(id);
			if (!note) {
				throw new Error("Note not found");
			}
			return note;
		}).pipe(Effect.catchAll(() => storageError(notFound("Note", id))));

	readonly listNotes = (
		filter?: CollectionFilter,
		options?: ListOptions,
	): Effect.Effect<readonly Note[], StorageError> =>
		Effect.sync(() => {
			let notes = Array.from(this.state.notes.values());

			// Apply collection filter if specified
			if (filter?.collection_ids) {
				const collectionIds = new Set(filter.collection_ids);
				notes = notes.filter((note) => {
					// Check if note belongs to any of the specified collections
					return Array.from(this.state.collectionMemberships.values()).some(
						(membership) =>
							membership.note_id === note.id &&
							collectionIds.has(membership.collection_id),
					);
				});
			}

			// Apply pagination if specified
			if (options?.offset || options?.limit) {
				const offset = options?.offset || 0;
				const limit = options?.limit || notes.length;
				notes = notes.slice(offset, offset + limit);
			}

			return notes;
		});

	readonly updateNoteMetadata = (
		id: NoteId,
		metadata: NoteMetadata,
	): Effect.Effect<Note, StorageError> =>
		Effect.sync(() => {
			const note = this.state.notes.get(id);
			if (!note) {
				throw new Error("Note not found");
			}

			const updatedNote: Note = {
				...note,
				metadata,
				updated_at: new Date(),
			};

			this.state.notes.set(id, updatedNote);
			return updatedNote;
		}).pipe(Effect.catchAll(() => storageError(notFound("Note", id))));

	readonly deleteNote = (id: NoteId): Effect.Effect<void, StorageError> =>
		Effect.sync(() => {
			if (!this.state.notes.has(id)) {
				throw new Error("Note not found");
			}

			// Delete note and all related data
			this.state.notes.delete(id);
			this.state.drafts.delete(id);

			// Delete versions
			for (const [versionId, version] of this.state.versions) {
				if (version.note_id === id) {
					this.state.versions.delete(versionId);
				}
			}

			// Delete publications
			for (const [pubId, publication] of this.state.publications) {
				if (publication.note_id === id) {
					this.state.publications.delete(pubId);
				}
			}

			// Delete collection memberships
			for (const [key, membership] of this.state.collectionMemberships) {
				if (membership.note_id === id) {
					this.state.collectionMemberships.delete(key);
				}
			}
		}).pipe(Effect.catchAll(() => storageError(notFound("Note", id))));

	// Draft operations
	readonly saveDraft = (
		request: SaveDraftRequest,
	): Effect.Effect<SaveDraftResponse, StorageError> =>
		Effect.sync(() => {
			if (!this.state.notes.has(request.note_id)) {
				throw new Error("Note not found");
			}

			const now = new Date();
			const draft: Draft = {
				note_id: request.note_id,
				body_md: request.body_md,
				metadata: request.metadata,
				autosave_ts: now,
			};

			this.state.drafts.set(request.note_id, draft);

			return {
				note_id: request.note_id,
				autosave_ts: now,
				status: "saved" as const,
			};
		}).pipe(Effect.catchAll(() => storageError(notFound("Note", request.note_id))));

	readonly getDraft = (note_id: NoteId): Effect.Effect<Draft, StorageError> =>
		Effect.sync(() => {
			const draft = this.state.drafts.get(note_id);
			if (!draft) {
				throw new Error("Draft not found");
			}
			return draft;
		}).pipe(Effect.catchAll(() => storageError(notFound("Draft", note_id))));

	readonly hasDraft = (note_id: NoteId): Effect.Effect<boolean, StorageError> =>
		Effect.succeed(this.state.drafts.has(note_id));

	readonly deleteDraft = (note_id: NoteId): Effect.Effect<void, StorageError> =>
		Effect.sync(() => {
			this.state.drafts.delete(note_id);
		});

	// Version operations
	readonly createVersion = (
		note_id: NoteId,
		content_md: string,
		metadata: NoteMetadata,
		label: VersionLabel,
		parent_version_id?: VersionId,
	): Effect.Effect<Version, StorageError> =>
		Effect.sync(() => {
			if (!this.state.notes.has(note_id)) {
				throw new Error("Note not found");
			}

			const id = `ver_${ulid()}` as VersionId;
			const content_hash = this.computeContentHash(content_md);
			const version: Version = {
				id,
				note_id,
				content_md,
				metadata,
				content_hash,
				created_at: new Date(),
				parent_version_id,
				label,
			};

			this.state.versions.set(id, version);

			// Update note's current version
			const note = this.state.notes.get(note_id)!;
			this.state.notes.set(note_id, {
				...note,
				current_version_id: id,
				updated_at: new Date(),
			});

			return version;
		}).pipe(Effect.catchAll(() => storageError(notFound("Note", note_id))));

	readonly getVersion = (id: VersionId): Effect.Effect<Version, StorageError> =>
		Effect.sync(() => {
			const version = this.state.versions.get(id);
			if (!version) {
				throw new Error("Version not found");
			}
			return version;
		}).pipe(Effect.catchAll(() => storageError(notFound("Version", id))));

	readonly listVersions = (
		note_id: NoteId,
		options?: ListOptions,
	): Effect.Effect<readonly Version[], StorageError> =>
		Effect.sync(() => {
			let versions = Array.from(this.state.versions.values()).filter(
				(v) => v.note_id === note_id,
			);

			// Sort by created_at descending (newest first)
			versions.sort((a, b) => b.created_at.getTime() - a.created_at.getTime());

			// Apply pagination
			if (options?.offset || options?.limit) {
				const offset = options?.offset || 0;
				const limit = options?.limit || versions.length;
				versions = versions.slice(offset, offset + limit);
			}

			return versions;
		});

	readonly getCurrentVersion = (note_id: NoteId): Effect.Effect<Version, StorageError> =>
		Effect.sync(() => {
			const note = this.state.notes.get(note_id);
			if (!note?.current_version_id) {
				throw new Error("No current version");
			}

			const version = this.state.versions.get(note.current_version_id);
			if (!version) {
				throw new Error("Current version not found");
			}

			return version;
		}).pipe(Effect.catchAll(() => storageError(notFound("CurrentVersion", note_id))));

	// Publication operations (placeholder implementations)
	readonly publishVersion = (
		request: PublishRequest,
	): Effect.Effect<PublishResponse, StorageError> =>
		Effect.sync(() => {
			// This would integrate with the visibility pipeline
			return {
				version_id: `ver_${ulid()}` as VersionId,
				note_id: request.note_id,
				status: "version_created" as const,
				estimated_searchable_in: 5000,
			};
		});

	readonly rollbackToVersion = (
		request: RollbackRequest,
	): Effect.Effect<RollbackResponse, StorageError> =>
		Effect.sync(() => {
			// This would create a new version referencing the target
			return {
				new_version_id: `ver_${ulid()}` as VersionId,
				note_id: request.note_id,
				target_version_id: request.target_version_id,
				status: "version_created" as const,
			};
		});

	// Collection operations
	readonly createCollection = (
		name: string,
		description?: string,
	): Effect.Effect<Collection, StorageError> =>
		Effect.sync(() => {
			// Check for unique name
			for (const collection of this.state.collections.values()) {
				if (collection.name.toLowerCase() === name.toLowerCase()) {
					throw new Error("Collection name already exists");
				}
			}

			const id = `col_${ulid()}` as CollectionId;
			const collection: Collection = {
				id,
				name,
				description,
				created_at: new Date(),
			};

			this.state.collections.set(id, collection);
			return collection;
		}).pipe(
			Effect.catchAll(() =>
				storageError({
					_tag: "ConflictError",
					message: "Collection name already exists",
				}),
			),
		);

	readonly getCollection = (id: CollectionId): Effect.Effect<Collection, StorageError> =>
		Effect.sync(() => {
			const collection = this.state.collections.get(id);
			if (!collection) {
				throw new Error("Collection not found");
			}
			return collection;
		}).pipe(Effect.catchAll(() => storageError(notFound("Collection", id))));

	readonly getCollectionByName = (name: string): Effect.Effect<Collection, StorageError> =>
		Effect.sync(() => {
			for (const collection of this.state.collections.values()) {
				if (collection.name.toLowerCase() === name.toLowerCase()) {
					return collection;
				}
			}
			throw new Error("Collection not found");
		}).pipe(Effect.catchAll(() => storageError(notFound("Collection", name))));

	readonly listCollections = (
		options?: ListOptions,
	): Effect.Effect<readonly Collection[], StorageError> =>
		Effect.sync(() => {
			let collections = Array.from(this.state.collections.values());

			// Sort by name
			collections.sort((a, b) => a.name.localeCompare(b.name));

			// Apply pagination
			if (options?.offset || options?.limit) {
				const offset = options?.offset || 0;
				const limit = options?.limit || collections.length;
				collections = collections.slice(offset, offset + limit);
			}

			return collections;
		});

	// Placeholder implementations for remaining operations
	readonly updateCollection = () => Effect.succeed({} as Collection);
	readonly deleteCollection = () => Effect.succeed(undefined);
	readonly addToCollections = () => Effect.succeed(undefined);
	readonly removeFromCollections = () => Effect.succeed(undefined);
	readonly getNoteCollections = () => Effect.succeed([] as Collection[]);
	readonly getCollectionNotes = () => Effect.succeed([] as Note[]);
	readonly createSession = () => Effect.succeed({} as Session);
	readonly getSession = () => Effect.succeed({} as Session);
	readonly updateSession = () => Effect.succeed({} as Session);
	readonly listSessions = () => Effect.succeed([] as Session[]);
	readonly pinSession = () => Effect.succeed(undefined);
	readonly createSnapshot = () => Effect.succeed({} as Snapshot);
	readonly getSnapshot = () => Effect.succeed({} as Snapshot);
	readonly listSnapshots = () => Effect.succeed([] as Snapshot[]);
	readonly restoreSnapshot = () => Effect.succeed(undefined);
	readonly deleteSnapshot = () => Effect.succeed(undefined);
	readonly getPublication = () => Effect.succeed({} as Publication);
	readonly listPublications = () => Effect.succeed([] as Publication[]);
	readonly withTransaction = <A>(op: Effect.Effect<A, StorageError>) => op;
	readonly getStorageHealth = () =>
		Effect.succeed({ status: "healthy" as const, details: "In-memory storage" });
	readonly performMaintenance = () => Effect.succeed(undefined);

	// Helper methods
	private computeContentHash(content: string): ContentHash {
		// Simple hash for development (use crypto.subtle.digest in production)
		let hash = 0;
		for (let i = 0; i < content.length; i++) {
			const char = content.charCodeAt(i);
			hash = (hash << 5) - hash + char;
			hash = hash & hash; // Convert to 32-bit integer
		}
		return Math.abs(hash).toString(16).padStart(16, "0").repeat(4) as ContentHash;
	}
}

/**
 * Creates a new memory storage adapter instance
 */
export const createMemoryStorageAdapter = (): StoragePort => new MemoryStorageAdapter();
