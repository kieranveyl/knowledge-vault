/**
 * PostgreSQL storage adapter implementation
 *
 * References SPEC.md Section 4: Editor ↔ Store contract
 * Implements StoragePort using PostgreSQL for persistent storage
 */

import { Effect } from "effect";
import { ulid } from "ulid";
import type {
  Collection,
  CollectionId,
  ContentHash,
  Draft,
  Note,
  NoteId,
  NoteMetadata,
  Publication,
  PublicationId,
  Session,
  Snapshot,
  Version,
  VersionId,
  VersionLabel,
} from "../../schema/entities";

import type {
  PublishRequest,
  PublishResponse,
  RollbackRequest,
  RollbackResponse,
  SaveDraftRequest,
  SaveDraftResponse,
} from "../../schema/api";

import type {
  CollectionFilter,
  ListOptions,
  StorageError,
  StoragePort,
} from "../../services/storage.port";

import { DatabasePool, type DatabaseError } from "./database";

/**
 * Row type mappings for database results
 */
interface NoteRow {
  id: string;
  title: string;
  metadata: any;
  created_at: Date;
  updated_at: Date;
  current_version_id: string | null;
}

interface DraftRow {
  note_id: string;
  body_md: string;
  metadata: any;
  autosave_ts: Date;
}

interface VersionRow {
  id: string;
  note_id: string;
  content_md: string;
  metadata: any;
  content_hash: string;
  created_at: Date;
  parent_version_id: string | null;
  label: string;
}

interface CollectionRow {
  id: string;
  name: string;
  description: string | null;
  created_at: Date;
}

/**
 * Maps database error to storage error
 */
function mapDatabaseError(error: DatabaseError): StorageError {
  switch (error._tag) {
    case "ConnectionFailed":
      return { _tag: "StorageIOError", cause: error };
    case "QueryFailed":
      // Check for NOT FOUND errors
      if (
        error.reason.includes("not found") ||
        error.reason.includes("does not exist")
      ) {
        return { _tag: "NotFound", entity: "Unknown", id: "unknown" };
      }

      // Check for UNIQUE CONSTRAINT violations (conflicts)
      if (
        error.reason.includes(
          "duplicate key value violates unique constraint",
        ) ||
        error.reason.includes("unique constraint") ||
        error.reason.includes("duplicate") ||
        error.reason.includes("already exists")
      ) {
        return { _tag: "ConflictError", message: error.reason };
      }

      // Check for FOREIGN KEY violations
      if (
        error.reason.includes("foreign key") ||
        error.reason.includes("violates foreign key constraint")
      ) {
        return { _tag: "ValidationError", errors: [error.reason] };
      }

      return { _tag: "StorageIOError", cause: error };
    case "TransactionFailed":
      return { _tag: "StorageIOError", cause: error };
    default:
      return { _tag: "StorageIOError", cause: error };
  }
}

/**
 * Converts database row to Note entity
 */
function mapNoteRow(row: NoteRow): Note {
  return {
    id: row.id as NoteId,
    title: row.title,
    metadata: row.metadata || {},
    created_at: row.created_at,
    updated_at: row.updated_at,
    current_version_id: row.current_version_id as VersionId | undefined,
  };
}

/**
 * Converts database row to Draft entity
 */
function mapDraftRow(row: DraftRow): Draft {
  return {
    note_id: row.note_id as NoteId,
    body_md: row.body_md,
    metadata: row.metadata || {},
    autosave_ts: row.autosave_ts,
  };
}

/**
 * Converts database row to Version entity
 */
function mapVersionRow(row: VersionRow): Version {
  return {
    id: row.id as VersionId,
    note_id: row.note_id as NoteId,
    content_md: row.content_md,
    metadata: row.metadata || {},
    content_hash: row.content_hash as ContentHash,
    created_at: row.created_at,
    parent_version_id: row.parent_version_id as VersionId | undefined,
    label: row.label as VersionLabel,
  };
}

/**
 * Converts database row to Collection entity
 */
function mapCollectionRow(row: CollectionRow): Collection {
  return {
    id: row.id as CollectionId,
    name: row.name,
    description: row.description || undefined,
    created_at: row.created_at,
  };
}

/**
 * Computes content hash using crypto
 */
async function computeContentHash(content: string): Promise<ContentHash> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hashHex as ContentHash;
}

