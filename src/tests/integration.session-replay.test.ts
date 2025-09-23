import { describe, it, expect, beforeEach } from "bun:test";
import { Effect } from "effect";
import { createTestApi } from "./helpers/test-deps";

describe("Session replay", () => {
	let ctx = createTestApi();

	beforeEach(async () => {
		ctx = createTestApi();
		await Effect.runPromise(ctx.storage.initializeWorkspace());
	});

	it("persists session steps with original version ids", async () => {
		const note = await Effect.runPromise(
			ctx.storage.createNote("Session note", "draft", { tags: ["session"] }),
		);
		await Effect.runPromise(
			ctx.storage.saveDraft({
				note_id: note.id,
				body_md: "published version",
				metadata: { tags: ["session"] },
			}),
		);

		const collection = await Effect.runPromise(ctx.storage.createCollection("Sessions"));
		const publishResponse = await ctx.app.handle(
			new Request("http://localhost/publish", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					note_id: note.id,
					collections: [collection.id],
					client_token: "session-token",
				}),
			}),
		);
		const published = await publishResponse.json();

		const session = await Effect.runPromise(ctx.storage.createSession());
		const steps = [
			{
				step_index: 0,
				timestamp: new Date(),
				type: "query" as const,
				ref_ids: [published.version_id],
			},
		];
		await Effect.runPromise(ctx.storage.updateSession(session.id, steps));

		const reloaded = await Effect.runPromise(ctx.storage.getSession(session.id));
		expect(reloaded.steps.length).toBe(1);
		expect(reloaded.steps[0].ref_ids).toContain(published.version_id);
	});

	it("retains session even when referenced versions are missing", async () => {
		const session = await Effect.runPromise(ctx.storage.createSession());
		const orphanedVersionId = "ver_01K5SL0R3XEG6JGA08D9FJ1AKB";
		const steps = [
			{
				step_index: 0,
				timestamp: new Date(),
				type: "query" as const,
				ref_ids: [orphanedVersionId],
			},
		];
		await Effect.runPromise(ctx.storage.updateSession(session.id, steps));

		const reloaded = await Effect.runPromise(ctx.storage.getSession(session.id));
		expect(reloaded.steps[0].ref_ids).toEqual([orphanedVersionId]);
		expect(reloaded.ended_at).toBeUndefined();
	});
});
