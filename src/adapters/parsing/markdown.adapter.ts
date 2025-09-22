/**
 * Markdown parsing adapter implementation
 * 
 * References SPEC.md Section 2: Tokenization Standard
 * Implements ParsingPort using domain logic for content processing
 */

import { Effect } from "effect";
import {
	normalizeText,
	tokenizeText,
	createAnchor,
	resolveAnchor,
	detectAnchorDrift,
	extractAnchorContent,
	extractStructurePath,
	computeFingerprint,
	type TokenizationResult,
} from "../../domain/anchor";

import { analyzeContent } from "../../domain/validation";

import type {
	Anchor,
	TokenSpan,
	AnchorResolution,
	AnchorDrift,
	TokenizationConfig,
	StructurePath,
	TokenOffset,
	TokenLength,
} from "../../schema/anchors";

import type {
	ParsingPort,
	ParsingError,
	MarkdownStructure,
	ContentChunk,
	ChunkingConfig,
	DEFAULT_CHUNKING_CONFIG,
} from "../../services/parsing.port";

import { chunkContent } from "../../pipelines/chunking/passage";

/**
 * Creates parsing error effect
 */
const parsingError = (error: ParsingError) => Effect.fail(error);

/**
 * Markdown parsing adapter implementation
 */
export class MarkdownParsingAdapter implements ParsingPort {
	// Content normalization and tokenization
	readonly normalizeContent = (
		content: string,
		preserveCodeContent = true,
	): Effect.Effect<string, ParsingError> =>
		Effect.try({
			try: () => normalizeText(content, preserveCodeContent),
			catch: (error) => ({
				_tag: "TokenizationFailed",
				reason: error instanceof Error ? error.message : "Normalization failed",
			} as ParsingError),
		});

	readonly tokenizeContent = (
		content: string,
		config?: TokenizationConfig,
	): Effect.Effect<TokenizationResult, ParsingError> =>
		Effect.try({
			try: () => {
				const normalized = normalizeText(content, true);
				return tokenizeText(normalized, config);
			},
			catch: (error) => ({
				_tag: "TokenizationFailed",
				reason: error instanceof Error ? error.message : "Tokenization failed",
			} as ParsingError),
		});

