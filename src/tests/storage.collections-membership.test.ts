import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import { createTestApi } from "./helpers/test-deps";

describe("Storage collection membership", () => {
	it("adds, lists, and removes note memberships", async () => {
		const { storage } = createTestApi();

		const note = await Effect.runPromise(
			storage.createNote("Alpha Doc", "Initial content", {}),
		);

		const [collectionA, collectionB, collectionC] = await Promise.all([
			Effect.runPromise(storage.createCollection("Collection A", "First")),
			Effect.runPromise(storage.createCollection("Collection B", "Second")),
			Effect.runPromise(storage.createCollection("Collection C", "Third")),
		]);

		await Effect.runPromise(
			storage.addToCollections(note.id, [
				collectionA.id,
				collectionB.id,
				collectionC.id,
			]),
		);

		const memberships = await Effect.runPromise(
			storage.getNoteCollections(note.id),
		);
		expect(new Set(memberships.map((collection) => collection.id))).toEqual(
			new Set([collectionA.id, collectionB.id, collectionC.id]),
		);

		await Effect.runPromise(
			storage.removeFromCollections(note.id, [collectionB.id]),
		);

		const updatedMemberships = await Effect.runPromise(
			storage.getNoteCollections(note.id),
		);
		expect(new Set(updatedMemberships.map((collection) => collection.id))).toEqual(
			new Set([collectionA.id, collectionC.id]),
		);

		const remainingNotes = await Effect.runPromise(
			storage.getCollectionNotes(collectionA.id),
		);
		expect(remainingNotes.map((candidate) => candidate.id)).toContain(note.id);

		const removedNotes = await Effect.runPromise(
			storage.getCollectionNotes(collectionB.id),
		);
		expect(removedNotes).toHaveLength(0);
	});
});
