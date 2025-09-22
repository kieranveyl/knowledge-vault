import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { Effect } from "effect";
import { createPostgresStorageAdapter } from "../adapters/storage/postgres.adapter";
import { createDatabasePool } from "../adapters/storage/database";
import { createOramaSearchAdapter } from "../adapters/search/orama.adapter";
import { createMarkdownParsingAdapter } from "../adapters/parsing/markdown.adapter";
import { createLocalObservabilityAdapter } from "../adapters/observability/local.adapter";
import { createKnowledgeApiApp, type ApiAdapterDependencies } from "../adapters/api/elysia.adapter";

describe("API Integration Tests", () => {
	let deps: ApiAdapterDependencies;
	let app: any;
	let db: any;

	beforeAll(async () => {
		// Create database pool and storage
		db = createDatabasePool();
		
		// Clean database before tests
		await db.query("TRUNCATE TABLE collections, notes, drafts, versions, publications CASCADE");
		
		// Create dependencies with PostgreSQL
		deps = {
			storage: createPostgresStorageAdapter(db),
			indexing: createOramaSearchAdapter(),
			parsing: createMarkdownParsingAdapter(),
			observability: createLocalObservabilityAdapter(),
		};

		// Initialize workspace
		await Effect.runPromise(deps.storage.initializeWorkspace());

		// Create API app
		app = createKnowledgeApiApp(deps);
	});

	afterAll(async () => {
		// Clean up database connection
		if (db) {
			await Effect.runPromise(db.close());
		}
	});

	describe("Health endpoints", () => {
		it("responds to health check", async () => {
			const response = await app.handle(new Request("http://localhost/healthz"));
			const data = await response.json();

			expect(response.status).toBe(200);
			expect(data.status).toBe("ok");
		});

		it("responds to detailed health check", async () => {
			const response = await app.handle(new Request("http://localhost/health"));
			const data = await response.json();

			expect(response.status).toBe(200);
			expect(data.status).toBe("healthy");
		});
	});

	describe("Collection operations", () => {
		it("creates a new collection", async () => {
			const request = new Request("http://localhost/collections", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name: "Test Collection",
					description: "A collection for testing"
				})
			});

			const response = await app.handle(request);
			const collection = await response.json();

			expect(response.status).toBe(200);
			expect(collection.name).toBe("Test Collection");
			expect(collection.description).toBe("A collection for testing");
			expect(collection.id).toMatch(/^col_[0-9A-HJKMNP-TV-Z]{26}$/);
		});

		it("lists collections", async () => {
			// Create a couple collections first
			await app.handle(new Request("http://localhost/collections", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "Alpha Collection" })
			}));

			await app.handle(new Request("http://localhost/collections", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "Beta Collection" })
			}));

			const response = await app.handle(new Request("http://localhost/collections"));
			const data = await response.json();

			expect(response.status).toBe(200);
			expect(data.collections).toBeDefined();
			expect(data.collections.length).toBeGreaterThanOrEqual(2);
		});

		it("handles collection name conflicts", async () => {
			const collectionData = {
				name: "Conflict Collection",
				description: "First instance"
			};

			// Create first collection
			const firstResponse = await app.handle(new Request("http://localhost/collections", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(collectionData)
			}));

			expect(firstResponse.status).toBe(200);

			// Try to create duplicate
			const duplicateResponse = await app.handle(new Request("http://localhost/collections", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(collectionData)
			}));

			expect(duplicateResponse.status).toBe(409); // Conflict
		});
	});

	describe("Note and draft operations", () => {
		let testCollectionId: string;

		beforeAll(async () => {
			// Create test collection
			const response = await app.handle(new Request("http://localhost/collections", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "Test Notes Collection" })
			}));
			const collection = await response.json();
			testCollectionId = collection.id;
		});

		it("creates note and saves draft", async () => {
			// Create note directly in storage
			const note = await Effect.runPromise(
				deps.storage.createNote(
					"Test Note Title",
					"# Test Note\n\nThis is initial content for testing.",
					{ tags: ["test", "integration"] }
				)
			);

			// Update draft content
			const draftRequest = new Request("http://localhost/drafts", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					note_id: note.id,
					body_md: "# Updated Test Note\n\nThis is updated draft content with more details.",
					metadata: { tags: ["test", "integration", "updated"] }
				})
			});

			const draftResponse = await app.handle(draftRequest);
			const draftResult = await draftResponse.json();

			expect(draftResponse.status).toBe(200);
			expect(draftResult.status).toBe("saved");
			expect(draftResult.note_id).toBe(note.id);
		});

		it("retrieves draft content", async () => {
			// Create note and draft
			const note = await Effect.runPromise(
				deps.storage.createNote(
					"Retrievable Note",
					"Initial content",
					{ tags: ["retrieve"] }
				)
			);

			// Get draft
			const response = await app.handle(
				new Request(`http://localhost/drafts/${note.id}`)
			);
			const draft = await response.json();

			expect(response.status).toBe(200);
			expect(draft.note_id).toBe(note.id);
			expect(draft.body_md).toBe("Initial content");
		});

		it("handles draft not found", async () => {
			const response = await app.handle(
				new Request("http://localhost/drafts/note_01JBXR8G9P7QN1VMPX84KTFHK2")
			);

			expect(response.status).toBe(404);
		});
	});

	describe("Error handling", () => {
		it("returns proper error format for validation failures", async () => {
			const invalidRequest = new Request("http://localhost/collections", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name: "", // Invalid: empty name
				})
			});

			const response = await app.handle(invalidRequest);
			const error = await response.json();

			expect(response.status).toBe(400);
			expect(error.error).toBeDefined();
			expect(error.error.type).toBe("ValidationError");
		});

		it("handles malformed JSON", async () => {
			const malformedRequest = new Request("http://localhost/collections", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: "{ malformed json"
			});

			const response = await app.handle(malformedRequest);

			expect(response.status).toBeGreaterThanOrEqual(400);
		});

		it("includes CORS headers", async () => {
			const response = await app.handle(new Request("http://localhost/healthz"));

			expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
		});
	});

	describe("End-to-end workflow", () => {
		it("completes note creation → draft editing → publication workflow", async () => {
			// 1. Create note
			const note = await Effect.runPromise(
				deps.storage.createNote(
					"E2E Test Note",
					"# Initial Content\n\nThis is the initial content.",
					{ tags: ["e2e", "test"] }
				)
			);

			// 2. Edit draft
			const draftResponse = await app.handle(new Request("http://localhost/drafts", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					note_id: note.id,
					body_md: "# Updated Content\n\nThis is updated content ready for publication.",
					metadata: { tags: ["e2e", "test", "ready"] }
				})
			}));

			expect(draftResponse.status).toBe(200);

			// 3. Create collection for publication
			const collectionResponse = await app.handle(new Request("http://localhost/collections", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "E2E Collection" })
			}));
			const collection = await collectionResponse.json();

			// 4. Publish note
			const publishResponse = await app.handle(new Request("http://localhost/publish", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					note_id: note.id,
					collections: [collection.id],
					label: "minor",
					client_token: "test-token-123"
				})
			}));

			const publishResult = await publishResponse.json();

			expect(publishResponse.status).toBe(200);
			expect(publishResult.version_id).toMatch(/^ver_[0-9A-HJKMNP-TV-Z]{26}$/);
			expect(publishResult.status).toBe("version_created");

			// 5. Verify version was created
			const versionResponse = await app.handle(
				new Request(`http://localhost/versions/${publishResult.version_id}`)
			);
			const version = await versionResponse.json();

			expect(versionResponse.status).toBe(200);
			expect(version.id).toBe(publishResult.version_id);
			expect(version.note_id).toBe(note.id);
		});
	});
});
