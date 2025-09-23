import { describe, it, expect, beforeEach } from "bun:test";
import { Effect } from "effect";
import { setTimeout } from "node:timers/promises";
import { createTestApi } from "./helpers/test-deps";

describe("Visibility pipeline SLOs", () => {
	let ctx = createTestApi();

	beforeEach(async () => {
		ctx = createTestApi();
		await Effect.runPromise(ctx.storage.initializeWorkspace());
		ctx.indexing.events.length = 0;
	});

	it("records publish-to-visible latency under target thresholds", async () => {
		const note = await Effect.runPromise(
			ctx.storage.createNote("Latency note", "content", { tags: [] }),
		);
		const collection = await Effect.runPromise(
			ctx.storage.createCollection("Latency"),
		);

		const start = Date.now();
		const response = await ctx.app.handle(
			new Request("http://localhost/publish", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					note_id: note.id,
					collections: [collection.id],
					client_token: "visibility-slo",
				}),
			}),
		);
		expect(response.status).toBe(200);

		await setTimeout(50); // Simulate processing delay

		expect(ctx.indexing.events.length).toBeGreaterThanOrEqual(1);
		const latencyMs = Date.now() - start;
		expect(latencyMs).toBeLessThanOrEqual(5000);
	});

	it("deduplicates visibility events for same version", async () => {
		const note = await Effect.runPromise(
			ctx.storage.createNote("Dedup note", "content", { tags: [] }),
		);
		const collection = await Effect.runPromise(
			ctx.storage.createCollection("Dedup"),
		);

		await ctx.app.handle(
			new Request("http://localhost/publish", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					note_id: note.id,
					collections: [collection.id],
					client_token: "dedup-token",
				}),
			}),
		);

		const eventCount = ctx.indexing.events.length;
		await ctx.app.handle(
			new Request("http://localhost/publish", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					note_id: note.id,
					collections: [collection.id],
					client_token: "dedup-token",
				}),
			}),
		);

		expect(ctx.indexing.events.length).toBe(eventCount);
	});
});
