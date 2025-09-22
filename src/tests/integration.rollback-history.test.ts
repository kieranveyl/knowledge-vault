import { describe, it, expect, beforeEach } from "bun:test";
import { Effect } from "effect";
import { createTestApi } from "./helpers/test-deps";

describe("Rollback history", () => {
	let ctx = createTestApi();

	beforeEach(async () => {
		ctx = createTestApi();
		await Effect.runPromise(ctx.storage.initializeWorkspace());
	});

	it("creates rollback version referencing target without mutating history", async () => {
		const note = await Effect.runPromise(
			ctx.storage.createNote("Rollback note", "Initial content", { tags: [] }),
		);
		const collection = await Effect.runPromise(
			ctx.storage.createCollection("Rollback"),
		);

		await Effect.runPromise(
			ctx.storage.saveDraft({
				note_id: note.id,
				body_md: "Version 1 content",
				metadata: { tags: [] },
			}),
		);

		const publishV1 = await ctx.app.handle(
			new Request("http://localhost/publish", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					note_id: note.id,
					collections: [collection.id],
					client_token: "rollback-seed-v1",
				}),
			}),
		);
		expect(publishV1.status).toBe(200);
		const v1Payload = await publishV1.json();

		await Effect.runPromise(
			ctx.storage.saveDraft({
				note_id: note.id,
				body_md: "Version 2 content",
				metadata: { tags: [] },
			}),
		);

		const publishV2 = await ctx.app.handle(
			new Request("http://localhost/publish", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					note_id: note.id,
					collections: [collection.id],
					client_token: "rollback-seed-v2",
				}),
			}),
		);
		expect(publishV2.status).toBe(200);

		const rollbackResponse = await ctx.app.handle(
			new Request("http://localhost/rollback", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					note_id: note.id,
					target_version_id: v1Payload.version_id,
					client_token: "rollback-action",
				}),
			}),
		);

		expect(rollbackResponse.status).toBe(200);
		const rollbackPayload = await rollbackResponse.json();

		const rollbackVersion = await Effect.runPromise(
			ctx.storage.getVersion(rollbackPayload.new_version_id),
		);
		expect(rollbackVersion.parent_version_id).toBe(v1Payload.version_id);
		expect(rollbackVersion.content_md).toBe("Version 1 content");

		const originalVersion = await Effect.runPromise(
			ctx.storage.getVersion(v1Payload.version_id),
		);
		expect(originalVersion.content_md).toBe("Version 1 content");

		const versions = await Effect.runPromise(ctx.storage.listVersions(note.id));
		expect(versions).toHaveLength(3);
		const versionIds = versions.map((version) => version.id);
		expect(versionIds).toContain(v1Payload.version_id);
		expect(versionIds).toContain(rollbackPayload.new_version_id);
	});
});