/**
 * PostgreSQL storage adapter implementation
 */
export class PostgresStorageAdapter implements StoragePort {
  constructor(private readonly db: DatabasePool) {}

  // Workspace operations
  readonly initializeWorkspace = (): Effect.Effect<void, StorageError> =>
    this.db
      .query(
        "SELECT 1 FROM workspace_config WHERE initialized_at IS NOT NULL LIMIT 1",
      )
      .pipe(
        Effect.asVoid,
        Effect.catchAll((error) => Effect.fail(mapDatabaseError(error))),
      );

  readonly isWorkspaceInitialized = (): Effect.Effect<boolean, StorageError> =>
    this.db
      .query<{
        count: string;
      }>("SELECT COUNT(*) as count FROM workspace_config")
      .pipe(
        Effect.map((rows) => Number.parseInt(rows[0].count, 10) > 0),
        Effect.catchAll((error) => Effect.fail(mapDatabaseError(error))),
      );

  // Note operations
  readonly createNote = (
    title: string,
    initialContent: string,
    metadata: NoteMetadata,
  ): Effect.Effect<Note, StorageError> =>
    this.db
      .transaction((query) =>
        Effect.gen(this, function* () {
          const id = `note_${ulid()}` as NoteId;
          const now = new Date();

          // Create note
          yield* query(
            `INSERT INTO notes (id, title, metadata, created_at, updated_at)
					 VALUES ($1, $2, $3, $4, $5)`,
            [id, title, JSON.stringify(metadata), now, now],
          );

          // Create initial draft
          yield* query(
            `INSERT INTO drafts (note_id, body_md, metadata, autosave_ts)
					 VALUES ($1, $2, $3, $4)`,
            [id, initialContent, JSON.stringify(metadata), now],
          );

          return {
            id,
            title,
            metadata,
            created_at: now,
            updated_at: now,
          };
        }),
      )
      .pipe(Effect.catchAll((error) => Effect.fail(mapDatabaseError(error))));

  readonly getNote = (id: NoteId): Effect.Effect<Note, StorageError> =>
    this.db.query<NoteRow>("SELECT * FROM notes WHERE id = $1", [id]).pipe(
      Effect.flatMap((rows) => {
        if (rows.length === 0) {
          return Effect.fail({
            _tag: "NotFound",
            entity: "Note",
            id,
          } as StorageError);
        }
        return Effect.succeed(mapNoteRow(rows[0]));
      }),
      Effect.catchAll((error) => Effect.fail(mapDatabaseError(error))),
    );

  readonly listNotes = (
    filter?: CollectionFilter,
    options?: ListOptions,
  ): Effect.Effect<readonly Note[], StorageError> =>
    Effect.gen(this, function* () {
      let query = "SELECT n.* FROM notes n";
      const params: any[] = [];
      let paramIndex = 1;

      // Apply collection filter
      if (filter?.collection_ids?.length) {
        query += ` INNER JOIN collection_memberships cm ON n.id = cm.note_id
						   WHERE cm.collection_id = ANY($${paramIndex})`;
        params.push(filter.collection_ids);
        paramIndex++;
      }

      // Apply ordering
      query += " ORDER BY n.updated_at DESC";

      // Apply pagination
      if (options?.limit) {
        query += ` LIMIT $${paramIndex}`;
        params.push(options.limit);
        paramIndex++;
      }

      if (options?.offset) {
        query += ` OFFSET $${paramIndex}`;
        params.push(options.offset);
      }

      const rows = yield* this.db.query<NoteRow>(query, params);
      return rows.map(mapNoteRow);
    }).pipe(Effect.catchAll((error) => Effect.fail(mapDatabaseError(error))));

  readonly updateNoteMetadata = (
    id: NoteId,
    metadata: NoteMetadata,
  ): Effect.Effect<Note, StorageError> =>
    this.db
      .transaction((query) =>
        Effect.gen(this, function* () {
          const now = new Date();

          yield* query(
            "UPDATE notes SET metadata = $1, updated_at = $2 WHERE id = $3",
            [JSON.stringify(metadata), now, id],
          );

          const updated = yield* query<NoteRow>(
            "SELECT * FROM notes WHERE id = $1",
            [id],
          );

          if (updated.length === 0) {
            yield* Effect.fail({
              _tag: "NotFound",
              entity: "Note",
              id,
            } as StorageError);
          }

          return mapNoteRow(updated[0]);
        }),
      )
      .pipe(Effect.catchAll((error) => Effect.fail(mapDatabaseError(error))));