	// Structure extraction
	readonly extractMarkdownStructure = (
		content: string,
	): Effect.Effect<MarkdownStructure, ParsingError> =>
		Effect.try({
			try: () => {
				const lines = content.split("\n");
				const headings: MarkdownStructure["headings"] = [];
				const codeBlocks: MarkdownStructure["code_blocks"] = [];
				const links: MarkdownStructure["links"] = [];
				const images: MarkdownStructure["images"] = [];

				let charOffset = 0;
				let inCodeBlock = false;
				let codeBlockStart = 0;
				let codeBlockLanguage: string | undefined;

				for (const line of lines) {
					const trimmed = line.trim();

					// Handle code blocks
					if (trimmed.startsWith("```")) {
						if (!inCodeBlock) {
							inCodeBlock = true;
							codeBlockStart = charOffset;
							codeBlockLanguage = trimmed.substring(3) || undefined;
						} else {
							inCodeBlock = false;
							codeBlocks.push({
								language: codeBlockLanguage,
								char_start: codeBlockStart,
								char_end: charOffset + line.length,
							});
						}
					}

					// Handle headings (only outside code blocks)
					if (!inCodeBlock) {
						const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
						if (headingMatch) {
							const level = headingMatch[1].length;
							const text = headingMatch[2].trim();
							const normalized_id = text
								.toLowerCase()
								.replace(/[^a-z0-9\s]/g, "")
								.replace(/\s+/g, "-")
								.substring(0, 50);

							headings.push({
								level,
								text,
								normalized_id,
								char_offset: charOffset,
							});
						}

						// Handle links and images
						const linkMatches = line.matchAll(/(!?)\[([^\]]*)\]\(([^)]+)\)/g);
						for (const match of linkMatches) {
							const isImage = match[1] === "!";
							const text = match[2];
							const url = match[3];
							const linkOffset = charOffset + match.index!;

							if (isImage) {
								images.push({
									alt_text: text,
									url,
									char_offset: linkOffset,
								});
							} else {
								links.push({
									text,
									url,
									char_offset: linkOffset,
								});
							}
						}
					}

					charOffset += line.length + 1; // +1 for newline
				}

				return {
					headings,
					code_blocks: codeBlocks,
					links,
					images,
				};
			},
			catch: (error) => ({
				_tag: "StructureExtractionFailed",
				content: content.substring(0, 100) + "...",
			} as ParsingError),
		});

	readonly extractStructurePath = (
		content: string,
		targetCharOffset?: number,
	): Effect.Effect<StructurePath, ParsingError> =>
		Effect.try({
			try: () => extractStructurePath(content),
			catch: (error) => ({
				_tag: "StructureExtractionFailed",
				content: content.substring(0, 100) + "...",
			} as ParsingError),
		});

	// Content chunking
	readonly chunkContent = (
		content: string,
		config: ChunkingConfig = DEFAULT_CHUNKING_CONFIG,
	): Effect.Effect<readonly ContentChunk[], ParsingError> =>
		Effect.gen(this, function* () {
			// Use dummy version ID for chunking
			const versionId = `ver_${Date.now()}` as any;
			const chunks = yield* chunkContent(versionId, content, config);

			return chunks.map(chunk => ({
				structure_path: chunk.structure_path,
				content: chunk.content,
				token_span: {
					offset: chunk.token_offset,
					length: chunk.token_length,
				},
				snippet: chunk.snippet,
				char_offset: chunk.char_offset,
				char_length: chunk.char_length,
			}));
		}).pipe(
			Effect.catchAll(error => 
				parsingError({
					_tag: "InvalidMarkdown",
					content: content.substring(0, 100) + "...",
				})
			)
		);

	readonly validateChunkingConfig = (
		config: ChunkingConfig,
	): Effect.Effect<{ valid: boolean; errors: readonly string[] }, ParsingError> =>
		Effect.sync(() => {
			// Use validation from chunking pipeline
			const errors: string[] = [];
			
			if (config.max_tokens_per_chunk < 10) {
				errors.push("max_tokens_per_chunk must be at least 10");
			}
			
			if (config.overlap_tokens >= config.max_tokens_per_chunk) {
				errors.push("overlap_tokens must be less than max_tokens_per_chunk");
			}

			return {
				valid: errors.length === 0,
				errors,
			};
		});

	// Anchor operations
	readonly createAnchor = (
		content: string,
		structure_path: StructurePath,
		token_offset: TokenOffset,
		token_length: TokenLength,
		config?: TokenizationConfig,
	): Effect.Effect<Anchor, ParsingError> =>
		Effect.promise(() => createAnchor(content, structure_path, token_offset, token_length, config))
			.pipe(
				Effect.catchAll(error =>
					parsingError({
						_tag: "AnchorResolutionFailed",
						anchor: {
							structure_path,
							token_offset,
							token_length,
						} as any,
						reason: error instanceof Error ? error.message : "Anchor creation failed",
					})
				)
			);

	readonly resolveAnchor = (
		anchor: Anchor,
		content: string,
		config?: TokenizationConfig,
	): Effect.Effect<AnchorResolution, ParsingError> =>
		Effect.promise(() => resolveAnchor(anchor, content, config))
			.pipe(
				Effect.catchAll(error =>
					parsingError({
						_tag: "AnchorResolutionFailed",
						anchor,
						reason: error instanceof Error ? error.message : "Anchor resolution failed",
					})
				)
			);

	readonly detectAnchorDrift = (
		originalAnchor: Anchor,
		currentContent: string,
		config?: TokenizationConfig,
	): Effect.Effect<AnchorDrift, ParsingError> =>
		Effect.promise(() => detectAnchorDrift(originalAnchor, currentContent, config))
			.pipe(
				Effect.catchAll(error =>
					parsingError({
						_tag: "AnchorResolutionFailed",
						anchor: originalAnchor,
						reason: error instanceof Error ? error.message : "Drift detection failed",
					})
				)
			);

	readonly extractAnchorContent = (
		anchor: Anchor,
		content: string,
		config?: TokenizationConfig,
	): Effect.Effect<string | null, ParsingError> =>
		Effect.promise(() => extractAnchorContent(anchor, content, config))
			.pipe(
				Effect.catchAll(error =>
					parsingError({
						_tag: "AnchorResolutionFailed",
						anchor,
						reason: error instanceof Error ? error.message : "Content extraction failed",
					})
				)
			);

	// Content analysis
	readonly analyzeContent = (
		content: string,
	): Effect.Effect<{
		readonly word_count: number;
		readonly character_count: number;
		readonly estimated_reading_time_minutes: number;
		readonly features: {
			readonly has_code_blocks: boolean;
			readonly has_images: boolean;
			readonly has_links: boolean;
			readonly heading_count: number;
			readonly max_heading_level: number;
		};
	}, ParsingError> =>
		Effect.try({
			try: () => {
				const analysis = analyzeContent(content);
				return {
					word_count: analysis.wordCount,
					character_count: analysis.characterCount,
					estimated_reading_time_minutes: analysis.estimatedReadingTimeMinutes,
					features: {
						has_code_blocks: analysis.hasCodeBlocks,
						has_images: analysis.hasImages,
						has_links: analysis.hasLinks,
						heading_count: analysis.headingCount,
						max_heading_level: analysis.maxHeadingLevel,
					},
				};
			},
			catch: (error) => ({
				_tag: "InvalidMarkdown",
				content: content.substring(0, 100) + "...",
			} as ParsingError),
		});

	readonly validateMarkdown = (
		content: string,
	): Effect.Effect<{ valid: boolean; errors: readonly string[] }, ParsingError> =>
		Effect.sync(() => {
			// Basic Markdown validation
			const errors: string[] = [];

			// Check for unclosed code blocks
			const codeBlockMatches = content.match(/```/g);
			if (codeBlockMatches && codeBlockMatches.length % 2 !== 0) {
				errors.push("Unclosed code block detected");
			}

			// Check for malformed links
			const malformedLinks = content.match(/\[[^\]]*\]\([^)]*$/gm);
			if (malformedLinks) {
				errors.push("Malformed links detected");
			}

			return {
				valid: errors.length === 0,
				errors,
			};
		});

	// Rendering operations (placeholder implementations)
	readonly renderToHtml = (
		content: string,
		highlightRanges?: readonly { start: number; end: number }[],
	): Effect.Effect<string, ParsingError> =>
		Effect.sync(() => {
			// Simple HTML rendering (in production, use a proper Markdown parser)
			return content
				.replace(/^# (.+)$/gm, "<h1>$1</h1>")
				.replace(/^## (.+)$/gm, "<h2>$1</h2>")
				.replace(/^### (.+)$/gm, "<h3>$1</h3>")
				.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
				.replace(/\*(.+?)\*/g, "<em>$1</em>")
				.replace(/`(.+?)`/g, "<code>$1</code>")
				.replace(/\n\n/g, "</p><p>")
				.replace(/^/, "<p>")
				.replace(/$/, "</p>");
		});

	readonly renderToPlainText = (content: string): Effect.Effect<string, ParsingError> =>
		Effect.sync(() => {
			// Strip Markdown formatting
			return content
				.replace(/^#{1,6}\s+/gm, "") // Remove heading markers
				.replace(/\*\*(.+?)\*\*/g, "$1") // Remove bold
				.replace(/\*(.+?)\*/g, "$1") // Remove italic
				.replace(/`(.+?)`/g, "$1") // Remove code spans
				.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // Remove links, keep text
				.replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1") // Remove images, keep alt text
				.trim();
		});

	// Fingerprinting operations
	readonly computeContentHash = (content: string): Effect.Effect<string, ParsingError> =>
		Effect.promise(async () => {
			const encoder = new TextEncoder();
			const data = encoder.encode(content);
			const hashBuffer = await crypto.subtle.digest("SHA-256", data);
			const hashArray = Array.from(new Uint8Array(hashBuffer));
			return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
		}).pipe(
			Effect.catchAll(error =>
				parsingError({
					_tag: "TokenizationFailed",
					reason: error instanceof Error ? error.message : "Hash computation failed",
				})
			)
		);

	readonly computeAnchorFingerprint = (
		tokens: readonly string[],
		offset: number,
		length: number,
		algorithm = "sha256" as const,
	): Effect.Effect<string, ParsingError> =>
		Effect.promise(() => computeFingerprint(tokens, offset, length, algorithm))
			.pipe(
				Effect.catchAll(error =>
					parsingError({
						_tag: "TokenizationFailed",
						reason: error instanceof Error ? error.message : "Fingerprint computation failed",
					})
				)
			);

	// Batch operations
	readonly batchChunkVersions = (
		versions: readonly { version_id: any; content: string }[],
		config: ChunkingConfig = DEFAULT_CHUNKING_CONFIG,
	): Effect.Effect<readonly (ContentChunk & { version_id: any })[], ParsingError> =>
		Effect.all(
			versions.map(({ version_id, content }) =>
				chunkContent(version_id, content, config).pipe(
					Effect.map(chunks => chunks.map(chunk => ({ ...chunk, version_id })))
				)
			),
			{ concurrency: "unbounded" }
		).pipe(
			Effect.map(chunkArrays => chunkArrays.flat()),
			Effect.catchAll(error =>
				parsingError({
					_tag: "InvalidMarkdown",
					content: "Multiple versions",
				})
			)
		);

	readonly batchResolveAnchors = (
		anchorsWithContent: readonly { anchor: Anchor; content: string }[],
		config?: TokenizationConfig,
	): Effect.Effect<readonly AnchorResolution[], ParsingError> =>
		Effect.all(
			anchorsWithContent.map(({ anchor, content }) =>
				Effect.promise(() => resolveAnchor(anchor, content, config))
			),
			{ concurrency: "unbounded" }
		).pipe(
			Effect.catchAll(error =>
				parsingError({
					_tag: "AnchorResolutionFailed",
					anchor: anchorsWithContent[0]?.anchor || {} as any,
					reason: error instanceof Error ? error.message : "Batch anchor resolution failed",
				})
			)
		);
}

/**
 * Creates a markdown parsing adapter
 */
export function createMarkdownParsingAdapter(): ParsingPort {
	return new MarkdownParsingAdapter();
}
