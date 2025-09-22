import { describe, it, expect, beforeEach } from "bun:test";
import { Effect } from "effect";
import { createTestApi } from "./helpers/test-deps";

describe("Visibility pipeline", () => {
	let ctx = createTestApi();

	beforeEach(async () => {
		ctx = createTestApi();
		await Effect.runPromise(ctx.storage.initializeWorkspace());
	});

	it("emits visibility event when publishing", async () => {
		const note = await Effect.runPromise(
			ctx.storage.createNote("Visibility note", "Publish body", { tags: [] }),
		);
		const collection = await Effect.runPromise(
			ctx.storage.createCollection("Visibility"),
		);

		const response = await ctx.app.handle(
			new Request("http://localhost/publish", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					note_id: note.id,
					collections: [collection.id],
					client_token: "visibility-token",
				}),
			}),
		);

		expect(response.status).toBe(200);
		const payload = await response.json();

		expect(ctx.indexing.events.length).toBe(1);
		const event = ctx.indexing.events[0];
		expect(event.type).toBe("VisibilityEvent");
		expect(event.version_id).toBe(payload.version_id);
		expect(event.collections).toEqual([collection.id]);
		expect(event.op).toBe("publish");
	});

	it("emits rollback visibility event referencing new version", async () => {
		const note = await Effect.runPromise(
			ctx.storage.createNote("Rollback visibility", "Initial", { tags: [] }),
		);
		const collection = await Effect.runPromise(
			ctx.storage.createCollection("Rollback"),
		);

		await ctx.app.handle(
			new Request("http://localhost/publish", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					note_id: note.id,
					collections: [collection.id],
					client_token: "rollback-seed",
				}),
			}),
		);

		const versions = await Effect.runPromise(ctx.storage.listVersions(note.id));
		const targetVersion = versions[0];

		ctx.indexing.events.splice(0, ctx.indexing.events.length);

		const rollbackResponse = await ctx.app.handle(
			new Request("http://localhost/rollback", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					note_id: note.id,
					target_version_id: targetVersion.id,
					client_token: "rollback-visibility",
				}),
			}),
		);

		expect(rollbackResponse.status).toBe(200);
		const rollbackPayload = await rollbackResponse.json();

		expect(ctx.indexing.events.length).toBe(1);
		const event = ctx.indexing.events[0];
		expect(event.op).toBe("rollback");
		expect(event.version_id).toBe(rollbackPayload.new_version_id);
	});
});