  readonly deleteNote = (id: NoteId): Effect.Effect<void, StorageError> =>
    this.db.query("DELETE FROM notes WHERE id = $1", [id]).pipe(
      Effect.asVoid,
      Effect.catchAll((error) => Effect.fail(mapDatabaseError(error))),
    );

  // Draft operations
  readonly saveDraft = (
    request: SaveDraftRequest,
  ): Effect.Effect<SaveDraftResponse, StorageError> =>
    Effect.gen(this, function* () {
      const now = new Date();

      // Upsert draft (INSERT ... ON CONFLICT UPDATE)
      yield* this.db.query(
        `INSERT INTO drafts (note_id, body_md, metadata, autosave_ts)
				 VALUES ($1, $2, $3, $4)
				 ON CONFLICT (note_id)
				 DO UPDATE SET body_md = $2, metadata = $3, autosave_ts = $4`,
        [
          request.note_id,
          request.body_md,
          JSON.stringify(request.metadata),
          now,
        ],
      );

      return {
        note_id: request.note_id,
        autosave_ts: now,
        status: "saved" as const,
      };
    }).pipe(Effect.catchAll((error) => Effect.fail(mapDatabaseError(error))));

  readonly getDraft = (note_id: NoteId): Effect.Effect<Draft, StorageError> =>
    this.db
      .query<DraftRow>("SELECT * FROM drafts WHERE note_id = $1", [note_id])
      .pipe(
        Effect.mapError(mapDatabaseError),
        Effect.flatMap((rows) => {
          if (rows.length === 0) {
            return Effect.fail({
              _tag: "NotFound",
              entity: "Draft",
              id: note_id,
            } as StorageError);
          }
          return Effect.succeed(mapDraftRow(rows[0]));
        }),
      );

  readonly hasDraft = (note_id: NoteId): Effect.Effect<boolean, StorageError> =>
    this.db
      .query<{
        count: string;
      }>("SELECT COUNT(*) as count FROM drafts WHERE note_id = $1", [note_id])
      .pipe(
        Effect.map((rows) => Number.parseInt(rows[0].count, 10) > 0),
        Effect.catchAll((error) => Effect.fail(mapDatabaseError(error))),
      );

  readonly deleteDraft = (note_id: NoteId): Effect.Effect<void, StorageError> =>
    this.db.query("DELETE FROM drafts WHERE note_id = $1", [note_id]).pipe(
      Effect.asVoid,
      Effect.catchAll((error) => Effect.fail(mapDatabaseError(error))),
    );

