import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { createOramaSearchAdapter } from "../adapters/search/orama.adapter";
import type { SearchRequest } from "../schema/api";
import type { IndexSearchResult } from "../services/indexing.port";
import type { Answer, Citation } from "../schema/entities";

const mockCandidate: IndexSearchResult = {
	version_id: "ver_01K5SM0KTESTDEFAULTS" as any,
	passage_id: "pas_01K5SM0KTESTDEFAULTS" as any,
	score: 0.9,
	snippet: "mock snippet",
	structure_path: "/section",
	collection_ids: [],
};

describe("Retrieval defaults", () => {
	it("uses 128 candidates and reranks down to 64 by default", async () => {
		const adapter = createOramaSearchAdapter() as any;

		let retrieveTopK: number | undefined;
		let rerankTopK: number | undefined;

		adapter.retrieveCandidates = (
			_q: string,
			_collections: readonly string[],
			top_k: number,
		) => {
			retrieveTopK = top_k;
			return Effect.succeed([mockCandidate]);
		};

		adapter.rerankCandidates = (
			_q: string,
			candidates: readonly IndexSearchResult[],
			top_k: number,
		) => {
			rerankTopK = top_k;
			return Effect.succeed(candidates);
		};

		const placeholderCitation: Citation = {
			id: "cit_01K5SM0KDEFAULT" as any,
			answer_id: "ans_01K5SM0KDEFAULT" as any,
			version_id: mockCandidate.version_id,
			anchor: {
				structure_path: "/section",
				token_offset: 0,
				token_length: 1,
				fingerprint: "abc123",
				tokenization_version: "v1",
				fingerprint_algo: "sha256",
			},
			snippet: "snippet",
			confidence: 0.9,
		};

		const placeholderAnswer: Answer = {
			id: "ans_01K5SM0KDEFAULT" as any,
			query_id: "qry_01K5SM0KDEFAULT" as any,
			text: "",
			citations: [placeholderCitation.id],
			composed_at: new Date(),
			coverage: { claims: 0, cited: 0 },
		};

		adapter.composeAnswer = () =>
			Effect.succeed({
				answer: placeholderAnswer,
				citations: [placeholderCitation],
				coverage: { claims: 0, cited: 0 },
			});

		const request: SearchRequest = {
			q: "default retrieval",
			page: 0,
			page_size: 10,
		};

		await Effect.runPromise(adapter.search(request));

		expect(retrieveTopK).toBe(128);
		expect(rerankTopK).toBe(64);
	});
});
