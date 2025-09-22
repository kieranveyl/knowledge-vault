import { describe, it, expect, beforeEach } from "bun:test";
import { Effect } from "effect";
import { ulid } from "ulid";
import { createTestApi } from "./helpers/test-deps";

const createCitation = (answerId: string, versionId: string) => ({
	id: `cit_${ulid()}`,
	answer_id: answerId,
	version_id: versionId,
	anchor: {
		structure_path: "note:0",
		token_offset: 0,
		token_length: 5,
		fingerprint: "abcdef",
		tokenization_version: "v1",
		fingerprint_algo: "sha256",
	},
	snippet: "Snippet",
	confidence: 0.9,
});

describe("Query answer behaviour", () => {
	let ctx = createTestApi();

	beforeEach(async () => {
		ctx = createTestApi();
		await Effect.runPromise(ctx.storage.initializeWorkspace());
	});

	it("returns no_answer when evidence is insufficient", async () => {
		ctx.indexing.setSearchHandler(() => ({
			answer: undefined,
			results: [],
			citations: [],
			query_id: `qry_${ulid()}`,
			page: 0,
			page_size: 10,
			total_count: 0,
			has_more: false,
			no_answer_reason: "insufficient_evidence",
		}));

		const response = await ctx.app.handle(new Request("http://localhost/search?q=missing"));
		expect(response.status).toBe(200);
		const payload = await response.json();
		expect(payload.no_answer_reason).toBe("insufficient_evidence");
		expect(payload.answer).toBeUndefined();
	});

	it("rejects answer payload when citations array is empty", async () => {
		const versionId = `ver_${ulid()}`;
		const answerId = `ans_${ulid()}`;

		ctx.indexing.setSearchHandler(() => ({
			answer: {
				id: answerId,
				query_id: `qry_${ulid()}`,
				text: "Answer text",
				citations: [createCitation(answerId, versionId).id],
				composed_at: new Date(),
				coverage: { claims: 1, cited: 0 },
			} as any,
			results: [
				{
					note_id: `note_${ulid()}`,
					version_id: versionId,
					title: "Example",
					snippet: "Snippet",
					score: 0.8,
					collection_ids: [`col_${ulid()}`],
				},
			],
			citations: [],
			query_id: `qry_${ulid()}`,
			page: 0,
			page_size: 10,
			total_count: 1,
			has_more: false,
		}));

		const response = await ctx.app.handle(new Request("http://localhost/search?q=answer"));
		expect(response.status).toBe(409);
		const payload = await response.json();
		expect(payload.error.type).toBe("ValidationError");
	});

	it("rejects answer when more than three citations are returned", async () => {
		const versionId = `ver_${ulid()}`;
		const answerId = `ans_${ulid()}`;
		const citations = Array.from({ length: 4 }, () => createCitation(answerId, versionId));

		ctx.indexing.setSearchHandler(() => ({
			answer: {
				id: answerId,
				query_id: `qry_${ulid()}`,
				text: "Answer with too many citations",
				citations: citations.map((citation) => citation.id),
				composed_at: new Date(),
				coverage: { claims: 2, cited: 2 },
			} as any,
			results: [
				{
					note_id: `note_${ulid()}`,
					version_id: versionId,
					title: "Example",
					snippet: "Snippet",
					score: 0.7,
					collection_ids: [`col_${ulid()}`],
				},
			],
			citations,
			query_id: `qry_${ulid()}`,
			page: 0,
			page_size: 10,
			total_count: 1,
			has_more: false,
		}));

		const response = await ctx.app.handle(new Request("http://localhost/search?q=too-many"));
		expect(response.status).toBe(422);
		const payload = await response.json();
		expect(payload.error.type).toBe("ValidationError");
	});

	it("propagates collection scope filters to search request", async () => {
		const collectionA = `col_${ulid()}`;
		const collectionB = `col_${ulid()}`;
		let capturedCollections: readonly string[] | undefined;

		ctx.indexing.setSearchHandler((request) => {
			capturedCollections = request.collections;
			return {
				answer: undefined,
				results: [],
				citations: [],
				query_id: `qry_${ulid()}`,
				page: 0,
				page_size: 10,
				total_count: 0,
				has_more: false,
				no_answer_reason: "scoped",
			};
		});

		const response = await ctx.app.handle(
			new Request(
				`http://localhost/search?q=scoped&collections=${collectionA}&collections=${collectionB}`,
			),
		);

		expect(response.status).toBe(200);
		const payload = await response.json();
		expect(payload.no_answer_reason).toBe("scoped");
		expect(capturedCollections).toEqual([collectionA, collectionB]);
	});
});
