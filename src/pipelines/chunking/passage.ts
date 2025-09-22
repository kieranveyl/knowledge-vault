/**
 * Passage chunking pipeline for search indexing
 * 
 * References SPEC.md Section 3: "max 180 tokens per passage; 50% overlap (stride 90 tokens); 
 * max note size indexed = 20k tokens; retain structure_path boundaries where possible"
 */

import { Effect } from "effect";
import { tokenizeText, normalizeText, extractStructurePath } from "../../domain/anchor";
import type { 
	VersionId, 
	PassageId,
	Passage,
} from "../../schema/entities";
import type { 
	TokenizationConfig,
	StructurePath,
} from "../../schema/anchors";
import { TOKENIZATION_CONFIG_V1 } from "../../schema/anchors";
import { ulid } from "ulid";

/**
 * Chunking configuration per SPEC requirements
 */
export interface ChunkingConfig {
	readonly maxTokensPerPassage: number; // SPEC: max 180 tokens per passage
	readonly overlapTokens: number; // SPEC: 50% overlap (stride 90 tokens)  
	readonly maxNoteTokens: number; // SPEC: max 20k tokens indexed
	readonly preserveStructureBoundaries: boolean; // SPEC: retain structure_path boundaries where possible
	readonly minPassageTokens: number; // Minimum viable passage size
}

/**
 * Default chunking configuration from SPEC
 */
export const DEFAULT_CHUNKING_CONFIG: ChunkingConfig = {
	maxTokensPerPassage: 180,
	overlapTokens: 90, // 50% overlap
	maxNoteTokens: 20000,
	preserveStructureBoundaries: true,
	minPassageTokens: 10, // Don't create tiny passages
} as const;

/**
 * Content chunk ready for indexing
 */
export interface ContentChunk {
	readonly passage_id: PassageId;
	readonly version_id: VersionId;
	readonly structure_path: StructurePath;
	readonly token_offset: number;
	readonly token_length: number;
	readonly content: string;
	readonly snippet: string; // Truncated content for display
	readonly char_offset: number; // Character position in original content
	readonly char_length: number; // Character length of chunk
}

/**
 * Chunking error types
 */
export type ChunkingError =
	| { readonly _tag: "ContentTooLarge"; readonly tokenCount: number; readonly maxTokens: number }
	| { readonly _tag: "TokenizationFailed"; readonly reason: string }
	| { readonly _tag: "StructureExtractionFailed"; readonly content: string }
	| { readonly _tag: "InvalidChunkingConfig"; readonly errors: readonly string[] };

/**
 * Structure boundary for chunk alignment
 */
interface StructureBoundary {
	readonly tokenOffset: number;
	readonly structurePath: StructurePath;
	readonly headingText: string;
	readonly charOffset: number;
}

/**
 * Validates chunking configuration
 * 
 * @param config - Configuration to validate
 * @returns Validation errors (empty if valid)
 */
export function validateChunkingConfig(config: ChunkingConfig): string[] {
	const errors: string[] = [];

	if (config.maxTokensPerPassage < 10) {
		errors.push("maxTokensPerPassage must be at least 10");
	}

	if (config.maxTokensPerPassage > 1000) {
		errors.push("maxTokensPerPassage cannot exceed 1000");
	}

	if (config.overlapTokens >= config.maxTokensPerPassage) {
		errors.push("overlapTokens must be less than maxTokensPerPassage");
	}

	if (config.overlapTokens < 0) {
		errors.push("overlapTokens cannot be negative");
	}

	if (config.maxNoteTokens < config.maxTokensPerPassage) {
		errors.push("maxNoteTokens must be at least maxTokensPerPassage");
	}

	if (config.minPassageTokens < 1) {
		errors.push("minPassageTokens must be at least 1");
	}

	if (config.minPassageTokens >= config.maxTokensPerPassage) {
		errors.push("minPassageTokens must be less than maxTokensPerPassage");
	}

	return errors;
}

