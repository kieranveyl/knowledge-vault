/**
 * Parsing port interface for Markdown processing and tokenization
 * 
 * References SPEC.md Section 2: Tokenization Standard (Normative)
 * Defines abstract interface for content parsing and anchor operations
 */

import type { Effect } from "effect";
import type {
	Anchor,
	TokenSpan,
	AnchorResolution,
	AnchorDrift,
	TokenizationConfig,
	StructurePath,
	TokenOffset,
	TokenLength,
} from "../schema/anchors";

import type { TokenizationResult } from "../domain/anchor";

/**
 * Parsing error types
 */
export type ParsingError =
	| { readonly _tag: "InvalidMarkdown"; readonly content: string; readonly position?: number }
	| { readonly _tag: "TokenizationFailed"; readonly reason: string }
	| { readonly _tag: "AnchorResolutionFailed"; readonly anchor: Anchor; readonly reason: string }
	| { readonly _tag: "StructureExtractionFailed"; readonly content: string }
	| { readonly _tag: "InvalidTokenSpan"; readonly offset: number; readonly length: number };

/**
 * Markdown structure information
 */
export interface MarkdownStructure {
	readonly headings: readonly {
		readonly level: number;
		readonly text: string;
		readonly normalized_id: string;
		readonly char_offset: number;
	}[];
	readonly code_blocks: readonly {
		readonly language?: string;
		readonly char_start: number;
		readonly char_end: number;
	}[];
	readonly links: readonly {
		readonly text: string;
		readonly url: string;
		readonly char_offset: number;
	}[];
	readonly images: readonly {
		readonly alt_text: string;
		readonly url: string;
		readonly char_offset: number;
	}[];
}

/**
 * Content chunk for indexing
 */
export interface ContentChunk {
	readonly structure_path: StructurePath;
	readonly content: string;
	readonly token_span: TokenSpan;
	readonly snippet: string;
	readonly char_offset: number;
	readonly char_length: number;
}

/**
 * Passage chunking configuration
 */
export interface ChunkingConfig {
	readonly max_tokens_per_chunk: number; // SPEC: max 180 tokens per passage
	readonly overlap_tokens: number; // SPEC: 50% overlap (stride 90 tokens)
	readonly max_note_tokens: number; // SPEC: max 20k tokens indexed
	readonly preserve_structure_boundaries: boolean;
}

/**
 * Default chunking configuration from SPEC
 */
export const DEFAULT_CHUNKING_CONFIG: ChunkingConfig = {
	max_tokens_per_chunk: 180,
	overlap_tokens: 90, // 50% overlap
	max_note_tokens: 20000,
	preserve_structure_boundaries: true,
} as const;

/**
 * Parsing port interface for content processing operations
 */
export interface ParsingPort {
	// Content normalization and tokenization
	/**
	 * Normalizes content according to tokenization standard
	 * SPEC: "Unicode NFC; line endings → LF; collapse whitespace"
	 */
	readonly normalizeContent: (
		content: string,
		preserve_code_content?: boolean,
	) => Effect.Effect<string, ParsingError>;

	/**
	 * Tokenizes normalized content
	 * SPEC: "Unicode word boundaries per UAX #29"
	 */
	readonly tokenizeContent: (
		content: string,
		config?: TokenizationConfig,
	) => Effect.Effect<TokenizationResult, ParsingError>;

	// Structure extraction
	/**
	 * Extracts Markdown structure (headings, code blocks, etc.)
	 */
	readonly extractMarkdownStructure: (
		content: string,
	) => Effect.Effect<MarkdownStructure, ParsingError>;

	/**
	 * Extracts structure path from content
	 * SPEC: "structure_path derives from the heading trail"
	 */
	readonly extractStructurePath: (
		content: string,
		target_char_offset?: number,
	) => Effect.Effect<StructurePath, ParsingError>;

	// Content chunking for indexing
	/**
	 * Splits content into indexable chunks
	 * SPEC: "max 180 tokens per passage; 50% overlap; retain structure_path boundaries"
	 */
	readonly chunkContent: (
		content: string,
		config?: ChunkingConfig,
	) => Effect.Effect<readonly ContentChunk[], ParsingError>;

	/**
	 * Validates chunking configuration
	 */
	readonly validateChunkingConfig: (
		config: ChunkingConfig,
	) => Effect.Effect<{ valid: boolean; errors: readonly string[] }, ParsingError>;

	// Anchor operations
	/**
	 * Creates anchor for specific token span
	 * SPEC: "deterministic, collision-resistant hash over normalized text"
	 */
	readonly createAnchor: (
		content: string,
		structure_path: StructurePath,
		token_offset: TokenOffset,
		token_length: TokenLength,
		config?: TokenizationConfig,
	) => Effect.Effect<Anchor, ParsingError>;

	/**
	 * Resolves anchor against current content
	 * SPEC: "fingerprint mismatch → attempt re-anchoring via structure_path"
	 */
	readonly resolveAnchor: (
		anchor: Anchor,
		content: string,
		config?: TokenizationConfig,
	) => Effect.Effect<AnchorResolution, ParsingError>;

	/**
	 * Detects anchor drift between versions
	 */
	readonly detectAnchorDrift: (
		original_anchor: Anchor,
		current_content: string,
		config?: TokenizationConfig,
	) => Effect.Effect<AnchorDrift, ParsingError>;

	/**
	 * Extracts text content for resolved anchor
	 */
	readonly extractAnchorContent: (
		anchor: Anchor,
		content: string,
		config?: TokenizationConfig,
	) => Effect.Effect<string | null, ParsingError>;

	// Content analysis
	/**
	 * Analyzes content for validation and metrics
	 */
	readonly analyzeContent: (
		content: string,
	) => Effect.Effect<{
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
	}, ParsingError>;

	/**
	 * Validates Markdown syntax
	 */
	readonly validateMarkdown: (
		content: string,
	) => Effect.Effect<{ valid: boolean; errors: readonly string[] }, ParsingError>;

	// Rendering operations
	/**
	 * Renders Markdown to HTML for reading view
	 */
	readonly renderToHtml: (
		content: string,
		highlight_ranges?: readonly { start: number; end: number }[],
	) => Effect.Effect<string, ParsingError>;

	/**
	 * Renders Markdown to plain text
	 */
	readonly renderToPlainText: (content: string) => Effect.Effect<string, ParsingError>;

	// Fingerprinting operations
	/**
	 * Computes content fingerprint for version integrity
	 */
	readonly computeContentHash: (content: string) => Effect.Effect<string, ParsingError>;

	/**
	 * Computes anchor fingerprint for citation stability
	 */
	readonly computeAnchorFingerprint: (
		tokens: readonly string[],
		offset: number,
		length: number,
		algorithm?: "sha256" | "blake3",
	) => Effect.Effect<string, ParsingError>;

	// Batch operations for performance
	/**
	 * Processes multiple versions for indexing
	 */
	readonly batchChunkVersions: (
		versions: readonly { version_id: VersionId; content: string }[],
		config?: ChunkingConfig,
	) => Effect.Effect<readonly (ContentChunk & { version_id: VersionId })[], ParsingError>;

	/**
	 * Batch resolves multiple anchors
	 */
	readonly batchResolveAnchors: (
		anchors_with_content: readonly { anchor: Anchor; content: string }[],
		config?: TokenizationConfig,
	) => Effect.Effect<readonly AnchorResolution[], ParsingError>;
}

/**
 * Parsing port identifier for dependency injection
 */
export const ParsingPort = Symbol("ParsingPort");
export type ParsingPortSymbol = typeof ParsingPort;
