import { Effect } from "effect";
import { ulid } from "ulid";
import { createHash } from "crypto";
import type {
	StoragePort,
	StorageError,
	ListOptions,
	CollectionFilter,
} from "../../services/storage.port";
import type {
	PublishRequest,
	PublishResponse,
	RollbackRequest,
	RollbackResponse,
	SaveDraftRequest,
	SaveDraftResponse,
	SearchRequest,
	SearchResponse,
} from "../../schema/api";
import type {
	Collection,
	CollectionId,
	Draft,
	Note,
	NoteId,
	NoteMetadata,
	Publication,
	PublicationId,
	Version,
	VersionId,
} from "../../schema/entities";
import type {
	IndexingPort,
} from "../../services/indexing.port";
import type { VisibilityEvent } from "../../schema/events";
import { createKnowledgeApiApp, type ApiAdapterDependencies } from "../../adapters/api/elysia.adapter";

/**
 * Simple in-memory implementation of StoragePort for integration-style tests.
 * Only behaviours used by the Phase 1 test suites are implemented.
 */
class InMemoryStorageAdapter implements StoragePort {
	private readonly notes = new Map<NoteId, Note>();
	private readonly drafts = new Map<NoteId, Draft>();
	private readonly versions = new Map<VersionId, Version>();
	private readonly publications = new Map<PublicationId, Publication>();
	private readonly collections = new Map<CollectionId, Collection>();
	private readonly collectionMemberships = new Map<CollectionId, Set<NoteId>>();
	private readonly publishTokens = new Map<string, PublishResponse & { readonly note_id: NoteId }>();
	private readonly rollbackTokens = new Map<string, RollbackResponse & { readonly note_id: NoteId }>();
	private initialized = false;

	readonly initializeWorkspace = () =>
		Effect.sync(() => {
			this.initialized = true;
		});

	readonly isWorkspaceInitialized = () => Effect.succeed(this.initialized);

