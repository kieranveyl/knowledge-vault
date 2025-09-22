import { describe, expect, it } from "bun:test";
import { Schema } from "@effect/schema";
import {
	NoteId,
	CollectionId,
	VersionId,
	Note,
	Version,
	Collection,
	Anchor,
} from "../schema/entities";

describe("entity schemas", () => {
	it("validates ULID format for entity IDs", () => {
		const validNoteId = "note_01JBXR8G9P7QN1VMPX84KTFHK2";
		const validCollectionId = "col_01JBXR8G9P7QN1VMPX84KTFHK2";
		const validVersionId = "ver_01JBXR8G9P7QN1VMPX84KTFHK2";

		expect(Schema.decodeUnknownSync(NoteId)(validNoteId)).toBe(validNoteId);
		expect(Schema.decodeUnknownSync(CollectionId)(validCollectionId)).toBe(
			validCollectionId,
		);
		expect(Schema.decodeUnknownSync(VersionId)(validVersionId)).toBe(
			validVersionId,
		);
	});

	it("rejects invalid ID formats", () => {
		const invalidIds = [
			"note_invalid",
			"col_123",
			"ver_01JBXR8G9P7QN1VMPX84KTFHK",
			"wrong_01JBXR8G9P7QN1VMPX84KTFHK2",
		];

		for (const id of invalidIds) {
			expect(() => Schema.decodeUnknownSync(NoteId)(id)).toThrow();
		}
	});

	it("validates Note entity structure", () => {
		const validNote = {
			id: "note_01JBXR8G9P7QN1VMPX84KTFHK2",
			title: "Test Note",
			metadata: { tags: ["test", "example"] },
			created_at: new Date().toISOString(),
			updated_at: new Date().toISOString(),
		};

		expect(() => Schema.decodeUnknownSync(Note)(validNote)).not.toThrow();
	});

	it("validates Collection entity structure", () => {
		const validCollection = {
			id: "col_01JBXR8G9P7QN1VMPX84KTFHK2",
			name: "Test Collection",
			created_at: new Date().toISOString(),
		};

		expect(() =>
			Schema.decodeUnknownSync(Collection)(validCollection),
		).not.toThrow();
	});

	it("validates Anchor schema structure", () => {
		const validAnchor = {
			structure_path: "/heading1/heading2",
			token_offset: 10,
			token_length: 5,
			fingerprint: "abc123def456",
			tokenization_version: "1.0.0",
			fingerprint_algo: "sha256",
		};

		expect(() => Schema.decodeUnknownSync(Anchor)(validAnchor)).not.toThrow();
	});

	it("rejects invalid Anchor with negative token offset", () => {
		const invalidAnchor = {
			structure_path: "/heading1",
			token_offset: -1, // Invalid: negative offset
			token_length: 5,
			fingerprint: "abc123def456",
			tokenization_version: "1.0.0",
			fingerprint_algo: "sha256",
		};

		expect(() => Schema.decodeUnknownSync(Anchor)(invalidAnchor)).toThrow();
	});
});
