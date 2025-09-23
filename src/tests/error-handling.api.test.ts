import { beforeEach, describe, expect, it, test } from "bun:test";
import { Effect } from "effect";
import { ulid } from "ulid";
import { createTestApi } from "./helpers/test-deps";

const jsonHeaders = {
	"Content-Type": "application/json",
};

describe("API error handling", () => {
	let ctx = createTestApi();

	beforeEach(async () => {
		ctx = createTestApi();
		await Effect.runPromise(ctx.storage.initializeWorkspace());
	});

	it("returns validation details when publish payload is missing required fields", async () => {
		const note = await Effect.runPromise(
			ctx.storage.createNote("Validation target", "Draft", { tags: [] }),
		);
		const collection = await Effect.runPromise(
			ctx.storage.createCollection("Validation"),
		);

		const response = await ctx.app.handle(
			new Request("http://localhost/publish", {
				method: "POST",
				headers: jsonHeaders,
				body: JSON.stringify({
					note_id: note.id,
					collections: [collection.id],
					// client_token intentionally omitted
				}),
			}),
		);

		expect(response.status).toBe(400);
		const payload = await response.json();
		expect(payload.error.type).toBe("ValidationError");
		expect(payload.error.details?.length ?? 0).toBeGreaterThan(0);
	});

	it("signals conflicts with retry guidance when creating duplicate collections", async () => {
		const body = { name: "Conflicting" };

		const first = await ctx.app.handle(
			new Request("http://localhost/collections", {
				method: "POST",
				headers: jsonHeaders,
				body: JSON.stringify(body),
			}),
		);
		expect(first.status).toBe(200);

		const duplicate = await ctx.app.handle(
			new Request("http://localhost/collections", {
				method: "POST",
				headers: jsonHeaders,
				body: JSON.stringify(body),
			}),
		);
		expect(duplicate.status).toBe(409);
		const payload = await duplicate.json();
		expect(payload.error.type).toBe("ConflictError");
		expect(payload.error.message).toMatch(/unique|conflict/i);
	});

	test.todo("returns nearest alternatives in 404 responses when available");

	it("includes retry_after seconds when rate limits trigger", async () => {
		const note = await Effect.runPromise(
			ctx.storage.createNote("Rate limited", "Body", { tags: [] }),
		);
		const collection = await Effect.runPromise(
			ctx.storage.createCollection("Rate limiter"),
		);

		const sessionHeaders = {
			...jsonHeaders,
			"X-Session-ID": "ses_rate_limit_api_errors",
		};

		const publishBody = {
			note_id: note.id,
			collections: [collection.id],
			client_token: `token-${ulid()}`,
		};

		const firstPublish = await ctx.app.handle(
			new Request("http://localhost/publish", {
				method: "POST",
				headers: sessionHeaders,
				body: JSON.stringify(publishBody),
			}),
		);
		expect(firstPublish.status).toBe(200);

		await Effect.runPromise(
			ctx.storage.saveDraft({
				note_id: note.id,
				body_md: "Retry body",
				metadata: { tags: [] },
			}),
		);

		const secondPublish = await ctx.app.handle(
			new Request("http://localhost/publish", {
				method: "POST",
				headers: sessionHeaders,
				body: JSON.stringify({ ...publishBody, client_token: `token-${ulid()}` }),
			}),
		);
		const errorPayload = await secondPublish.json();
		expect(secondPublish.status).toBe(429);
		expect(errorPayload.error.type).toBe("RateLimitExceeded");
		expect(errorPayload.error.retry_after).toBeGreaterThan(0);
	});

	it("maps visibility timeouts to structured API errors", async () => {
		const note = await Effect.runPromise(
			ctx.storage.createNote("Timeout", "Body", { tags: [] }),
		);
		const collection = await Effect.runPromise(
			ctx.storage.createCollection("Timeouts"),
		);

		await Effect.runPromise(
			ctx.storage.saveDraft({
				note_id: note.id,
				body_md: "Timeout content",
				metadata: { tags: [] },
			}),
		);

		let failedVersion: string | undefined;
		Reflect.set(ctx.indexing as Record<string, unknown>, "enqueueVisibilityEvent", (event: any) => {
			failedVersion = event.version_id;
			return Effect.fail({
				_tag: "VisibilityTimeout",
				version_id: event.version_id,
			});
		});

		const response = await ctx.app.handle(
			new Request("http://localhost/publish", {
				method: "POST",
				headers: jsonHeaders,
				body: JSON.stringify({
					note_id: note.id,
					collections: [collection.id],
					client_token: `token-${ulid()}`,
				}),
			}),
		);

		expect(response.status).toBeGreaterThanOrEqual(500);
		const payload = await response.json();
		expect(payload.error.type).toBe("VisibilityTimeout");
		expect(failedVersion).toBeDefined();
		const version = await Effect.runPromise(
			ctx.storage.getVersion(failedVersion as any),
		);
		expect(version.note_id).toBe(note.id);
	});

	it("propagates indexing failures with reason", async () => {
		const note = await Effect.runPromise(
			ctx.storage.createNote("Index failure", "Body", { tags: [] }),
		);
		const collection = await Effect.runPromise(
			ctx.storage.createCollection("Index failures"),
		);

		await Effect.runPromise(
			ctx.storage.saveDraft({
				note_id: note.id,
				body_md: "Index failure content",
				metadata: { tags: [] },
			}),
		);

		Reflect.set(ctx.indexing as Record<string, unknown>, "enqueueVisibilityEvent", (_event: any) =>
			Effect.fail({
				_tag: "IndexingFailure",
				reason: "index offline",
				version_id: `ver_${ulid()}`,
			}),
		);

		const response = await ctx.app.handle(
			new Request("http://localhost/publish", {
				method: "POST",
				headers: jsonHeaders,
				body: JSON.stringify({
					note_id: note.id,
					collections: [collection.id],
					client_token: `token-${ulid()}`,
				}),
			}),
		);

		expect(response.status).toBeGreaterThanOrEqual(500);
		const payload = await response.json();
		expect(payload.error.type).toBe("IndexingFailure");
		expect(payload.error.message).toContain("index offline");
	});

	it("preserves last good draft when storage IO fails", async () => {
		const note = await Effect.runPromise(
			ctx.storage.createNote("Storage fallback", "Initial body", { tags: [] }),
		);

		const baselineDraft = await Effect.runPromise(ctx.storage.getDraft(note.id));
		expect(baselineDraft.body_md).toBe("Initial body");

		Reflect.set(ctx.storage as Record<string, unknown>, "saveDraft", (_request: any) =>
			Effect.fail({ _tag: "StorageIOError", cause: new Error("disk failure") }),
		);

		const response = await ctx.app.handle(
			new Request("http://localhost/drafts", {
				method: "POST",
				headers: jsonHeaders,
				body: JSON.stringify({
					note_id: note.id,
					body_md: "Unsaved content",
					metadata: { tags: [] },
				}),
			}),
		);

		expect(response.status).toBeGreaterThanOrEqual(500);
		const payload = await response.json();
		expect(payload.error.type).toBe("StorageIO");

		const persistedDraft = await Effect.runPromise(ctx.storage.getDraft(note.id));
		expect(persistedDraft.body_md).toBe("Initial body");
	});

	it("surfaces schema mismatches with expected and actual versions", async () => {
		const note = await Effect.runPromise(
			ctx.storage.createNote("Schema mismatch", "Initial", { tags: [] }),
		);
		const collection = await Effect.runPromise(
			ctx.storage.createCollection("Schema"),
		);

		await Effect.runPromise(
			ctx.storage.saveDraft({
				note_id: note.id,
				body_md: "Schema draft",
				metadata: { tags: [] },
			}),
		);

		Reflect.set(ctx.storage as Record<string, unknown>, "publishVersion", (_request: any) =>
			Effect.fail({
				_tag: "SchemaVersionMismatch",
				expected: "1.2.0",
				actual: "1.1.0",
			}),
		);

		const response = await ctx.app.handle(
			new Request("http://localhost/publish", {
				method: "POST",
				headers: jsonHeaders,
				body: JSON.stringify({
					note_id: note.id,
					collections: [collection.id],
					client_token: `token-${ulid()}`,
				}),
			}),
		);

		expect(response.status).toBeGreaterThanOrEqual(400);
		const payload = await response.json();
		expect(payload.error.type).toBe("SchemaVersionMismatch");
		expect(payload.error.expected).toBe("1.2.0");
		expect(payload.error.actual).toBe("1.1.0");
	});
});
