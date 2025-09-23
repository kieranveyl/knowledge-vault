import { describe, it, expect, beforeEach } from "bun:test";
import { Effect } from "effect";
import { createTestApi } from "./helpers/test-deps";

describe("Snapshot lifecycle", () => {
	let ctx = createTestApi();

	beforeEach(async () => {
		ctx = createTestApi();
		await Effect.runPromise(ctx.storage.initializeWorkspace());
	});

	it("captures and restores workspace state", async () => {
		const note = await Effect.runPromise(
			ctx.storage.createNote("Snapshot note", "initial", { tags: ["snapshot"] }),
		);
		await Effect.runPromise(
			ctx.storage.saveDraft({
				note_id: note.id,
				body_md: "updated",
				metadata: { tags: ["snapshot"] },
			}),
		);

		const collection = await Effect.runPromise(
			ctx.storage.createCollection("Snapshot collection"),
		);

		await ctx.app.handle(
			new Request("http://localhost/publish", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					note_id: note.id,
					collections: [collection.id],
					client_token: "snapshot-publish",
				}),
			}),
		);

		const snapshot = await Effect.runPromise(
			ctx.storage.createSnapshot("workspace", "before modifications"),
		);

		await Effect.runPromise(ctx.storage.deleteNote(note.id));
		const notesAfterDelete = await Effect.runPromise(ctx.storage.listNotes());
		expect(notesAfterDelete.length).toBe(0);

		await Effect.runPromise(ctx.storage.restoreSnapshot(snapshot.id));

		const restoredNotes = await Effect.runPromise(ctx.storage.listNotes());
		expect(restoredNotes.length).toBe(1);
		expect(restoredNotes[0].id).toBe(note.id);

		const restoredCollections = await Effect.runPromise(ctx.storage.getNoteCollections(note.id));
		expect(restoredCollections.map((c) => c.id)).toContain(collection.id);
	});

	it("lists snapshots and handles deletion", async () => {
		const first = await Effect.runPromise(ctx.storage.createSnapshot("workspace", "first"));
		const second = await Effect.runPromise(ctx.storage.createSnapshot("workspace", "second"));

		const snapshots = await Effect.runPromise(ctx.storage.listSnapshots());
		expect(snapshots.map((s) => s.id)).toEqual([first.id, second.id]);

		await Effect.runPromise(ctx.storage.deleteSnapshot(first.id));
		const remaining = await Effect.runPromise(ctx.storage.listSnapshots());
		expect(remaining.map((s) => s.id)).toEqual([second.id]);
	});

	it("rejects restoration when snapshot does not exist", async () => {
		const snapshot = await Effect.runPromise(ctx.storage.createSnapshot("workspace"));
		await Effect.runPromise(ctx.storage.deleteSnapshot(snapshot.id));

		await expect(
			Effect.runPromise(ctx.storage.restoreSnapshot(snapshot.id)),
		).rejects.toThrow(/Snapshot/);
	});
});
