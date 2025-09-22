import { describe, expect, it, beforeEach } from "bun:test";
import { Effect } from "effect";
import { createMemoryStorageAdapter } from "../adapters/storage/memory.adapter";
import type { StoragePort } from "../services/storage.port";

describe("adapters/storage/memory", () => {
	let storage: StoragePort;

	beforeEach(() => {
		storage = createMemoryStorageAdapter();
	});

	describe("workspace operations", () => {
		it("initializes workspace", async () => {
			const result = await Effect.runPromise(storage.initializeWorkspace());
			expect(result).toBeUndefined();

			const isInitialized = await Effect.runPromise(storage.isWorkspaceInitialized());
			expect(isInitialized).toBe(true);
		});
	});

	describe("note operations", () => {
		beforeEach(async () => {
			await Effect.runPromise(storage.initializeWorkspace());
		});

		it("creates a new note with initial draft", async () => {
			const note = await Effect.runPromise(
				storage.createNote("Test Note", "Initial content", { tags: ["test"] }),
			);

			expect(note.title).toBe("Test Note");
			expect(note.metadata.tags).toEqual(["test"]);
			expect(note.id).toMatch(/^note_[0-9A-HJKMNP-TV-Z]{26}$/);
			expect(note.created_at).toBeInstanceOf(Date);
			expect(note.updated_at).toBeInstanceOf(Date);
		});

		it("retrieves note by ID", async () => {
			const createdNote = await Effect.runPromise(
				storage.createNote("Test Note", "Content", {}),
			);

			const retrievedNote = await Effect.runPromise(storage.getNote(createdNote.id));

			expect(retrievedNote.id).toBe(createdNote.id);
			expect(retrievedNote.title).toBe("Test Note");
		});

		it("fails to retrieve non-existent note", async () => {
			const invalidId = "note_01JBXR8G9P7QN1VMPX84KTFHK2" as any;

			await expect(Effect.runPromise(storage.getNote(invalidId))).rejects.toThrow();
		});

		it("lists notes", async () => {
			await Effect.runPromise(storage.createNote("Note 1", "Content 1", {}));
			await Effect.runPromise(storage.createNote("Note 2", "Content 2", {}));

			const notes = await Effect.runPromise(storage.listNotes());

			expect(notes).toHaveLength(2);
			expect(notes.map(n => n.title)).toContain("Note 1");
			expect(notes.map(n => n.title)).toContain("Note 2");
		});

		it("updates note metadata", async () => {
			const note = await Effect.runPromise(
				storage.createNote("Original Title", "Content", { tags: ["old"] }),
			);

			const updatedNote = await Effect.runPromise(
				storage.updateNoteMetadata(note.id, { tags: ["new", "updated"] }),
			);

			expect(updatedNote.metadata.tags).toEqual(["new", "updated"]);
			expect(updatedNote.updated_at.getTime()).toBeGreaterThanOrEqual(note.updated_at.getTime());
		});

		it("deletes note and all related data", async () => {
			const note = await Effect.runPromise(
				storage.createNote("Test Note", "Content", {}),
			);

			await Effect.runPromise(storage.deleteNote(note.id));

			await expect(Effect.runPromise(storage.getNote(note.id))).rejects.toThrow();
			await expect(Effect.runPromise(storage.getDraft(note.id))).rejects.toThrow();
		});
	});

	describe("draft operations", () => {
		let noteId: any;

		beforeEach(async () => {
			await Effect.runPromise(storage.initializeWorkspace());
			const note = await Effect.runPromise(
				storage.createNote("Test Note", "Initial content", {}),
			);
			noteId = note.id;
		});

		it("saves draft content", async () => {
			const request = {
				note_id: noteId,
				body_md: "Updated draft content",
				metadata: { tags: ["draft", "test"] },
			};

			const response = await Effect.runPromise(storage.saveDraft(request));

			expect(response.note_id).toBe(noteId);
			expect(response.status).toBe("saved");
			expect(response.autosave_ts).toBeInstanceOf(Date);
		});

		it("retrieves saved draft", async () => {
			const request = {
				note_id: noteId,
				body_md: "Draft content to retrieve",
				metadata: { tags: ["draft"] },
			};

			await Effect.runPromise(storage.saveDraft(request));
			const draft = await Effect.runPromise(storage.getDraft(noteId));

			expect(draft.note_id).toBe(noteId);
			expect(draft.body_md).toBe("Draft content to retrieve");
			expect(draft.metadata.tags).toEqual(["draft"]);
		});

		it("checks draft existence", async () => {
			// Initially has draft from note creation
			let hasDraft = await Effect.runPromise(storage.hasDraft(noteId));
			expect(hasDraft).toBe(true);

			await Effect.runPromise(storage.deleteDraft(noteId));
			hasDraft = await Effect.runPromise(storage.hasDraft(noteId));
			expect(hasDraft).toBe(false);
		});

		it("implements last-write-wins for draft saves", async () => {
			const request1 = {
				note_id: noteId,
				body_md: "First save",
				metadata: {},
			};

			const request2 = {
				note_id: noteId,
				body_md: "Second save",
				metadata: {},
			};

			await Effect.runPromise(storage.saveDraft(request1));
			await Effect.runPromise(storage.saveDraft(request2));

			const draft = await Effect.runPromise(storage.getDraft(noteId));
			expect(draft.body_md).toBe("Second save");
		});
	});

	describe("version operations", () => {
		let noteId: any;

		beforeEach(async () => {
			await Effect.runPromise(storage.initializeWorkspace());
			const note = await Effect.runPromise(
				storage.createNote("Test Note", "Initial content", {}),
			);
			noteId = note.id;
		});

		it("creates a new version", async () => {
			const version = await Effect.runPromise(
				storage.createVersion(
					noteId,
					"Version content",
					{ tags: ["v1"] },
					"minor",
				),
			);

			expect(version.note_id).toBe(noteId);
			expect(version.content_md).toBe("Version content");
			expect(version.metadata.tags).toEqual(["v1"]);
			expect(version.label).toBe("minor");
			expect(version.id).toMatch(/^ver_[0-9A-HJKMNP-TV-Z]{26}$/);
			expect(version.content_hash).toMatch(/^[a-f0-9]{64}$/);
		});

		it("updates note's current version on version creation", async () => {
			const version = await Effect.runPromise(
				storage.createVersion(noteId, "New version", {}, "major"),
			);

			const updatedNote = await Effect.runPromise(storage.getNote(noteId));
			expect(updatedNote.current_version_id).toBe(version.id);
		});

		it("creates version with parent reference", async () => {
			const firstVersion = await Effect.runPromise(
				storage.createVersion(noteId, "First version", {}, "minor"),
			);

			const secondVersion = await Effect.runPromise(
				storage.createVersion(
					noteId,
					"Second version",
					{},
					"minor",
					firstVersion.id,
				),
			);

			expect(secondVersion.parent_version_id).toBe(firstVersion.id);
		});

		it("lists versions in descending order", async () => {
			// Create multiple versions with delays to ensure different timestamps
			const version1 = await Effect.runPromise(
				storage.createVersion(noteId, "Version 1", {}, "minor"),
			);

			// Small delay to ensure different timestamps
			await new Promise(resolve => setTimeout(resolve, 10));

			const version2 = await Effect.runPromise(
				storage.createVersion(noteId, "Version 2", {}, "minor"),
			);

			const versions = await Effect.runPromise(storage.listVersions(noteId));

			expect(versions).toHaveLength(2);
			// Should be in descending order (newest first)
			expect(versions[0].id).toBe(version2.id);
			expect(versions[1].id).toBe(version1.id);
		});

		it("gets current version", async () => {
			const version = await Effect.runPromise(
				storage.createVersion(noteId, "Current version", {}, "minor"),
			);

			const currentVersion = await Effect.runPromise(storage.getCurrentVersion(noteId));

			expect(currentVersion.id).toBe(version.id);
			expect(currentVersion.content_md).toBe("Current version");
		});

		it("handles pagination for version listing", async () => {
			// Create 5 versions
			for (let i = 0; i < 5; i++) {
				await Effect.runPromise(
					storage.createVersion(noteId, `Version ${i}`, {}, "minor"),
				);
				await new Promise(resolve => setTimeout(resolve, 5)); // Ensure different timestamps
			}

			const firstPage = await Effect.runPromise(
				storage.listVersions(noteId, { offset: 0, limit: 2 }),
			);
			const secondPage = await Effect.runPromise(
				storage.listVersions(noteId, { offset: 2, limit: 2 }),
			);

			expect(firstPage).toHaveLength(2);
			expect(secondPage).toHaveLength(2);
			
			// Ensure no overlap
			const firstPageIds = new Set(firstPage.map(v => v.id));
			const secondPageIds = new Set(secondPage.map(v => v.id));
			const intersection = [...firstPageIds].filter(id => secondPageIds.has(id));
			expect(intersection).toHaveLength(0);
		});
	});

	describe("collection operations", () => {
		beforeEach(async () => {
			await Effect.runPromise(storage.initializeWorkspace());
		});

		it("creates a new collection", async () => {
			const collection = await Effect.runPromise(
				storage.createCollection("Test Collection", "A test collection"),
			);

			expect(collection.name).toBe("Test Collection");
			expect(collection.description).toBe("A test collection");
			expect(collection.id).toMatch(/^col_[0-9A-HJKMNP-TV-Z]{26}$/);
			expect(collection.created_at).toBeInstanceOf(Date);
		});

		it("enforces unique collection names", async () => {
			await Effect.runPromise(storage.createCollection("Unique Name"));

			await expect(
				Effect.runPromise(storage.createCollection("Unique Name")),
			).rejects.toThrow();
		});

		it("retrieves collection by ID", async () => {
			const created = await Effect.runPromise(
				storage.createCollection("Retrievable Collection"),
			);

			const retrieved = await Effect.runPromise(storage.getCollection(created.id));

			expect(retrieved.id).toBe(created.id);
			expect(retrieved.name).toBe("Retrievable Collection");
		});

		it("retrieves collection by name", async () => {
			const created = await Effect.runPromise(
				storage.createCollection("Findable Collection"),
			);

			const retrieved = await Effect.runPromise(
				storage.getCollectionByName("Findable Collection"),
			);

			expect(retrieved.id).toBe(created.id);
		});

		it("performs case-insensitive name lookup", async () => {
			const created = await Effect.runPromise(
				storage.createCollection("Case Sensitive"),
			);

			const retrieved = await Effect.runPromise(
				storage.getCollectionByName("case sensitive"),
			);

			expect(retrieved.id).toBe(created.id);
		});

		it("lists collections in alphabetical order", async () => {
			await Effect.runPromise(storage.createCollection("Zebra Collection"));
			await Effect.runPromise(storage.createCollection("Alpha Collection"));
			await Effect.runPromise(storage.createCollection("Beta Collection"));

			const collections = await Effect.runPromise(storage.listCollections());

			expect(collections).toHaveLength(3);
			expect(collections[0].name).toBe("Alpha Collection");
			expect(collections[1].name).toBe("Beta Collection");
			expect(collections[2].name).toBe("Zebra Collection");
		});

		it("handles pagination for collection listing", async () => {
			// Create 5 collections
			for (let i = 0; i < 5; i++) {
				await Effect.runPromise(storage.createCollection(`Collection ${i}`));
			}

			const firstPage = await Effect.runPromise(
				storage.listCollections({ offset: 0, limit: 2 }),
			);
			const secondPage = await Effect.runPromise(
				storage.listCollections({ offset: 2, limit: 2 }),
			);

			expect(firstPage).toHaveLength(2);
			expect(secondPage).toHaveLength(2);
		});
	});

	describe("interface compliance", () => {
		it("implements all required StoragePort methods", () => {
			const adapter = createMemoryStorageAdapter();

			// Verify all methods exist (TypeScript compilation ensures type compliance)
			expect(typeof adapter.initializeWorkspace).toBe("function");
			expect(typeof adapter.isWorkspaceInitialized).toBe("function");
			expect(typeof adapter.createNote).toBe("function");
			expect(typeof adapter.getNote).toBe("function");
			expect(typeof adapter.listNotes).toBe("function");
			expect(typeof adapter.updateNoteMetadata).toBe("function");
			expect(typeof adapter.deleteNote).toBe("function");
			expect(typeof adapter.saveDraft).toBe("function");
			expect(typeof adapter.getDraft).toBe("function");
			expect(typeof adapter.hasDraft).toBe("function");
			expect(typeof adapter.deleteDraft).toBe("function");
			expect(typeof adapter.createVersion).toBe("function");
			expect(typeof adapter.getVersion).toBe("function");
			expect(typeof adapter.listVersions).toBe("function");
			expect(typeof adapter.getCurrentVersion).toBe("function");
			expect(typeof adapter.publishVersion).toBe("function");
			expect(typeof adapter.rollbackToVersion).toBe("function");
			expect(typeof adapter.createCollection).toBe("function");
			expect(typeof adapter.getCollection).toBe("function");
			expect(typeof adapter.getCollectionByName).toBe("function");
			expect(typeof adapter.listCollections).toBe("function");
			expect(typeof adapter.withTransaction).toBe("function");
			expect(typeof adapter.getStorageHealth).toBe("function");
		});

		it("returns Effect types for all operations", async () => {
			const adapter = createMemoryStorageAdapter();

			// Test that methods return Effect types by checking they can be run with Effect.runPromise
			const initResult = await Effect.runPromise(adapter.initializeWorkspace());
			expect(initResult).toBeUndefined();

			const healthResult = await Effect.runPromise(adapter.getStorageHealth());
			expect(healthResult.status).toBe("healthy");
		});
	});

	describe("error handling", () => {
		beforeEach(async () => {
			await Effect.runPromise(storage.initializeWorkspace());
		});

		it("handles not found errors properly", async () => {
			const invalidId = "note_01JBXR8G9P7QN1VMPX84KTFHK2" as any;

			const result = await Effect.runPromiseExit(storage.getNote(invalidId));

			expect(result._tag).toBe("Failure");
			if (result._tag === "Failure") {
				expect(result.cause).toBeDefined();
			}
		});

		it("handles validation errors for collection name conflicts", async () => {
			await Effect.runPromise(storage.createCollection("Conflict Name"));

			const result = await Effect.runPromiseExit(
				storage.createCollection("Conflict Name"),
			);

			expect(result._tag).toBe("Failure");
		});
	});

	describe("data consistency", () => {
		beforeEach(async () => {
			await Effect.runPromise(storage.initializeWorkspace());
		});

		it("maintains referential integrity between notes and drafts", async () => {
			const note = await Effect.runPromise(
				storage.createNote("Test Note", "Initial content", {}),
			);

			// Should automatically create draft
			const draft = await Effect.runPromise(storage.getDraft(note.id));
			expect(draft.note_id).toBe(note.id);
			expect(draft.body_md).toBe("Initial content");
		});

		it("maintains referential integrity between notes and versions", async () => {
			const note = await Effect.runPromise(
				storage.createNote("Test Note", "Initial content", {}),
			);

			const version = await Effect.runPromise(
				storage.createVersion(note.id, "Version content", {}, "minor"),
			);

			expect(version.note_id).toBe(note.id);

			// Note should reference the new version as current
			const updatedNote = await Effect.runPromise(storage.getNote(note.id));
			expect(updatedNote.current_version_id).toBe(version.id);
		});

		it("cleans up all related data when note is deleted", async () => {
			const note = await Effect.runPromise(
				storage.createNote("Test Note", "Content", {}),
			);

			// Create version
			const version = await Effect.runPromise(
				storage.createVersion(note.id, "Version content", {}, "minor"),
			);

			// Delete note
			await Effect.runPromise(storage.deleteNote(note.id));

			// All related data should be gone
			await expect(Effect.runPromise(storage.getNote(note.id))).rejects.toThrow();
			await expect(Effect.runPromise(storage.getDraft(note.id))).rejects.toThrow();
			await expect(Effect.runPromise(storage.getVersion(version.id))).rejects.toThrow();
		});
	});

	describe("health and status", () => {
		it("reports healthy status", async () => {
			const health = await Effect.runPromise(storage.getStorageHealth());

			expect(health.status).toBe("healthy");
			expect(health.details).toContain("memory");
		});

		it("supports transaction wrapper", async () => {
			await Effect.runPromise(storage.initializeWorkspace());

			const result = await Effect.runPromise(
				storage.withTransaction(
					Effect.sync(() => "transaction result"),
				),
			);

			expect(result).toBe("transaction result");
		});
	});
});
