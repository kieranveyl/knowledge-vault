/**
 * Storage port interface for persistence operations
 *
 * References SPEC.md Section 4: Editor ↔ Store contract
 * Defines abstract interface for storage operations across all domain entities
 */

import type { Effect } from "effect";
import type {
  Collection,
  CollectionId,
  Draft,
  Note,
  NoteId,
  NoteMetadata,
  Publication,
  PublicationId,
  Session,
  SessionId,
  Snapshot,
  SnapshotId,
  Version,
  VersionId,
  VersionLabel,
} from "../schema/entities";

import type {
  PublishRequest,
  PublishResponse,
  RollbackRequest,
  RollbackResponse,
  SaveDraftRequest,
  SaveDraftResponse,
} from "../schema/api";

/**
 * Storage error types
 */
export type StorageError =
  | { readonly _tag: "NotFound"; readonly entity: string; readonly id: string }
  | { readonly _tag: "ConflictError"; readonly message: string }
  | { readonly _tag: "ValidationError"; readonly errors: readonly string[] }
  | { readonly _tag: "StorageIOError"; readonly cause: unknown }
  | {
      readonly _tag: "SchemaVersionMismatch";
      readonly expected: string;
      readonly actual: string;
    };

/**
 * Collection membership relationship
 */
export interface CollectionMembership {
  readonly note_id: NoteId;
  readonly collection_id: CollectionId;
  readonly added_at: Date;
}

/**
 * Query options for listing operations
 */
export interface ListOptions {
  readonly limit?: number;
  readonly offset?: number;
  readonly order_by?: string;
  readonly order_direction?: "asc" | "desc";
}

/**
 * Collection filter options
 */
export interface CollectionFilter {
  readonly collection_ids?: readonly CollectionId[];
  readonly published_only?: boolean;
  readonly include_drafts?: boolean;
}

/**
 * Storage port interface for all persistence operations
 */
export interface StoragePort {
  // Workspace operations
  /**
   * Initializes workspace storage
   */
  readonly initializeWorkspace: () => Effect.Effect<void, StorageError>;

  /**
   * Checks if workspace is initialized
   */
  readonly isWorkspaceInitialized: () => Effect.Effect<boolean, StorageError>;

  // Note operations
  /**
   * Creates a new note with initial draft
   */
  readonly createNote: (
    title: string,
    initialContent: string,
    metadata: NoteMetadata,
  ) => Effect.Effect<Note, StorageError>;

  /**
   * Gets a note by ID
   */
  readonly getNote: (id: NoteId) => Effect.Effect<Note, StorageError>;

  /**
   * Lists notes with optional filtering
   */
  readonly listNotes: (
    filter?: CollectionFilter,
    options?: ListOptions,
  ) => Effect.Effect<readonly Note[], StorageError>;

  /**
   * Updates note metadata (not content - that goes through drafts/versions)
   */
  readonly updateNoteMetadata: (
    id: NoteId,
    metadata: NoteMetadata,
  ) => Effect.Effect<Note, StorageError>;

  /**
   * Deletes a note and all associated drafts/versions
   */
  readonly deleteNote: (id: NoteId) => Effect.Effect<void, StorageError>;

  // Draft operations
  /**
   * Saves draft content for a note
   * SPEC: "SaveDraft last-write-wins"
   */
  readonly saveDraft: (
    request: SaveDraftRequest,
  ) => Effect.Effect<SaveDraftResponse, StorageError>;

  /**
   * Gets current draft for a note
   */
  readonly getDraft: (note_id: NoteId) => Effect.Effect<Draft, StorageError>;

  /**
   * Checks if note has an active draft
   */
  readonly hasDraft: (note_id: NoteId) => Effect.Effect<boolean, StorageError>;

  /**
   * Deletes draft (when publishing or discarding changes)
   */
  readonly deleteDraft: (note_id: NoteId) => Effect.Effect<void, StorageError>;

  // Version operations
  /**
   * Creates a new version from current draft or existing version (for rollback)
   * SPEC: "Each publication emits a new immutable Version"
   */
  readonly createVersion: (
    note_id: NoteId,
    content_md: string,
    metadata: NoteMetadata,
    label: VersionLabel,
    parent_version_id?: VersionId,
  ) => Effect.Effect<Version, StorageError>;

  /**
   * Gets a version by ID
   */
  readonly getVersion: (id: VersionId) => Effect.Effect<Version, StorageError>;

  /**
   * Lists all versions for a note, ordered by created_at desc
   */
  readonly listVersions: (
    note_id: NoteId,
    options?: ListOptions,
  ) => Effect.Effect<readonly Version[], StorageError>;

  /**
   * Gets the current (latest) version for a note
   */
  readonly getCurrentVersion: (
    note_id: NoteId,
  ) => Effect.Effect<Version, StorageError>;

  // Publication operations
  /**
   * Publishes a version to collections
   * SPEC: "Publish/Rollback idempotent by client token"
   */
  readonly publishVersion: (
    request: PublishRequest,
  ) => Effect.Effect<PublishResponse, StorageError>;