	readonly createNote = (
		title: string,
		initialContent: string,
		metadata: NoteMetadata,
	) =>
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
			const draft: Draft = {
				note_id: id,
				body_md: initialContent,
				metadata,
				autosave_ts: now,
			};
			this.notes.set(id, note);
			this.drafts.set(id, draft);
			return note;
		});

	readonly getNote = (id: NoteId) =>
		Effect.sync(() => {
			const note = this.notes.get(id);
			if (!note) {
				throw { _tag: "NotFound", entity: "Note", id } satisfies StorageError;
			}
			return note;
		});

	readonly listNotes = (
		_filter?: CollectionFilter,
		_options?: ListOptions,
	) => Effect.succeed(Array.from(this.notes.values()));

	readonly updateNoteMetadata = (
		id: NoteId,
		metadata: NoteMetadata,
	) =>
		Effect.sync(() => {
			const note = this.notes.get(id);
			if (!note) {
				throw { _tag: "NotFound", entity: "Note", id } satisfies StorageError;
			}
			const updated: Note = {
				...note,
				metadata,
				updated_at: new Date(),
			};
			this.notes.set(id, updated);
			return updated;
		});

	readonly deleteNote = (id: NoteId) =>
		Effect.sync(() => {
			this.notes.delete(id);
			this.drafts.delete(id);
		});

	readonly saveDraft = (
		request: SaveDraftRequest,
	) =>
		Effect.sync(() => {
			const existingNote = this.notes.get(request.note_id);
			if (!existingNote) {
				throw { _tag: "NotFound", entity: "Note", id: request.note_id } satisfies StorageError;
			}
			const autosaveTs = new Date();
			const draft: Draft = {
				note_id: request.note_id,
				body_md: request.body_md,
				metadata: request.metadata,
				autosave_ts: autosaveTs,
			};
			this.drafts.set(request.note_id, draft);
			return {
				note_id: request.note_id,
				autosave_ts: autosaveTs,
				status: "saved" as const,
			};
		});

	readonly getDraft = (note_id: NoteId) =>
		Effect.sync(() => {
			const draft = this.drafts.get(note_id);
			if (!draft) {
				throw { _tag: "NotFound", entity: "Draft", id: note_id } satisfies StorageError;
			}
			return draft;
		});

	readonly hasDraft = (note_id: NoteId) => Effect.succeed(this.drafts.has(note_id));

	readonly deleteDraft = (note_id: NoteId) =>
		Effect.sync(() => {
			this.drafts.delete(note_id);
		});

	readonly createVersion = (
		note_id: NoteId,
		content_md: string,
		metadata: NoteMetadata,
		label: "minor" | "major",
		parent_version_id?: VersionId,
	) =>
		Effect.sync(() => {
			const id = `ver_${ulid()}` as VersionId;
			const now = new Date();
			const hash = createHash("sha256").update(content_md).digest("hex");
			const version: Version = {
				id,
				note_id,
				content_md,
				metadata,
				content_hash: hash as any,
				created_at: now,
				parent_version_id,
				label,
			};
			this.versions.set(id, version);
			const note = this.notes.get(note_id);
			if (note) {
				this.notes.set(note_id, { ...note, current_version_id: id, updated_at: now });
			}
			return version;
		});

	readonly getVersion = (id: VersionId) =>
		Effect.sync(() => {
			const version = this.versions.get(id);
			if (!version) {
				throw { _tag: "NotFound", entity: "Version", id } satisfies StorageError;
			}
			return version;
		});

	readonly listVersions = (
		note_id: NoteId,
		_options?: ListOptions,
	) =>
		Effect.sync(() =>
			Array.from(this.versions.values())
				.filter((version) => version.note_id === note_id)
				.sort((a, b) => b.created_at.getTime() - a.created_at.getTime()),
		);

	readonly getCurrentVersion = (note_id: NoteId) =>
		Effect.sync(() => {
			const note = this.notes.get(note_id);
			if (!note?.current_version_id) {
				throw { _tag: "NotFound", entity: "CurrentVersion", id: note_id } satisfies StorageError;
			}
			return this.versions.get(note.current_version_id)!;
		});

	readonly publishVersion = (
		request: PublishRequest,
	) =>
		Effect.sync(() => {
			const note = this.notes.get(request.note_id);
			if (!note) {
				throw { _tag: "NotFound", entity: "Note", id: request.note_id } satisfies StorageError;
			}
			const tokenKey = `publish:${request.client_token}`;
			const cached = this.publishTokens.get(tokenKey);
			if (cached) {
				return cached;
			}
			const draft = this.drafts.get(request.note_id);
			if (!draft) {
				throw { _tag: "NotFound", entity: "Draft", id: request.note_id } satisfies StorageError;
			}
			const version = Effect.runSync(
				this.createVersion(
					request.note_id,
					draft.body_md,
					draft.metadata,
					(request.label ?? "minor") as "minor" | "major",
				),
			);
			const publicationId = `pub_${ulid()}` as PublicationId;
			const publication: Publication = {
				id: publicationId,
				note_id: request.note_id,
				version_id: version.id,
				collections: request.collections,
				published_at: new Date(),
				label: request.label,
			};
			this.publications.set(publicationId, publication);
			for (const collectionId of request.collections) {
				if (!this.collectionMemberships.has(collectionId)) {
					this.collectionMemberships.set(collectionId, new Set());
				}
				this.collectionMemberships.get(collectionId)!.add(request.note_id);
			}
			const response: PublishResponse = {
				version_id: version.id,
				note_id: request.note_id,
				status: "version_created",
				estimated_searchable_in: 5000,
			};
			this.publishTokens.set(tokenKey, { ...response, note_id: request.note_id });
			this.drafts.delete(request.note_id);
			return response;
		});

	readonly rollbackToVersion = (
		request: RollbackRequest,
	) =>
		Effect.sync(() => {
			const tokenKey = `rollback:${request.client_token}`;
			const cached = this.rollbackTokens.get(tokenKey);
			if (cached) {
				return cached;
			}
			const target = this.versions.get(request.target_version_id);
			if (!target) {
				throw { _tag: "NotFound", entity: "Version", id: request.target_version_id } satisfies StorageError;
			}
			const version = Effect.runSync(
				this.createVersion(
					request.note_id,
					target.content_md,
					target.metadata,
					"major",
					request.target_version_id,
				),
			);
			const response: RollbackResponse = {
				new_version_id: version.id,
				note_id: request.note_id,
				target_version_id: request.target_version_id,
				status: "version_created",
			};
			this.rollbackTokens.set(tokenKey, { ...response, note_id: request.note_id });
			return response;
		});

	readonly getPublication = (id: PublicationId) =>
		Effect.sync(() => {
			const publication = this.publications.get(id);
			if (!publication) {
				throw { _tag: "NotFound", entity: "Publication", id } satisfies StorageError;
			}
			return publication;
		});

	readonly listPublications = () => Effect.succeed(Array.from(this.publications.values()));

	readonly createCollection = (
		name: string,
		description?: string,
	) =>
		Effect.sync(() => {
			for (const collection of this.collections.values()) {
				if (collection.name === name) {
					throw { _tag: "ConflictError", message: "Collection name must be unique" } satisfies StorageError;
				}
			}
			const id = `col_${ulid()}` as CollectionId;
			const collection: Collection = {
				id,
				name,
				description,
				created_at: new Date(),
			};
			this.collections.set(id, collection);
			return collection;
		});

	readonly getCollection = (id: CollectionId) =>
		Effect.sync(() => {
			const collection = this.collections.get(id);
			if (!collection) {
				throw { _tag: "NotFound", entity: "Collection", id } satisfies StorageError;
			}
			return collection;
		});

	readonly getCollectionByName = (name: string) =>
		Effect.sync(() => {
			for (const collection of this.collections.values()) {
				if (collection.name === name) {
					return collection;
				}
			}
			throw { _tag: "NotFound", entity: "Collection", id: name } satisfies StorageError;
		});

	readonly listCollections = () => Effect.succeed(Array.from(this.collections.values()));

	readonly updateCollection = (
		id: CollectionId,
		updates: { name?: string; description?: string },
	) =>
		Effect.sync(() => {
			const collection = this.collections.get(id);
			if (!collection) {
				throw { _tag: "NotFound", entity: "Collection", id } satisfies StorageError;
			}
			const updated: Collection = {
				...collection,
				name: updates.name ?? collection.name,
				description: updates.description ?? collection.description,
			};
			this.collections.set(id, updated);
			return updated;
		});

	readonly deleteCollection = (id: CollectionId) =>
		Effect.sync(() => {
			this.collections.delete(id);
			this.collectionMemberships.delete(id);
		});

	readonly addToCollections = (
		note_id: NoteId,
		collection_ids: readonly CollectionId[],
	) =>
		Effect.sync(() => {
			for (const collectionId of collection_ids) {
				if (!this.collectionMemberships.has(collectionId)) {
					this.collectionMemberships.set(collectionId, new Set());
				}
				this.collectionMemberships.get(collectionId)!.add(note_id);
			}
		});

	readonly removeFromCollections = (
		note_id: NoteId,
		collection_ids: readonly CollectionId[],
	) =>
		Effect.sync(() => {
			for (const collectionId of collection_ids) {
				this.collectionMemberships.get(collectionId)?.delete(note_id);
			}
		});

	readonly getNoteCollections = (note_id: NoteId) =>
		Effect.sync(() => {
			const memberships: Collection[] = [];
			for (const [collectionId, noteIds] of this.collectionMemberships.entries()) {
				if (noteIds.has(note_id)) {
					const collection = this.collections.get(collectionId);
					if (collection) {
						memberships.push(collection);
					}
				}
			}
			return memberships;
		});

	readonly getCollectionNotes = (collection_id: CollectionId) =>
		Effect.sync(() => {
			const noteIds = this.collectionMemberships.get(collection_id);
			if (!noteIds) {
				return [];
			}
			return Array.from(noteIds).map((noteId) => this.notes.get(noteId)!).filter(Boolean);
		});

	readonly createSession = () => Effect.fail({ _tag: "StorageIOError", cause: "not implemented" });
	readonly getSession = () => Effect.fail({ _tag: "NotFound", entity: "Session", id: "unknown" });
	readonly updateSession = () => Effect.fail({ _tag: "StorageIOError", cause: "not implemented" });
	readonly listSessions = () => Effect.succeed([]);
	readonly pinSession = () => Effect.succeed(undefined);
	readonly createSnapshot = () => Effect.fail({ _tag: "StorageIOError", cause: "not implemented" });
	readonly getSnapshot = () => Effect.fail({ _tag: "NotFound", entity: "Snapshot", id: "unknown" });
	readonly listSnapshots = () => Effect.succeed([]);
	readonly restoreSnapshot = () => Effect.fail({ _tag: "StorageIOError", cause: "not implemented" });
	readonly deleteSnapshot = () => Effect.succeed(undefined);
	readonly withTransaction = <A>(operation: Effect.Effect<A, StorageError>) => operation;
	readonly getStorageHealth = () => Effect.succeed({ status: "healthy" as const });
	readonly performMaintenance = () => Effect.succeed(undefined);
}

