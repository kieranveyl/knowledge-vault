import { describe, it, expect, beforeEach } from "bun:test";
import { Effect } from "effect";
import { createTestApi } from "./helpers/test-deps";

describe("Publish lifecycle", () => {
	let ctx = createTestApi();

	beforeEach(async () => {
		ctx = createTestApi();
		await Effect.runPromise(ctx.storage.initializeWorkspace());
	});

	it("rejects publish when note title exceeds 200 characters", async () => {
		const longTitle = "L".repeat(201);
		const note = await Effect.runPromise(
			ctx.storage.createNote(longTitle, "# Draft\nContent", { tags: [] }),
		);
		const collection = await Effect.runPromise(
			ctx.storage.createCollection("Publish Validation"),
		);

		const response = await ctx.app.handle(
			new Request("http://localhost/publish", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					note_id: note.id,
					collections: [collection.id],
					client_token: "token-long-title",
				}),
			}),
		);

		expect(response.status).toBe(400);
		const error = await response.json();
		expect(error.error.type).toBe("ValidationError");
	});

	it("rejects publish when no collections are provided", async () => {
		const note = await Effect.runPromise(
			ctx.storage.createNote("Valid title", "Content", { tags: [] }),
		);

		const response = await ctx.app.handle(
			new Request("http://localhost/publish", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					note_id: note.id,
					collections: [],
					client_token: "token-missing-collections",
				}),
			}),
		);

		expect(response.status).toBe(400);
		const error = await response.json();
		expect(error.error.type).toBe("ValidationError");
	});

	it("creates unique immutable versions on publish", async () => {
		const note = await Effect.runPromise(
			ctx.storage.createNote("Immutable Note", "Original content", { tags: [] }),
		);
		const collection = await Effect.runPromise(
			ctx.storage.createCollection("Immutable"),
		);

		await Effect.runPromise(
			ctx.storage.saveDraft({
				note_id: note.id,
				body_md: "First publish content",
				metadata: { tags: [] },
			}),
		);

		const firstPublish = await ctx.app.handle(
			new Request("http://localhost/publish", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					note_id: note.id,
					collections: [collection.id],
					client_token: "immutable-token-1",
				}),
			}),
		);
		const firstPayload = await firstPublish.json();
		expect(firstPublish.status).toBe(200);
		expect(firstPayload.version_id).toMatch(/^ver_[0-9A-HJKMNP-TV-Z]{26}$/);

		const firstVersion = await Effect.runPromise(
			ctx.storage.getVersion(firstPayload.version_id),
		);
		expect(firstVersion.content_md).toBe("First publish content");

		await Effect.runPromise(
			ctx.storage.saveDraft({
				note_id: note.id,
				body_md: "Second publish content",
				metadata: { tags: [] },
			}),
		);

		const secondPublish = await ctx.app.handle(
			new Request("http://localhost/publish", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					note_id: note.id,
					collections: [collection.id],
					client_token: "immutable-token-2",
				}),
			}),
		);
		expect(secondPublish.status).toBe(200);
		const secondPayload = await secondPublish.json();
		expect(secondPayload.version_id).not.toBe(firstPayload.version_id);

		const reloadedFirstVersion = await Effect.runPromise(
			ctx.storage.getVersion(firstPayload.version_id),
		);
		expect(reloadedFirstVersion.content_md).toBe("First publish content");
	});

	it("returns same version when publish retried with identical client token", async () => {
		const note = await Effect.runPromise(
			ctx.storage.createNote("Idempotent note", "Retry content", { tags: [] }),
		);
		const collection = await Effect.runPromise(
			ctx.storage.createCollection("Retry"),
		);

		const requestBody = {
			note_id: note.id,
			collections: [collection.id],
			client_token: "publish-retry-token",
		};

		const firstResponse = await ctx.app.handle(
			new Request("http://localhost/publish", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(requestBody),
			}),
		);
		expect(firstResponse.status).toBe(200);
		const firstPayload = await firstResponse.json();

		const secondResponse = await ctx.app.handle(
			new Request("http://localhost/publish", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(requestBody),
			}),
		);
		expect(secondResponse.status).toBe(200);
		const secondPayload = await secondResponse.json();

		expect(secondPayload.version_id).toBe(firstPayload.version_id);

		const versions = await Effect.runPromise(
			ctx.storage.listVersions(note.id),
		);
		expect(versions.length).toBe(1);
	});
});