  /**
   * Performs rollback by creating new version referencing target
   * SPEC: "Rollback creates new Version referencing target"
   */
  readonly rollbackToVersion: (
    request: RollbackRequest,
  ) => Effect.Effect<RollbackResponse, StorageError>;

  /**
   * Gets publication record by ID
   */
  readonly getPublication: (
    id: PublicationId,
  ) => Effect.Effect<Publication, StorageError>;

  /**
   * Lists publications for a note or collection
   */
  readonly listPublications: (
    filter?: { note_id?: NoteId; collection_id?: CollectionId },
    options?: ListOptions,
  ) => Effect.Effect<readonly Publication[], StorageError>;

  // Collection operations
  /**
   * Creates a new collection
   */
  readonly createCollection: (
    name: string,
    description?: string,
  ) => Effect.Effect<Collection, StorageError>;

  /**
   * Gets a collection by ID
   */
  readonly getCollection: (
    id: CollectionId,
  ) => Effect.Effect<Collection, StorageError>;

  /**
   * Gets a collection by name (unique per workspace)
   */
  readonly getCollectionByName: (
    name: string,
  ) => Effect.Effect<Collection, StorageError>;

  /**
   * Lists all collections
   */
  readonly listCollections: (
    options?: ListOptions,
  ) => Effect.Effect<readonly Collection[], StorageError>;

  /**
   * Updates collection metadata
   */
  readonly updateCollection: (
    id: CollectionId,
    updates: { name?: string; description?: string },
  ) => Effect.Effect<Collection, StorageError>;

  /**
   * Deletes a collection and all its memberships
   */
  readonly deleteCollection: (
    id: CollectionId,
  ) => Effect.Effect<void, StorageError>;

  // Collection membership operations
  /**
   * Adds note to collections
   */
  readonly addToCollections: (
    note_id: NoteId,
    collection_ids: readonly CollectionId[],
  ) => Effect.Effect<void, StorageError>;

  /**
   * Removes note from collections
   */
  readonly removeFromCollections: (
    note_id: NoteId,
    collection_ids: readonly CollectionId[],
  ) => Effect.Effect<void, StorageError>;

  /**
   * Gets all collections a note belongs to
   */
  readonly getNoteCollections: (
    note_id: NoteId,
  ) => Effect.Effect<readonly Collection[], StorageError>;

  /**
   * Gets all notes in a collection
   */
  readonly getCollectionNotes: (
    collection_id: CollectionId,
    options?: ListOptions,
  ) => Effect.Effect<readonly Note[], StorageError>;

  // Session operations
  /**
   * Creates a new session
   */
  readonly createSession: () => Effect.Effect<Session, StorageError>;

  /**
   * Gets a session by ID
   */
  readonly getSession: (id: SessionId) => Effect.Effect<Session, StorageError>;

  /**
   * Updates session with new steps
   */
  readonly updateSession: (
    id: SessionId,
    steps: Session["steps"],
    ended_at?: Date,
  ) => Effect.Effect<Session, StorageError>;

  /**
   * Lists recent sessions
   */
  readonly listSessions: (
    options?: ListOptions,
  ) => Effect.Effect<readonly Session[], StorageError>;

  /**
   * Pins or unpins a session (affects TTL)
   */
  readonly pinSession: (
    id: SessionId,
    pinned: boolean,
  ) => Effect.Effect<void, StorageError>;

  // Snapshot operations
  /**
   * Creates a workspace snapshot
   */
  readonly createSnapshot: (
    scope: string,
    description?: string,
  ) => Effect.Effect<Snapshot, StorageError>;

  /**
   * Gets a snapshot by ID
   */
  readonly getSnapshot: (
    id: SnapshotId,
  ) => Effect.Effect<Snapshot, StorageError>;

  /**
   * Lists snapshots
   */
  readonly listSnapshots: (
    options?: ListOptions,
  ) => Effect.Effect<readonly Snapshot[], StorageError>;

  /**
   * Restores workspace from snapshot
   */
  readonly restoreSnapshot: (
    id: SnapshotId,
  ) => Effect.Effect<void, StorageError>;

  /**
   * Deletes a snapshot
   */
  readonly deleteSnapshot: (
    id: SnapshotId,
  ) => Effect.Effect<void, StorageError>;

  // Transaction and consistency operations
  /**
   * Executes multiple operations in a transaction
   */
  readonly withTransaction: <A>(
    operation: Effect.Effect<A, StorageError>,
  ) => Effect.Effect<A, StorageError>;

  /**
   * Gets storage health status
   */
  readonly getStorageHealth: () => Effect.Effect<
    { status: "healthy" | "degraded" | "unhealthy"; details?: string },
    StorageError
  >;

  /**
   * Performs storage maintenance (cleanup, optimization)
   */
  readonly performMaintenance: () => Effect.Effect<void, StorageError>;
}

/**
 * Storage port identifier for dependency injection
 */
export const StoragePort = Symbol("StoragePort");
export type StoragePortSymbol = typeof StoragePort;