  // Version operations
  readonly createVersion = (
    note_id: NoteId,
    content_md: string,
    metadata: NoteMetadata,
    label: VersionLabel,
    parent_version_id?: VersionId,
  ): Effect.Effect<Version, StorageError> =>
    this.db
      .transaction((query) =>
        Effect.gen(this, function* () {
          const id = `ver_${ulid()}` as VersionId;
          const now = new Date();
          const content_hash = yield* Effect.promise(() =>
            computeContentHash(content_md),
          );

          // Create version
          yield* query(
            `INSERT INTO versions (id, note_id, content_md, metadata, content_hash, created_at, parent_version_id, label)
					 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              id,
              note_id,
              content_md,
              JSON.stringify(metadata),
              content_hash,
              now,
              parent_version_id,
              label,
            ],
          );

          // Update note's current version
          yield* query(
            "UPDATE notes SET current_version_id = $1, updated_at = $2 WHERE id = $3",
            [id, now, note_id],
          );

          return {
            id,
            note_id,
            content_md,
            metadata,
            content_hash,
            created_at: now,
            parent_version_id,
            label,
          };
        }),
      )
      .pipe(Effect.catchAll((error) => Effect.fail(mapDatabaseError(error))));

  readonly getVersion = (id: VersionId): Effect.Effect<Version, StorageError> =>
    this.db
      .query<VersionRow>("SELECT * FROM versions WHERE id = $1", [id])
      .pipe(
        Effect.flatMap((rows) => {
          if (rows.length === 0) {
            return Effect.fail({
              _tag: "NotFound",
              entity: "Version",
              id,
            } as StorageError);
          }
          return Effect.succeed(mapVersionRow(rows[0]));
        }),
        Effect.catchAll((error) => Effect.fail(mapDatabaseError(error))),
      );

  readonly listVersions = (
    note_id: NoteId,
    options?: ListOptions,
  ): Effect.Effect<readonly Version[], StorageError> =>
    Effect.gen(this, function* () {
      let query =
        "SELECT * FROM versions WHERE note_id = $1 ORDER BY created_at DESC";
      const params: any[] = [note_id];

      if (options?.limit) {
        query += ` LIMIT $2`;
        params.push(options.limit);

        if (options?.offset) {
          query += ` OFFSET $3`;
          params.push(options.offset);
        }
      }

      const rows = yield* this.db.query<VersionRow>(query, params);
      return rows.map(mapVersionRow);
    }).pipe(Effect.catchAll((error) => Effect.fail(mapDatabaseError(error))));

  readonly getCurrentVersion = (
    note_id: NoteId,
  ): Effect.Effect<Version, StorageError> =>
    this.db
      .query<VersionRow>(
        `SELECT v.* FROM versions v
			 INNER JOIN notes n ON v.id = n.current_version_id
			 WHERE n.id = $1`,
        [note_id],
      )
      .pipe(
        Effect.flatMap((rows) => {
          if (rows.length === 0) {
            return Effect.fail({
              _tag: "NotFound",
              entity: "CurrentVersion",
              id: note_id,
            } as StorageError);
          }
          return Effect.succeed(mapVersionRow(rows[0]));
        }),
        Effect.catchAll((error) => Effect.fail(mapDatabaseError(error))),
      );

  // Publication operations with event emission
  readonly publishVersion = (
    request: PublishRequest,
  ): Effect.Effect<PublishResponse, StorageError> =>
    this.db
      .transaction((query) =>
        Effect.gen(this, function* () {
          // Get draft content
          const draftRows = yield* query<DraftRow>(
            "SELECT * FROM drafts WHERE note_id = $1",
            [request.note_id],
          );

          if (draftRows.length === 0) {
            yield* Effect.fail({
              _tag: "NotFound",
              entity: "Draft",
              id: request.note_id,
            } as StorageError);
          }

          const draft = mapDraftRow(draftRows[0]);

          // Create version
          const version = yield* this.createVersion(
            request.note_id,
            draft.body_md,
            draft.metadata,
            request.label || "minor",
          );

          // Create publication record
          const publicationId = `pub_${ulid()}` as PublicationId;
          yield* query(
            `INSERT INTO publications (id, note_id, version_id, published_at, label)
					 VALUES ($1, $2, $3, $4, $5)`,
            [
              publicationId,
              request.note_id,
              version.id,
              new Date(),
              request.label,
            ],
          );

          // Link to collections
          for (const collectionId of request.collections) {
            yield* query(
              `INSERT INTO publication_collections (publication_id, collection_id)
						 VALUES ($1, $2)`,
              [publicationId, collectionId],
            );
          }

          // TODO: Emit VisibilityEvent here
          // This would integrate with the visibility pipeline

          return {
            version_id: version.id,
            note_id: request.note_id,
            status: "version_created" as const,
            estimated_searchable_in: 5000,
          };
        }),
      )
      .pipe(Effect.catchAll((error) => Effect.fail(mapDatabaseError(error))));

  readonly rollbackToVersion = (
    request: RollbackRequest,
  ): Effect.Effect<RollbackResponse, StorageError> =>
    this.db
      .transaction((query) =>
        Effect.gen(this, function* () {
          // Get target version
          const targetRows = yield* query<VersionRow>(
            "SELECT * FROM versions WHERE id = $1",
            [request.target_version_id],
          );

          if (targetRows.length === 0) {
            yield* Effect.fail({
              _tag: "NotFound",
              entity: "Version",
              id: request.target_version_id,
            } as StorageError);
          }

          const targetVersion = mapVersionRow(targetRows[0]);

          // Create new version referencing target (SPEC: rollback creates new Version)
          const newVersion = yield* this.createVersion(
            request.note_id,
            targetVersion.content_md,
            targetVersion.metadata,
            "major", // Rollback is major change
            request.target_version_id,
          );

          // TODO: Emit VisibilityEvent for rollback

          return {
            new_version_id: newVersion.id,
            note_id: request.note_id,
            target_version_id: request.target_version_id,
            status: "version_created" as const,
          };
        }),
      )
      .pipe(Effect.catchAll((error) => Effect.fail(mapDatabaseError(error))));

  // Collection operations
  readonly createCollection = (
    name: string,
    description?: string,
  ): Effect.Effect<Collection, StorageError> =>
    Effect.gen(this, function* () {
      // Validate collection name
      if (!name || name.trim().length === 0) {
        yield* Effect.fail({
          _tag: "ValidationError",
          errors: ["Collection name cannot be empty"],
        } as StorageError);
      }
      
      if (name.length > 100) {
        yield* Effect.fail({
          _tag: "ValidationError", 
          errors: ["Collection name cannot exceed 100 characters"],
        } as StorageError);
      }

      const id = `col_${ulid()}` as CollectionId;
      const now = new Date();

      // Use mapError to transform database errors to storage errors
      yield* this.db
        .query(
          `INSERT INTO collections (id, name, description, created_at)
				 VALUES ($1, $2, $3, $4)`,
          [id, name, description, now],
        )
        .pipe(Effect.mapError(mapDatabaseError));

      return {
        id,
        name,
        description,
        created_at: now,
      };
    });

  readonly getCollection = (
    id: CollectionId,
  ): Effect.Effect<Collection, StorageError> =>
    this.db
      .query<CollectionRow>("SELECT * FROM collections WHERE id = $1", [id])
      .pipe(
        Effect.flatMap((rows) => {
          if (rows.length === 0) {
            return Effect.fail({
              _tag: "NotFound",
              entity: "Collection",
              id,
            } as StorageError);
          }
          return Effect.succeed(mapCollectionRow(rows[0]));
        }),
        Effect.catchAll((error) => Effect.fail(mapDatabaseError(error))),
      );

  readonly getCollectionByName = (
    name: string,
  ): Effect.Effect<Collection, StorageError> =>
    this.db
      .query<CollectionRow>(
        "SELECT * FROM collections WHERE LOWER(name) = LOWER($1)",
        [name],
      )
      .pipe(
        Effect.flatMap((rows) => {
          if (rows.length === 0) {
            return Effect.fail({
              _tag: "NotFound",
              entity: "Collection",
              id: name,
            } as StorageError);
          }
          return Effect.succeed(mapCollectionRow(rows[0]));
        }),
        Effect.catchAll((error) => Effect.fail(mapDatabaseError(error))),
      );

  readonly listCollections = (
    options?: ListOptions,
  ): Effect.Effect<readonly Collection[], StorageError> =>
    Effect.gen(this, function* () {
      let query = "SELECT * FROM collections ORDER BY name";
      const params: any[] = [];

      if (options?.limit) {
        query += " LIMIT $1";
        params.push(options.limit);

        if (options?.offset) {
          query += " OFFSET $2";
          params.push(options.offset);
        }
      }

      const rows = yield* this.db.query<CollectionRow>(query, params);
      return rows.map(mapCollectionRow);
    }).pipe(Effect.catchAll((error) => Effect.fail(mapDatabaseError(error))));

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

  readonly withTransaction = <A>(
    operation: Effect.Effect<A, StorageError>,
  ): Effect.Effect<A, StorageError> => this.db.transaction(() => operation);

  readonly getStorageHealth = (): Effect.Effect<
    { status: "healthy" | "degraded" | "unhealthy"; details?: string },
    StorageError
  > =>
    this.db.testConnection().pipe(
      Effect.map(() => ({
        status: "healthy" as const,
        details: "PostgreSQL connection active",
      })),
      Effect.catchAll((error) =>
        Effect.succeed({
          status: "unhealthy" as const,
          details: `Database connection failed: ${error}`,
        }),
      ),
    );

  readonly performMaintenance = (): Effect.Effect<void, StorageError> =>
    this.db.query("VACUUM ANALYZE").pipe(
      Effect.asVoid,
      Effect.catchAll((error) => Effect.fail(mapDatabaseError(error))),
    );
}

/**
 * Creates PostgreSQL storage adapter
 */
export function createPostgresStorageAdapter(db: DatabasePool): StoragePort {
  return new PostgresStorageAdapter(db);
}