interface FakeIndexingOptions {
	readonly searchImpl?: (request: SearchRequest) => SearchResponse;
}

class FakeIndexingAdapter implements IndexingPort {
	readonly events: VisibilityEvent[] = [];
	private searchHandler?: (request: SearchRequest) => SearchResponse;

	constructor(options?: FakeIndexingOptions) {
		this.searchHandler = options?.searchImpl;
	}

	setSearchHandler(searchImpl: (request: SearchRequest) => SearchResponse) {
		this.searchHandler = searchImpl;
	}

	readonly enqueueVisibilityEvent = (event: VisibilityEvent) =>
		Effect.sync(() => {
			this.events.push(event);
		});

	readonly search = (request: SearchRequest) =>
		Effect.sync(() => {
			if (!this.searchHandler) {
				throw new Error("Search handler not configured");
			}
			return this.searchHandler(request);
		});

	readonly processVisibilityEvent = () =>
		Effect.fail({ _tag: "IndexingFailure", reason: "not implemented", version_id: "ver_placeholder" as VersionId });
	readonly getVisibilityEventStatus = () =>
		Effect.fail({ _tag: "IndexingFailure", reason: "not implemented", version_id: "ver_placeholder" as VersionId });
	readonly getCurrentCorpus = () =>
		Effect.fail({ _tag: "IndexingFailure", reason: "not implemented", version_id: "ver_placeholder" as VersionId });
	readonly createCorpus = () =>
		Effect.fail({ _tag: "IndexingFailure", reason: "not implemented", version_id: "ver_placeholder" as VersionId });
	readonly getCorpusStats = () =>
		Effect.fail({ _tag: "IndexingFailure", reason: "not implemented", version_id: "ver_placeholder" as VersionId });
	readonly getCurrentIndex = () =>
		Effect.fail({ _tag: "IndexingFailure", reason: "not implemented", version_id: "ver_placeholder" as VersionId });
	readonly buildIndex = () =>
		Effect.fail({ _tag: "IndexingFailure", reason: "not implemented", version_id: "ver_placeholder" as VersionId });
	readonly getIndexBuildStatus = () =>
		Effect.fail({ _tag: "IndexingFailure", reason: "not implemented", version_id: "ver_placeholder" as VersionId });
	readonly commitIndex = () =>
		Effect.fail({ _tag: "IndexingFailure", reason: "not implemented", version_id: "ver_placeholder" as VersionId });
	readonly retrieveCandidates = () =>
		Effect.fail({ _tag: "IndexingFailure", reason: "not implemented", version_id: "ver_placeholder" as VersionId });
	readonly rerankCandidates = () =>
		Effect.fail({ _tag: "IndexingFailure", reason: "not implemented", version_id: "ver_placeholder" as VersionId });
	readonly indexVersion = () =>
		Effect.fail({ _tag: "IndexingFailure", reason: "not implemented", version_id: "ver_placeholder" as VersionId });
	readonly getVersionPassages = () =>
		Effect.fail({ _tag: "IndexingFailure", reason: "not implemented", version_id: "ver_placeholder" as VersionId });
	readonly resolvePassageContent = () =>
		Effect.fail({ _tag: "IndexingFailure", reason: "not implemented", version_id: "ver_placeholder" as VersionId });
	readonly performHealthCheck = () =>
		Effect.fail({ _tag: "IndexingFailure", reason: "not implemented", version_id: "ver_placeholder" as VersionId });
	readonly validateIndexIntegrity = () =>
		Effect.fail({ _tag: "IndexingFailure", reason: "not implemented", version_id: "ver_placeholder" as VersionId });
	readonly rebuildIndex = () =>
		Effect.fail({ _tag: "IndexingFailure", reason: "not implemented", version_id: "ver_placeholder" as VersionId });
	readonly optimizeIndex = () =>
		Effect.fail({ _tag: "IndexingFailure", reason: "not implemented", version_id: "ver_placeholder" as VersionId });
	readonly getQueueStatus = () =>
		Effect.succeed({ pending_count: this.events.length, processing_count: 0, failed_count: 0 });
	readonly retryFailedEvents = () => Effect.succeed({ retried_count: 0 });
}

