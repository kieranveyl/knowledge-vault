import { describe, it, expect, beforeEach } from "bun:test";
import { Effect } from "effect";
import { createTestApi } from "./helpers/test-deps";

describe("Rate limiting", () => {
	let ctx = createTestApi();

	beforeEach(async () => {
		ctx = createTestApi();
		await Effect.runPromise(ctx.storage.initializeWorkspace());
	});

	it("returns 429 with retry-after when mutation burst limit is exceeded", async () => {
		const note = await Effect.runPromise(
			ctx.storage.createNote("Rate limited", "Content", { tags: [] }),
		);
		const collection = await Effect.runPromise(
			ctx.storage.createCollection("Limits"),
		);

		const sessionHeaders = {
			"Content-Type": "application/json",
			"X-Session-ID": "ses_test_rate_limit",
		};

		const requestBody = {
			note_id: note.id,
			collections: [collection.id],
			client_token: "rate-limit-1",
		};

		const firstPublish = await ctx.app.handle(
			new Request("http://localhost/publish", {
				method: "POST",
				headers: sessionHeaders,
				body: JSON.stringify(requestBody),
			}),
		);

		expect(firstPublish.status).toBe(200);

		await Effect.runPromise(
			ctx.storage.saveDraft({
				note_id: note.id,
				body_md: "Content",
				metadata: { tags: [] },
			}),
		);

		const secondPublish = await ctx.app.handle(
			new Request("http://localhost/publish", {
				method: "POST",
				headers: sessionHeaders,
				body: JSON.stringify({ ...requestBody, client_token: "rate-limit-2" }),
			}),
		);

		const error = await secondPublish.json();
		expect(secondPublish.status).toBe(429);
		expect(error.error.type).toBe("RateLimitExceeded");
		expect(error.error.retry_after).toBeGreaterThan(0);
	});
});
