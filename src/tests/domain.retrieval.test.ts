import { describe, expect, it } from "bun:test";
import {
	deduplicateResults,
	sortSearchResults,
	processSearchResults,
	paginateResults,
	compareSearchResults,
	createRetrievalConfig,
	applySloBackoff,
	calculateResultDiversity,
	filterForCitationCoverage,
	DEFAULT_RETRIEVAL_CONFIG,
	type SearchResultItem,
} from "../domain/retrieval";
import type { NoteId, VersionId, PassageId } from "../schema/entities";

describe("domain/retrieval", () => {
	// Golden test data for deterministic sorting
	const createTestResult = (
		noteId: string,
		versionId: string,
		passageId: string,
		score: number,
	): SearchResultItem => ({
		note_id: noteId as NoteId,
		version_id: versionId as VersionId,
		passage_id: passageId as PassageId,
		score,
		snippet: `Snippet for ${passageId}`,
		structure_path: "/test/path",
		collection_ids: ["col_01JBXR8G9P7QN1VMPX84KTFHK2"],
	});

	describe("deduplicateResults", () => {
		it("keeps highest-scored passage per (note_id, version_id)", () => {
			const results = [
				createTestResult("note_123", "ver_456", "pas_001", 0.9),
				createTestResult("note_123", "ver_456", "pas_002", 0.7), // Lower score, same note+version
				createTestResult("note_123", "ver_789", "pas_003", 0.8), // Different version
				createTestResult("note_456", "ver_456", "pas_004", 0.6), // Different note
			];

			const deduplicated = deduplicateResults(results);

			expect(deduplicated).toHaveLength(3);
			
			// Should keep the highest score for note_123 + ver_456
			const noteVersionPair = deduplicated.find(
				r => r.note_id === "note_123" && r.version_id === "ver_456"
			);
			expect(noteVersionPair?.score).toBe(0.9);
			expect(noteVersionPair?.passage_id).toBe("pas_001");
		});

		it("handles empty results", () => {
			expect(deduplicateResults([])).toEqual([]);
		});

		it("preserves results with unique (note_id, version_id) pairs", () => {
			const results = [
				createTestResult("note_1", "ver_1", "pas_1", 0.9),
				createTestResult("note_2", "ver_1", "pas_2", 0.8),
				createTestResult("note_1", "ver_2", "pas_3", 0.7),
			];

			const deduplicated = deduplicateResults(results);
			expect(deduplicated).toHaveLength(3);
		});
	});

	describe("compareSearchResults - Golden Tests", () => {
		it("sorts by score descending (primary)", () => {
			const result1 = createTestResult("note_1", "ver_1", "pas_1", 0.9);
			const result2 = createTestResult("note_2", "ver_2", "pas_2", 0.8);

			expect(compareSearchResults(result1, result2)).toBeLessThan(0);
			expect(compareSearchResults(result2, result1)).toBeGreaterThan(0);
		});

		it("breaks ties by version_id ascending (secondary)", () => {
			const result1 = createTestResult("note_1", "ver_aaa", "pas_1", 0.8);
			const result2 = createTestResult("note_2", "ver_zzz", "pas_2", 0.8);

			expect(compareSearchResults(result1, result2)).toBeLessThan(0);
			expect(compareSearchResults(result2, result1)).toBeGreaterThan(0);
		});

		it("breaks ties by passage_id ascending (tertiary)", () => {
			const result1 = createTestResult("note_1", "ver_same", "pas_aaa", 0.8);
			const result2 = createTestResult("note_2", "ver_same", "pas_zzz", 0.8);

			expect(compareSearchResults(result1, result2)).toBeLessThan(0);
			expect(compareSearchResults(result2, result1)).toBeGreaterThan(0);
		});

		it("returns 0 for identical results", () => {
			const result = createTestResult("note_1", "ver_1", "pas_1", 0.8);
			const identical = { ...result };

			expect(compareSearchResults(result, identical)).toBe(0);
		});
	});

	describe("sortSearchResults - Golden Test", () => {
		it("produces deterministic stable ordering", () => {
			// Golden test data with known expected ordering
			const results = [
				createTestResult("note_1", "ver_2", "pas_2", 0.8), // Should be 3rd (score 0.8, ver_2)
				createTestResult("note_2", "ver_1", "pas_1", 0.9), // Should be 1st (highest score)
				createTestResult("note_3", "ver_1", "pas_3", 0.8), // Should be 2nd (score 0.8, ver_1)
				createTestResult("note_4", "ver_2", "pas_1", 0.8), // Should be 4th (score 0.8, ver_2, pas_1)
				createTestResult("note_5", "ver_2", "pas_3", 0.8), // Should be 5th (score 0.8, ver_2, pas_3)
				createTestResult("note_6", "ver_1", "pas_2", 0.7), // Should be 6th (lowest score)
			];

			const sorted = sortSearchResults(results);

			// Verify exact expected ordering
			expect(sorted[0].score).toBe(0.9);
			expect(sorted[0].version_id).toBe("ver_1");

			expect(sorted[1].score).toBe(0.8);
			expect(sorted[1].version_id).toBe("ver_1");
			expect(sorted[1].passage_id).toBe("pas_3");

			expect(sorted[2].score).toBe(0.8);
			expect(sorted[2].version_id).toBe("ver_2");
			expect(sorted[2].passage_id).toBe("pas_1");

			expect(sorted[3].score).toBe(0.8);
			expect(sorted[3].version_id).toBe("ver_2");
			expect(sorted[3].passage_id).toBe("pas_2");

			expect(sorted[4].score).toBe(0.8);
			expect(sorted[4].version_id).toBe("ver_2");
			expect(sorted[4].passage_id).toBe("pas_3");

			expect(sorted[5].score).toBe(0.7);
		});

		it("preserves original array (immutability)", () => {
			const original = [
				createTestResult("note_1", "ver_1", "pas_1", 0.8),
				createTestResult("note_2", "ver_2", "pas_2", 0.9),
			];

			const sorted = sortSearchResults(original);

			expect(sorted).not.toBe(original);
			expect(original[0].score).toBe(0.8); // Should be unchanged
			expect(sorted[0].score).toBe(0.9); // Should be reordered
		});
	});

	describe("processSearchResults", () => {
		it("applies full pipeline: deduplicate + sort + limit", () => {
			const results = [
				createTestResult("note_1", "ver_1", "pas_1", 0.7), // Duplicate note+version (lower score)
				createTestResult("note_1", "ver_1", "pas_2", 0.9), // Duplicate note+version (higher score)
				createTestResult("note_2", "ver_1", "pas_3", 0.8),
				createTestResult("note_3", "ver_1", "pas_4", 0.6),
			];

			const config = { ...DEFAULT_RETRIEVAL_CONFIG, topKRerank: 2 };
			const processed = processSearchResults(results, config);

			// Should deduplicate (keep higher score for note_1+ver_1)
			// Then sort by score descending
			// Then limit to top 2
			expect(processed).toHaveLength(2);
			expect(processed[0].score).toBe(0.9);
			expect(processed[0].passage_id).toBe("pas_2");
			expect(processed[1].score).toBe(0.8);
		});

		it("respects topKRerank limit", () => {
			const results = Array.from({ length: 10 }, (_, i) =>
				createTestResult(`note_${i}`, `ver_${i}`, `pas_${i}`, 0.9 - i * 0.1)
			);

			const config = { ...DEFAULT_RETRIEVAL_CONFIG, topKRerank: 3 };
			const processed = processSearchResults(results, config);

			expect(processed).toHaveLength(3);
			expect(processed[0].score).toBe(0.9);
			expect(processed[2].score).toBe(0.7);
		});
	});

	describe("paginateResults", () => {
		it("paginates results correctly", () => {
			const results = Array.from({ length: 25 }, (_, i) =>
				createTestResult(`note_${i}`, `ver_${i}`, `pas_${i}`, 0.9)
			);

			const page0 = paginateResults(results, { page: 0, pageSize: 10 });
			const page1 = paginateResults(results, { page: 1, pageSize: 10 });
			const page2 = paginateResults(results, { page: 2, pageSize: 10 });

			expect(page0.items).toHaveLength(10);
			expect(page0.page).toBe(0);
			expect(page0.hasMore).toBe(true);
			expect(page0.totalCount).toBe(25);

			expect(page1.items).toHaveLength(10);
			expect(page1.hasMore).toBe(true);

			expect(page2.items).toHaveLength(5);
			expect(page2.hasMore).toBe(false);
		});

		it("clamps page size to maximum", () => {
			const results = Array.from({ length: 100 }, (_, i) =>
				createTestResult(`note_${i}`, `ver_${i}`, `pas_${i}`, 0.9)
			);

			const config = { ...DEFAULT_RETRIEVAL_CONFIG, maxPageSize: 20 };
			const paginated = paginateResults(results, { page: 0, pageSize: 100 }, config);

			expect(paginated.pageSize).toBe(20);
			expect(paginated.items).toHaveLength(20);
		});

		it("handles empty results", () => {
			const paginated = paginateResults([], { page: 0, pageSize: 10 });

			expect(paginated.items).toHaveLength(0);
			expect(paginated.totalCount).toBe(0);
			expect(paginated.hasMore).toBe(false);
		});
	});

	describe("createRetrievalConfig", () => {
		it("validates configuration constraints", () => {
			expect(() => createRetrievalConfig({ topKRetrieve: -1 }))
				.toThrow("topKRetrieve must be between 1 and 1000");

			expect(() => createRetrievalConfig({ topKRerank: 1001 }))
				.toThrow("topKRerank must be between 1 and 500");

			expect(() => createRetrievalConfig({ pageSize: 0 }))
				.toThrow("pageSize must be between 1 and 50");

			expect(() => createRetrievalConfig({ topKRerank: 100, topKRetrieve: 50 }))
				.toThrow("topKRerank cannot exceed topKRetrieve");
		});

		it("marks configuration as non-deterministic when overridden", () => {
			const config = createRetrievalConfig({ topKRerank: 32 });
			expect(config.deterministic).toBe(false);
		});

		it("preserves deterministic flag for default values", () => {
			const config = createRetrievalConfig();
			expect(config.deterministic).toBe(true);
		});
	});

	describe("applySloBackoff", () => {
		it("reduces rerank window when SLO is breached", () => {
			const config = DEFAULT_RETRIEVAL_CONFIG;
			const reducedRerank = applySloBackoff(600, config, 500);

			expect(reducedRerank).toBe(32);
		});

		it("maintains normal rerank window when SLO is met", () => {
			const config = DEFAULT_RETRIEVAL_CONFIG;
			const normalRerank = applySloBackoff(400, config, 500);

			expect(normalRerank).toBe(config.topKRerank);
		});

		it("caps reduction at configured rerank value", () => {
			const config = { ...DEFAULT_RETRIEVAL_CONFIG, topKRerank: 16 };
			const cappedRerank = applySloBackoff(600, config, 500);

			expect(cappedRerank).toBe(16); // Should not exceed original value
		});
	});

	describe("calculateResultDiversity", () => {
		it("calculates diversity across collections", () => {
			const results = [
				{ ...createTestResult("note_1", "ver_1", "pas_1", 0.9), collection_ids: ["col_A"] },
				{ ...createTestResult("note_2", "ver_2", "pas_2", 0.8), collection_ids: ["col_B"] },
				{ ...createTestResult("note_3", "ver_3", "pas_3", 0.7), collection_ids: ["col_A"] },
			];

			const diversity = calculateResultDiversity(results);

			expect(diversity).toBeGreaterThan(0.0);
			expect(diversity).toBeLessThanOrEqual(1.0);
		});

		it("returns 0.0 for results from single collection", () => {
			const results = [
				{ ...createTestResult("note_1", "ver_1", "pas_1", 0.9), collection_ids: ["col_A"] },
				{ ...createTestResult("note_2", "ver_2", "pas_2", 0.8), collection_ids: ["col_A"] },
			];

			const diversity = calculateResultDiversity(results);
			expect(diversity).toBe(0.0);
		});

		it("returns 0.0 for empty results", () => {
			const diversity = calculateResultDiversity([]);
			expect(diversity).toBe(0.0);
		});
	});

	describe("filterForCitationCoverage", () => {
		it("filters results to meet citation requirements", () => {
			const results = [
				createTestResult("note_1", "ver_1", "pas_1", 0.9), // High score - citable
				createTestResult("note_2", "ver_2", "pas_2", 0.5), // Medium score - citable
				createTestResult("note_3", "ver_3", "pas_3", 0.2), // Low score - not citable
				createTestResult("note_4", "ver_4", "pas_4", 0.1), // Very low score - not citable
			];

			// With 0.5 coverage requirement (2 out of 4 results), we have 2 citable results
			// which meets the requirement, so all results are returned
			const filtered = filterForCitationCoverage(results, 0.5);
			expect(filtered).toHaveLength(4); // All results returned

			// With 0.8 coverage requirement (4 out of 4 results), we only have 2 citable results
			// which doesn't meet requirement, so only citable results are returned
			const strictFiltered = filterForCitationCoverage(results, 0.8);
			expect(strictFiltered).toHaveLength(2);
			expect(strictFiltered.every(r => r.score > 0.3)).toBe(true);
		});

		it("returns all results when coverage is met", () => {
			const results = [
				createTestResult("note_1", "ver_1", "pas_1", 0.9),
				createTestResult("note_2", "ver_2", "pas_2", 0.8),
				createTestResult("note_3", "ver_3", "pas_3", 0.7),
			];

			const filtered = filterForCitationCoverage(results, 0.5);

			expect(filtered).toHaveLength(3);
		});

		it("handles empty results", () => {
			const filtered = filterForCitationCoverage([], 0.8);
			expect(filtered).toEqual([]);
		});
	});

	// Integration golden test
	describe("End-to-End Golden Test", () => {
		it("produces deterministic results for complete pipeline", () => {
			// Golden dataset with known expected behavior
			const rawResults = [
				// Duplicates (same note+version, different passages)
				createTestResult("note_alpha", "ver_001", "pas_aaa", 0.85),
				createTestResult("note_alpha", "ver_001", "pas_bbb", 0.95), // Should win dedup
				
				// Different versions of same note
				createTestResult("note_alpha", "ver_002", "pas_ccc", 0.80),
				
				// Different notes
				createTestResult("note_beta", "ver_001", "pas_ddd", 0.90),
				createTestResult("note_gamma", "ver_001", "pas_eee", 0.75),
				
				// Edge case: identical scores requiring tie-breaking
				createTestResult("note_delta", "ver_001", "pas_fff", 0.80),
				createTestResult("note_echo", "ver_001", "pas_ggg", 0.80),
			];

			const processed = processSearchResults(rawResults);

			// Golden expectations:
			// 1. Deduplication should keep note_alpha+ver_001 with score 0.95
			// 2. Sorting should be: 0.95, 0.90, 0.80 (with tie-breaking)
			
			expect(processed[0].score).toBe(0.95);
			expect(processed[0].note_id).toBe("note_alpha");
			expect(processed[0].passage_id).toBe("pas_bbb");

			expect(processed[1].score).toBe(0.90);
			expect(processed[1].note_id).toBe("note_beta");

			// Tie-breaking verification (score 0.80 results)
			const scoreEightyResults = processed.filter(r => r.score === 0.80);
			expect(scoreEightyResults).toHaveLength(3);
			
			// Should be sorted by version_id then passage_id
			expect(scoreEightyResults[0].version_id).toBe("ver_001"); // delta, echo have ver_001
			expect(scoreEightyResults[1].version_id).toBe("ver_001");
			expect(scoreEightyResults[2].version_id).toBe("ver_002"); // alpha ver_002

			// Within same version_id, sort by passage_id
			expect(scoreEightyResults[0].passage_id).toBe("pas_fff"); // delta
			expect(scoreEightyResults[1].passage_id).toBe("pas_ggg"); // echo
		});
	});
});
