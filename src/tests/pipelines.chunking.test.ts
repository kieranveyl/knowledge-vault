import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import {
	chunkContent,
	chunkMultipleVersions,
	validateChunkingConfig,
	validateChunkQuality,
	createPassagesFromChunks,
	estimateChunkingMemoryUsage,
	runChunkingPipeline,
	DEFAULT_CHUNKING_CONFIG,
} from "../pipelines/chunking/passage";
import type { VersionId } from "../schema/entities";

describe("pipelines/chunking/passage", () => {
	const sampleContent = `# Introduction

This is a sample document for testing the chunking pipeline. It contains multiple paragraphs and sections to ensure proper chunking behavior.

## First Section

Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.

Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.

## Second Section

Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium, totam rem aperiam, eaque ipsa quae ab illo inventore veritatis et quasi architecto beatae vitae dicta sunt explicabo.

### Subsection

Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit, sed quia consequuntur magni dolores eos qui ratione voluptatem sequi nesciunt.

## Conclusion

At vero eos et accusamus et iusto odio dignissimos ducimus qui blanditiis praesentium voluptatum deleniti atque corrupti quos dolores et quas molestias excepturi sint occaecati cupiditate non provident.`;

	describe("validateChunkingConfig", () => {
		it("validates valid configuration", () => {
			const errors = validateChunkingConfig(DEFAULT_CHUNKING_CONFIG);
			expect(errors).toHaveLength(0);
		});

		it("rejects invalid configuration", () => {
			const invalidConfig = {
				...DEFAULT_CHUNKING_CONFIG,
				maxTokensPerPassage: 5, // Too small
				overlapTokens: 200, // Larger than max tokens
			};

			const errors = validateChunkingConfig(invalidConfig);
			expect(errors.length).toBeGreaterThan(0);
			expect(errors).toContain("maxTokensPerPassage must be at least 10");
			expect(errors).toContain("overlapTokens must be less than maxTokensPerPassage");
		});

		it("validates overlap constraints", () => {
			const invalidConfig = {
				...DEFAULT_CHUNKING_CONFIG,
				overlapTokens: -10, // Negative overlap
			};

			const errors = validateChunkingConfig(invalidConfig);
			expect(errors).toContain("overlapTokens cannot be negative");
		});
	});

	describe("chunkContent", () => {
		it("chunks content within token limits", async () => {
			const versionId = "ver_01JBXR8G9P7QN1VMPX84KTFHK2" as VersionId;
			const config = {
				...DEFAULT_CHUNKING_CONFIG,
				maxTokensPerPassage: 50, // Smaller for testing
				overlapTokens: 25,
				minPassageTokens: 5, // Allow smaller chunks for testing
			};

			const result = await Effect.runPromise(
				chunkContent(versionId, sampleContent, config)
			);

			expect(result.length).toBeGreaterThan(0);
			
			// All chunks should be within token limits
			for (const chunk of result) {
				expect(chunk.token_length).toBeLessThanOrEqual(config.maxTokensPerPassage);
				expect(chunk.token_length).toBeGreaterThanOrEqual(config.minPassageTokens);
			}

			// Verify chunk metadata
			expect(result[0].version_id).toBe(versionId);
			expect(result[0].passage_id).toMatch(/^pas_[0-9A-HJKMNP-TV-Z]{26}$/);
			expect(result[0].structure_path).toMatch(/^\//);
			expect(result[0].snippet.length).toBeLessThanOrEqual(200);
		});

		it("handles content that exceeds token limit", async () => {
			const versionId = "ver_01JBXR8G9P7QN1VMPX84KTFHK2" as VersionId;
			const largeContent = "word ".repeat(25000); // Exceeds 20k token limit
			
			const result = await Effect.runPromiseExit(
				chunkContent(versionId, largeContent, DEFAULT_CHUNKING_CONFIG)
			);

			expect(result._tag).toBe("Failure");
		});

		it("preserves structure boundaries when enabled", async () => {
			const versionId = "ver_01JBXR8G9P7QN1VMPX84KTFHK2" as VersionId;
			const config = {
				...DEFAULT_CHUNKING_CONFIG,
				maxTokensPerPassage: 30,
				preserveStructureBoundaries: true,
			};

			const result = await Effect.runPromise(
				chunkContent(versionId, sampleContent, config)
			);

			// Check that chunks have meaningful structure paths
			const structurePaths = result.map(chunk => chunk.structure_path);
			const uniquePaths = new Set(structurePaths);
			
			expect(uniquePaths.size).toBeGreaterThan(1); // Should have multiple structure contexts
			expect(structurePaths[0]).toMatch(/introduction/i);
		});

		it("creates proper overlap between chunks", async () => {
			const versionId = "ver_01JBXR8G9P7QN1VMPX84KTFHK2" as VersionId;
			const config = {
				...DEFAULT_CHUNKING_CONFIG,
				maxTokensPerPassage: 20,
				overlapTokens: 10,
			};

			const result = await Effect.runPromise(
				chunkContent(versionId, sampleContent, config)
			);

			if (result.length > 1) {
				// Check overlap exists between consecutive chunks
				const stride = config.maxTokensPerPassage - config.overlapTokens;
				const expectedSecondStart = result[0].token_offset + stride;
				
				// Allow some tolerance for structure boundary adjustments
				expect(Math.abs(result[1].token_offset - expectedSecondStart)).toBeLessThanOrEqual(5);
			}
		});
	});

	describe("chunkMultipleVersions", () => {
		it("processes multiple versions concurrently", async () => {
			const versions = [
				{ version_id: "ver_01JBXR8G9P7QN1VMPX84KTFHK2" as VersionId, content: sampleContent },
				{ version_id: "ver_01JBXR8G9P7QN1VMPX84KTFHK3" as VersionId, content: "# Short content\n\nBrief text." },
			];

			const config = {
				...DEFAULT_CHUNKING_CONFIG,
				maxTokensPerPassage: 50,
			};

			const result = await Effect.runPromise(
				chunkMultipleVersions(versions, config)
			);

			// Should have chunks from both versions
			const versionIds = new Set(result.map(chunk => chunk.version_id));
			expect(versionIds.size).toBe(2);
			expect(versionIds.has(versions[0].version_id)).toBe(true);
			expect(versionIds.has(versions[1].version_id)).toBe(true);
		});

		it("handles empty version list", async () => {
			const result = await Effect.runPromise(
				chunkMultipleVersions([], DEFAULT_CHUNKING_CONFIG)
			);

			expect(result).toHaveLength(0);
		});
	});

	describe("validateChunkQuality", () => {
		it("validates good chunk quality", async () => {
			const versionId = "ver_01JBXR8G9P7QN1VMPX84KTFHK2" as VersionId;
			const chunks = await Effect.runPromise(
				chunkContent(versionId, sampleContent, {
					...DEFAULT_CHUNKING_CONFIG,
					maxTokensPerPassage: 50,
				})
			);

			const quality = validateChunkQuality(chunks);

			expect(quality.valid).toBe(true);
			expect(quality.metrics.totalChunks).toBeGreaterThan(0);
			expect(quality.metrics.avgTokensPerChunk).toBeGreaterThan(0);
			expect(quality.metrics.structurePathCoverage).toBeGreaterThan(0);
			expect(quality.issues).toHaveLength(0);
		});

		it("detects quality issues", () => {
			const poorChunks = [
				{
					passage_id: "pas_test1" as any,
					version_id: "ver_test" as any,
					structure_path: "/" as any,
					token_offset: 0,
					token_length: 5, // Too small
					content: "small",
					snippet: "small",
					char_offset: 0,
					char_length: 5,
				},
				{
					passage_id: "pas_test2" as any,
					version_id: "ver_test" as any,
					structure_path: "/" as any,
					token_offset: 100,
					token_length: 250, // Too large
					content: "x".repeat(1000),
					snippet: "large chunk",
					char_offset: 500,
					char_length: 1000,
				},
			];

			const quality = validateChunkQuality(poorChunks);

			expect(quality.valid).toBe(false);
			expect(quality.issues.length).toBeGreaterThan(0);
		});

		it("handles empty chunk list", () => {
			const quality = validateChunkQuality([]);

			expect(quality.valid).toBe(false);
			expect(quality.issues).toContain("No chunks generated");
		});
	});

	describe("createPassagesFromChunks", () => {
		it("converts chunks to passages", async () => {
			const versionId = "ver_01JBXR8G9P7QN1VMPX84KTFHK2" as VersionId;
			const chunks = await Effect.runPromise(
				chunkContent(versionId, sampleContent, {
					...DEFAULT_CHUNKING_CONFIG,
					maxTokensPerPassage: 30,
				})
			);

			const passages = createPassagesFromChunks(chunks);

			expect(passages).toHaveLength(chunks.length);
			
			for (let i = 0; i < passages.length; i++) {
				const passage = passages[i];
				const chunk = chunks[i];

				expect(passage.id).toBe(chunk.passage_id);
				expect(passage.version_id).toBe(chunk.version_id);
				expect(passage.structure_path).toBe(chunk.structure_path);
				expect(passage.token_span.offset).toBe(chunk.token_offset);
				expect(passage.token_span.length).toBe(chunk.token_length);
				expect(passage.snippet).toBe(chunk.snippet);
			}
		});
	});

	describe("estimateChunkingMemoryUsage", () => {
		it("estimates reasonable memory usage", () => {
			const estimate = estimateChunkingMemoryUsage(10000, DEFAULT_CHUNKING_CONFIG);

			expect(estimate).toBeGreaterThan(0);
			expect(estimate).toBeLessThan(100_000_000); // Should be reasonable (< 100MB)
		});

		it("scales with content size", () => {
			const smallEstimate = estimateChunkingMemoryUsage(1000, DEFAULT_CHUNKING_CONFIG);
			const largeEstimate = estimateChunkingMemoryUsage(100000, DEFAULT_CHUNKING_CONFIG);

			expect(largeEstimate).toBeGreaterThan(smallEstimate);
		});
	});

	describe("runChunkingPipeline", () => {
		it("processes full chunking pipeline", async () => {
			const versions = [
				{ 
					version_id: "ver_01JBXR8G9P7QN1VMPX84KTFHK2" as VersionId, 
					content: sampleContent 
				},
			];

			const result = await Effect.runPromise(
				runChunkingPipeline(versions, {
					...DEFAULT_CHUNKING_CONFIG,
					maxTokensPerPassage: 40,
					overlapTokens: 20, // Keep valid overlap ratio
				})
			);

			expect(result.chunks.length).toBeGreaterThan(0);
			expect(result.qualityMetrics.valid).toBe(true);
			expect(result.memoryUsageEstimate).toBeGreaterThan(0);

			// Verify chunk quality
			expect(result.qualityMetrics.metrics.totalChunks).toBe(result.chunks.length);
			expect(result.qualityMetrics.metrics.avgTokensPerChunk).toBeGreaterThan(0);
		});

		it("handles multiple versions", async () => {
			const versions = [
				{ 
					version_id: "ver_01JBXR8G9P7QN1VMPX84KTFHK2" as VersionId, 
					content: sampleContent 
				},
				{ 
					version_id: "ver_01JBXR8G9P7QN1VMPX84KTFHK3" as VersionId, 
					content: "# Simple\n\nShort content here." 
				},
			];

			const result = await Effect.runPromise(
				runChunkingPipeline(versions)
			);

			// Should have chunks from both versions
			const versionIds = new Set(result.chunks.map(c => c.version_id));
			expect(versionIds.size).toBe(2);
		});

		it("enforces token limits per SPEC", async () => {
			const versions = [
				{ 
					version_id: "ver_01JBXR8G9P7QN1VMPX84KTFHK2" as VersionId, 
					content: "word ".repeat(25000) // Exceeds 20k limit
				},
			];

			const result = await Effect.runPromiseExit(
				runChunkingPipeline(versions)
			);

			expect(result._tag).toBe("Failure");
		});
	});

	describe("SPEC compliance", () => {
		it("enforces maximum 180 tokens per passage", async () => {
			const versionId = "ver_01JBXR8G9P7QN1VMPX84KTFHK2" as VersionId;
			
			const result = await Effect.runPromise(
				chunkContent(versionId, sampleContent, DEFAULT_CHUNKING_CONFIG)
			);

			// SPEC requirement: max 180 tokens per passage
			for (const chunk of result) {
				expect(chunk.token_length).toBeLessThanOrEqual(180);
			}
		});

		it("implements 50% overlap (90 token stride)", async () => {
			const versionId = "ver_01JBXR8G9P7QN1VMPX84KTFHK2" as VersionId;
			
			const result = await Effect.runPromise(
				chunkContent(versionId, sampleContent, DEFAULT_CHUNKING_CONFIG)
			);

			if (result.length > 1) {
				// Check stride between chunks
				const stride = result[1].token_offset - result[0].token_offset;
				
				// Should be close to 90 (allowing for structure boundary adjustments)
				expect(Math.abs(stride - 90)).toBeLessThanOrEqual(10);
			}
		});

		it("enforces 20k token limit per note", async () => {
			const versionId = "ver_01JBXR8G9P7QN1VMPX84KTFHK2" as VersionId;
			const largeContent = "token ".repeat(21000); // Exceeds limit

			const result = await Effect.runPromiseExit(
				chunkContent(versionId, largeContent, DEFAULT_CHUNKING_CONFIG)
			);

			expect(result._tag).toBe("Failure");
			if (result._tag === "Failure") {
				// Should be ContentTooLarge error
				expect(result.cause.toString()).toContain("ContentTooLarge");
			}
		});

		it("retains structure_path boundaries where possible", async () => {
			const versionId = "ver_01JBXR8G9P7QN1VMPX84KTFHK2" as VersionId;
			const config = {
				...DEFAULT_CHUNKING_CONFIG,
				preserveStructureBoundaries: true,
				maxTokensPerPassage: 40,
				overlapTokens: 20, // Keep valid overlap ratio
			};

			const result = await Effect.runPromise(
				chunkContent(versionId, sampleContent, config)
			);

			// Should have multiple structure paths reflecting heading structure
			const structurePaths = result.map(c => c.structure_path);
			const uniquePaths = new Set(structurePaths);
			
			expect(uniquePaths.size).toBeGreaterThan(1);
			
			// Should include paths reflecting heading hierarchy
			const pathStrings = Array.from(uniquePaths);
			expect(pathStrings.some(path => path.includes("introduction"))).toBe(true);
		});
	});
});