class NoopParsingAdapter {
	readonly normalizeContent = (content: string) => Effect.succeed(content);
	readonly tokenizeContent = () => Effect.fail({ _tag: "TokenizationFailed", reason: "not implemented" });
	readonly extractMarkdownStructure = () => Effect.fail({ _tag: "StructureExtractionFailed", content: "" });
	readonly extractStructurePath = () => Effect.fail({ _tag: "StructureExtractionFailed", content: "" });
	readonly chunkContent = () => Effect.fail({ _tag: "TokenizationFailed", reason: "not implemented" });
	readonly validateChunkingConfig = () => Effect.fail({ _tag: "TokenizationFailed", reason: "not implemented" });
	readonly createAnchor = () => Effect.fail({ _tag: "TokenizationFailed", reason: "not implemented" });
	readonly resolveAnchor = () => Effect.fail({ _tag: "AnchorResolutionFailed", anchor: {} as any, reason: "not implemented" });
	readonly detectAnchorDrift = () => Effect.fail({ _tag: "TokenizationFailed", reason: "not implemented" });
	readonly extractAnchorContent = () => Effect.succeed(null);
	readonly analyzeContent = () => Effect.fail({ _tag: "TokenizationFailed", reason: "not implemented" });
	readonly summarizeContent = () => Effect.fail({ _tag: "TokenizationFailed", reason: "not implemented" });
	readonly tokenizeForRetrieval = () => Effect.fail({ _tag: "TokenizationFailed", reason: "not implemented" });
	readonly extractMetadata = () => Effect.fail({ _tag: "TokenizationFailed", reason: "not implemented" });
}

class NoopObservabilityAdapter {
	readonly recordEvent = () => Effect.succeed(undefined);
	readonly recordMetric = () => Effect.succeed(undefined);
	readonly recordError = () => Effect.succeed(undefined);
	readonly flush = () => Effect.succeed(undefined);
}

export interface TestApiContext {
	readonly storage: InMemoryStorageAdapter;
	readonly indexing: FakeIndexingAdapter;
	readonly parsing: NoopParsingAdapter;
	readonly observability: NoopObservabilityAdapter;
	readonly app: ReturnType<typeof createKnowledgeApiApp>;
}

export function createTestApi(options?: FakeIndexingOptions): TestApiContext {
	const storage = new InMemoryStorageAdapter();
	const indexing = new FakeIndexingAdapter(options);
	const parsing = new NoopParsingAdapter();
	const observability = new NoopObservabilityAdapter();

	const deps: ApiAdapterDependencies = {
		storage: storage as unknown as StoragePort,
		indexing: indexing as unknown as IndexingPort,
		parsing: parsing as any,
		observability: observability as any,
	};

	const app = createKnowledgeApiApp(deps);

	return {
		storage,
		indexing,
		parsing,
		observability,
		app,
	};
}