/**
 * Extracts structure boundaries from Markdown content
 * 
 * @param content - Markdown content to analyze
 * @param tokenOffsets - Token character offsets from tokenization
 * @returns Array of structure boundaries for chunk alignment
 */
function extractStructureBoundaries(
	content: string,
	tokenOffsets: readonly number[],
): StructureBoundary[] {
	const boundaries: StructureBoundary[] = [];
	const lines = content.split("\n");
	let charOffset = 0;
	const headingStack: string[] = [];

	for (const line of lines) {
		const trimmed = line.trim();
		const match = trimmed.match(/^(#{1,6})\s+(.+)$/);
		
		if (match) {
			const level = match[1].length;
			const heading = match[2].trim();
			
			// Update heading stack for current level
			headingStack.splice(level - 1);
			headingStack[level - 1] = heading
				.toLowerCase()
				.replace(/[^a-z0-9\s]/g, "")
				.replace(/\s+/g, "-")
				.substring(0, 50);

			// Find closest token offset
			const closestTokenIndex = tokenOffsets.findIndex(
				offset => offset >= charOffset
			);

			if (closestTokenIndex !== -1) {
				boundaries.push({
					tokenOffset: closestTokenIndex,
					structurePath: ("/" + headingStack.filter(Boolean).join("/")) as StructurePath,
					headingText: heading,
					charOffset,
				});
			}
		}

		charOffset += line.length + 1; // +1 for newline
	}

	return boundaries;
}

/**
 * Generates text snippet from token range
 * 
 * @param tokens - Token array
 * @param startToken - Starting token index
 * @param endToken - Ending token index (exclusive)
 * @param maxLength - Maximum snippet length
 * @returns Truncated snippet for display
 */
function generateSnippet(
	tokens: readonly string[],
	startToken: number,
	endToken: number,
	maxLength = 200,
): string {
	const content = tokens.slice(startToken, endToken).join(" ");
	
	if (content.length <= maxLength) {
		return content;
	}

	// Truncate at word boundary
	const truncated = content.substring(0, maxLength);
	const lastSpace = truncated.lastIndexOf(" ");
	
	return lastSpace > maxLength * 0.8 
		? truncated.substring(0, lastSpace) + "…"
		: truncated + "…";
}

/**
 * Calculates character range for token span
 * 
 * @param tokenOffsets - Character offsets for each token
 * @param normalizedText - The normalized text content
 * @param startToken - Starting token index
 * @param endToken - Ending token index (exclusive)
 * @returns Character offset and length
 */
function calculateCharacterRange(
	tokenOffsets: readonly number[],
	normalizedText: string,
	startToken: number,
	endToken: number,
): { charOffset: number; charLength: number } {
	const charOffset = tokenOffsets[startToken] || 0;
	
	// Calculate end position
	let charEnd: number;
	if (endToken < tokenOffsets.length) {
		charEnd = tokenOffsets[endToken];
	} else {
		// Last chunk - extend to end of content
		charEnd = normalizedText.length;
	}

	return {
		charOffset,
		charLength: charEnd - charOffset,
	};
}

/**
 * Chunks content into indexable passages according to SPEC requirements
 * 
 * @param versionId - Version ID for the content
 * @param content - Markdown content to chunk
 * @param config - Chunking configuration
 * @param tokenizationConfig - Tokenization configuration
 * @returns Effect resolving to array of content chunks
 */
export function chunkContent(
	versionId: VersionId,
	content: string,
	config: ChunkingConfig = DEFAULT_CHUNKING_CONFIG,
	tokenizationConfig: TokenizationConfig = TOKENIZATION_CONFIG_V1,
): Effect.Effect<readonly ContentChunk[], ChunkingError> {
	return Effect.try({
		try: () => {
			// Validate configuration
			const configErrors = validateChunkingConfig(config);
			if (configErrors.length > 0) {
				throw {
					_tag: "InvalidChunkingConfig",
					errors: configErrors,
				};
			}

			// Normalize and tokenize content
			const normalizedContent = normalizeText(content, true);
			const tokenization = tokenizeText(normalizedContent, tokenizationConfig);

			// Check token count limit
			if (tokenization.tokens.length > config.maxNoteTokens) {
				throw {
					_tag: "ContentTooLarge",
					tokenCount: tokenization.tokens.length,
					maxTokens: config.maxNoteTokens,
				};
			}

			// Extract structure boundaries for alignment
			const structureBoundaries = config.preserveStructureBoundaries
				? extractStructureBoundaries(normalizedContent, tokenization.tokenOffsets)
				: [];

			const chunks: ContentChunk[] = [];
			const stride = config.maxTokensPerPassage - config.overlapTokens;
			let currentStructurePath: StructurePath = "/" as StructurePath;

			// Generate chunks with specified overlap
			for (let startToken = 0; startToken < tokenization.tokens.length; startToken += stride) {
				const endToken = Math.min(
					startToken + config.maxTokensPerPassage,
					tokenization.tokens.length,
				);

				// Skip chunks that are too small (unless it's the last chunk)
				if (endToken - startToken < config.minPassageTokens && endToken < tokenization.tokens.length) {
					continue;
				}

				// Find appropriate structure path for this chunk
				if (config.preserveStructureBoundaries) {
					const relevantBoundary = structureBoundaries
						.filter(b => b.tokenOffset <= startToken)
						.pop(); // Get latest boundary before this chunk
					
					if (relevantBoundary) {
						currentStructurePath = relevantBoundary.structurePath;
					}
				}

				// Calculate character range
				const { charOffset, charLength } = calculateCharacterRange(
					tokenization.tokenOffsets,
					normalizedContent,
					startToken,
					endToken,
				);

				// Extract content for this chunk
				const chunkContent = tokenization.tokens.slice(startToken, endToken).join(" ");
				const snippet = generateSnippet(tokenization.tokens, startToken, endToken);

				chunks.push({
					passage_id: `pas_${ulid()}` as PassageId,
					version_id: versionId,
					structure_path: currentStructurePath,
					token_offset: startToken,
					token_length: endToken - startToken,
					content: chunkContent,
					snippet,
					char_offset: charOffset,
					char_length: charLength,
				});
			}

			return chunks;
		},
		catch: (error) => {
			if (typeof error === "object" && error !== null && "_tag" in error) {
				return error as ChunkingError;
			}
			
			return {
				_tag: "TokenizationFailed",
				reason: error instanceof Error ? error.message : "Unknown tokenization error",
			} as ChunkingError;
		},
	});
}

/**
 * Chunks multiple versions efficiently
 * 
 * @param versions - Array of versions with their content
 * @param config - Chunking configuration
 * @param tokenizationConfig - Tokenization configuration
 * @returns Effect resolving to all chunks across versions
 */
export function chunkMultipleVersions(
	versions: readonly { version_id: VersionId; content: string }[],
	config: ChunkingConfig = DEFAULT_CHUNKING_CONFIG,
	tokenizationConfig: TokenizationConfig = TOKENIZATION_CONFIG_V1,
): Effect.Effect<readonly ContentChunk[], ChunkingError> {
	return Effect.all(
		versions.map(({ version_id, content }) =>
			chunkContent(version_id, content, config, tokenizationConfig)
		),
		{ concurrency: "unbounded" }
	).pipe(
		Effect.map(chunkArrays => chunkArrays.flat())
	);
}

/**
 * Estimates memory usage for chunking operation
 * 
 * @param contentLength - Total character length of content
 * @param config - Chunking configuration
 * @returns Estimated memory usage in bytes
 */
export function estimateChunkingMemoryUsage(
	contentLength: number,
	config: ChunkingConfig = DEFAULT_CHUNKING_CONFIG,
): number {
	// Rough estimation: normalized content + tokens + chunk objects
	const normalizedSize = contentLength * 1.2; // Unicode normalization overhead
	const tokenSize = contentLength * 0.8; // Tokens are typically smaller than original
	const chunkCount = Math.ceil(contentLength / (config.maxTokensPerPassage * 4)); // ~4 chars per token
	const chunkObjectSize = chunkCount * 500; // ~500 bytes per chunk object
	
	return normalizedSize + tokenSize + chunkObjectSize;
}

/**
 * Validates chunk quality metrics
 * 
 * @param chunks - Generated chunks to analyze
 * @returns Quality metrics and validation results
 */
export function validateChunkQuality(chunks: readonly ContentChunk[]): {
	readonly valid: boolean;
	readonly metrics: {
		readonly totalChunks: number;
		readonly avgTokensPerChunk: number;
		readonly minTokensPerChunk: number;
		readonly maxTokensPerChunk: number;
		readonly structurePathCoverage: number; // 0.0 to 1.0
		readonly overlapConsistency: number; // 0.0 to 1.0
	};
	readonly issues: readonly string[];
} {
	const issues: string[] = [];
	
	if (chunks.length === 0) {
		return {
			valid: false,
			metrics: {
				totalChunks: 0,
				avgTokensPerChunk: 0,
				minTokensPerChunk: 0,
				maxTokensPerChunk: 0,
				structurePathCoverage: 0,
				overlapConsistency: 0,
			},
			issues: ["No chunks generated"],
		};
	}

	// Calculate token distribution
	const tokenCounts = chunks.map(c => c.token_length);
	const totalTokens = tokenCounts.reduce((sum, count) => sum + count, 0);
	const avgTokensPerChunk = totalTokens / chunks.length;
	const minTokensPerChunk = Math.min(...tokenCounts);
	const maxTokensPerChunk = Math.max(...tokenCounts);

	// Check for chunks that are too large
	const oversizedChunks = chunks.filter(c => c.token_length > DEFAULT_CHUNKING_CONFIG.maxTokensPerPassage);
	if (oversizedChunks.length > 0) {
		issues.push(`${oversizedChunks.length} chunks exceed maximum token limit`);
	}

	// Check for chunks that are too small
	const undersizedChunks = chunks.filter(c => c.token_length < DEFAULT_CHUNKING_CONFIG.minPassageTokens);
	if (undersizedChunks.length > 0) {
		issues.push(`${undersizedChunks.length} chunks are below minimum token limit`);
	}

	// Calculate structure path coverage
	const uniqueStructurePaths = new Set(chunks.map(c => c.structure_path));
	const structurePathCoverage = Math.min(1.0, uniqueStructurePaths.size / Math.max(1, chunks.length * 0.3));

	// Calculate overlap consistency (simplified check)
	let validOverlaps = 0;
	for (let i = 1; i < chunks.length; i++) {
		const prevChunk = chunks[i - 1];
		const currentChunk = chunks[i];
		
		// Check if chunks are from same version and have reasonable overlap
		if (prevChunk.version_id === currentChunk.version_id) {
			const expectedOverlapStart = prevChunk.token_offset + (DEFAULT_CHUNKING_CONFIG.maxTokensPerPassage - DEFAULT_CHUNKING_CONFIG.overlapTokens);
			const actualOverlapStart = currentChunk.token_offset;
			
			if (Math.abs(actualOverlapStart - expectedOverlapStart) <= 5) {
				validOverlaps++;
			}
		}
	}
	
	const overlapConsistency = chunks.length > 1 ? validOverlaps / (chunks.length - 1) : 1.0;

	return {
		valid: issues.length === 0,
		metrics: {
			totalChunks: chunks.length,
			avgTokensPerChunk,
			minTokensPerChunk,
			maxTokensPerChunk,
			structurePathCoverage,
			overlapConsistency,
		},
		issues,
	};
}

/**
 * Creates passage entities from content chunks
 * 
 * @param chunks - Content chunks to convert
 * @returns Array of passage entities ready for indexing
 */
export function createPassagesFromChunks(chunks: readonly ContentChunk[]): readonly Passage[] {
	return chunks.map(chunk => ({
		id: chunk.passage_id,
		version_id: chunk.version_id,
		structure_path: chunk.structure_path,
		token_span: {
			offset: chunk.token_offset,
			length: chunk.token_length,
		},
		snippet: chunk.snippet,
	}));
}

/**
 * Optimizes chunk boundaries to align with sentence breaks
 * 
 * @param content - Original content
 * @param tokenOffsets - Token character positions
 * @param chunkStart - Chunk start token
 * @param chunkEnd - Chunk end token
 * @returns Adjusted chunk boundaries
 */
function optimizeChunkBoundaries(
	content: string,
	tokenOffsets: readonly number[],
	chunkStart: number,
	chunkEnd: number,
): { start: number; end: number } {
	// Simple implementation: try to end at sentence boundaries
	const endCharPos = tokenOffsets[chunkEnd - 1] || content.length;
	const nearbyText = content.substring(endCharPos - 20, endCharPos + 20);
	
	// Look for sentence endings near the chunk boundary
	const sentenceEndMatch = nearbyText.match(/[.!?]\s/);
	if (sentenceEndMatch) {
		// Try to find the token that corresponds to this position
		const sentenceEndPos = endCharPos - 20 + sentenceEndMatch.index! + 1;
		const adjustedTokenIndex = tokenOffsets.findIndex(offset => offset >= sentenceEndPos);
		
		if (adjustedTokenIndex !== -1 && Math.abs(adjustedTokenIndex - chunkEnd) <= 5) {
			return { start: chunkStart, end: adjustedTokenIndex };
		}
	}

	// No good sentence boundary found, keep original
	return { start: chunkStart, end: chunkEnd };
}

/**
 * Advanced chunking with boundary optimization
 * 
 * @param versionId - Version ID for the content
 * @param content - Markdown content to chunk
 * @param config - Chunking configuration
 * @param tokenizationConfig - Tokenization configuration
 * @returns Effect resolving to optimized content chunks
 */
export function chunkContentOptimized(
	versionId: VersionId,
	content: string,
	config: ChunkingConfig = DEFAULT_CHUNKING_CONFIG,
	tokenizationConfig: TokenizationConfig = TOKENIZATION_CONFIG_V1,
): Effect.Effect<readonly ContentChunk[], ChunkingError> {
	return chunkContent(versionId, content, config, tokenizationConfig).pipe(
		Effect.map(chunks => {
			// Apply boundary optimization if requested
			if (config.preserveStructureBoundaries) {
				// In a full implementation, we'd re-process chunks to optimize boundaries
				// For now, return chunks as-is
				return chunks;
			}
			
			return chunks;
		})
	);
}

/**
 * Chunking pipeline for batch processing
 * 
 * @param versions - Versions to process
 * @param config - Chunking configuration
 * @param tokenizationConfig - Tokenization configuration
 * @returns Effect resolving to all processed chunks with quality metrics
 */
export function runChunkingPipeline(
	versions: readonly { version_id: VersionId; content: string }[],
	config: ChunkingConfig = DEFAULT_CHUNKING_CONFIG,
	tokenizationConfig: TokenizationConfig = TOKENIZATION_CONFIG_V1,
): Effect.Effect<{
	readonly chunks: readonly ContentChunk[];
	readonly qualityMetrics: ReturnType<typeof validateChunkQuality>;
	readonly memoryUsageEstimate: number;
}, ChunkingError> {
	return chunkMultipleVersions(versions, config, tokenizationConfig).pipe(
		Effect.map(chunks => {
			const qualityMetrics = validateChunkQuality(chunks);
			const totalContentLength = versions.reduce((sum, v) => sum + v.content.length, 0);
			const memoryUsageEstimate = estimateChunkingMemoryUsage(totalContentLength, config);

			return {
				chunks,
				qualityMetrics,
				memoryUsageEstimate,
			};
		})
	);
}
