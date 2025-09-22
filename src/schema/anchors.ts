/**
 * Anchor and tokenization schema definitions
 *
 * References SPEC.md Section 2: Tokenization Standard (Normative)
 * Implements precise anchor model with deterministic tokenization
 */

import { Schema } from "@effect/schema";

/**
 * Tokenization version identifier for schema evolution support
 * Format: semver-like versioning (e.g., "1.0.0")
 */
export const TokenizationVersion = Schema.String.pipe(
	Schema.pattern(/^\d+\.\d+\.\d+$/),
	Schema.brand("TokenizationVersion"),
);
export type TokenizationVersion = Schema.Schema.Type<
	typeof TokenizationVersion
>;

/**
 * Fingerprint algorithm identifier
 * Supported algorithms: "sha256", "blake3"
 */
export const FingerprintAlgorithm = Schema.Literal("sha256", "blake3");
export type FingerprintAlgorithm = Schema.Schema.Type<
	typeof FingerprintAlgorithm
>;

/**
 * Structure path for stable heading-based navigation
 * Format: "/heading1/heading2/heading3" with normalized heading identifiers
 */
export const StructurePath = Schema.String.pipe(
	Schema.pattern(/^\/(?:[^/\n]+(?:\/[^/\n]*)*)?$/),
	Schema.brand("StructurePath"),
);
export type StructurePath = Schema.Schema.Type<typeof StructurePath>;

/**
 * Token offset within a normalized text block
 * 0-based index into the token sequence after normalization
 */
export const TokenOffset = Schema.Number.pipe(
	Schema.int(),
	Schema.greaterThanOrEqualTo(0),
	Schema.brand("TokenOffset"),
);
export type TokenOffset = Schema.Schema.Type<typeof TokenOffset>;

/**
 * Token length in the normalized token sequence
 * Count of tokens, must be positive
 */
export const TokenLength = Schema.Number.pipe(
	Schema.int(),
	Schema.greaterThan(0),
	Schema.brand("TokenLength"),
);
export type TokenLength = Schema.Schema.Type<typeof TokenLength>;

/**
 * Deterministic fingerprint of normalized text content
 * Hex-encoded hash for collision resistance
 */
export const Fingerprint = Schema.String.pipe(
	Schema.pattern(/^[a-f0-9]{8,}$/), // Minimum 8 chars, hex only
	Schema.brand("Fingerprint"),
);
export type Fingerprint = Schema.Schema.Type<typeof Fingerprint>;

/**
 * Core anchor schema for stable citation references
 *
 * Binds to structure_path (not file paths) for rename/move stability
 * Token offsets measured after Unicode NFC normalization
 */
export const Anchor = Schema.Struct({
	/** Stable heading trail for structural navigation */
	structure_path: StructurePath,

	/** 0-based token index in normalized content */
	token_offset: TokenOffset,

	/** Number of tokens in the span */
	token_length: TokenLength,

	/** Collision-resistant hash of the token span content */
	fingerprint: Fingerprint,

	/** Schema version for migration support */
	tokenization_version: TokenizationVersion,

	/** Hash algorithm used for fingerprint */
	fingerprint_algo: FingerprintAlgorithm,
});
export type Anchor = Schema.Schema.Type<typeof Anchor>;

/**
 * Token span within a passage for indexing
 * Simpler version of anchor without fingerprinting
 */
export const TokenSpan = Schema.Struct({
	offset: TokenOffset,
	length: TokenLength,
});
export type TokenSpan = Schema.Schema.Type<typeof TokenSpan>;

/**
 * Anchor resolution result
 * Indicates whether anchor could be resolved to current content
 */
export const AnchorResolution = Schema.Struct({
	anchor: Anchor,
	resolved: Schema.Boolean,
	/** If unresolved, the nearest token offset found */
	nearest_offset: Schema.optional(TokenOffset),
	/** Error message if resolution failed */
	error: Schema.optional(Schema.String),
});
export type AnchorResolution = Schema.Schema.Type<typeof AnchorResolution>;

/**
 * Tokenization normalization rules
 * Applied before token boundary detection
 */
export const NormalizationRules = Schema.Struct({
	/** Unicode normalization form (NFC required) */
	unicode_form: Schema.Literal("NFC"),

	/** Line ending normalization (LF required) */
	line_endings: Schema.Literal("LF"),

	/** Whitespace collapse (except in code spans/blocks) */
	collapse_whitespace: Schema.Boolean,

	/** Preserve code span/block content exactly */
	preserve_code_content: Schema.Boolean,
});
export type NormalizationRules = Schema.Schema.Type<typeof NormalizationRules>;

/**
 * Token boundary detection rules
 * Based on Unicode UAX #29 with extensions
 */
export const TokenBoundaryRules = Schema.Struct({
	/** Use Unicode word boundaries per UAX #29 */
	unicode_word_boundaries: Schema.Boolean,

	/** Treat _ and / as separators (except in code) */
	underscore_slash_separators: Schema.Boolean,

	/** Keep internal apostrophes and hyphens in words */
	preserve_internal_punctuation: Schema.Boolean,

	/** Numbers with decimals/commas as single tokens */
	decimal_number_tokens: Schema.Boolean,

	/** CJK script handling preference */
	cjk_segmentation: Schema.Literal("dictionary", "codepoint", "hybrid"),
});
export type TokenBoundaryRules = Schema.Schema.Type<typeof TokenBoundaryRules>;

/**
 * Complete tokenization configuration
 * Defines deterministic tokenization behavior
 */
export const TokenizationConfig = Schema.Struct({
	version: TokenizationVersion,
	normalization: NormalizationRules,
	boundaries: TokenBoundaryRules,
	fingerprint_algo: FingerprintAlgorithm,
});
export type TokenizationConfig = Schema.Schema.Type<typeof TokenizationConfig>;

/**
 * Standard tokenization configuration v1.0.0
 * Reference implementation matching SPEC.md requirements
 */
export const TOKENIZATION_CONFIG_V1: TokenizationConfig = {
	version: "1.0.0" as TokenizationVersion,
	normalization: {
		unicode_form: "NFC",
		line_endings: "LF",
		collapse_whitespace: true,
		preserve_code_content: true,
	},
	boundaries: {
		unicode_word_boundaries: true,
		underscore_slash_separators: true,
		preserve_internal_punctuation: true,
		decimal_number_tokens: true,
		cjk_segmentation: "hybrid",
	},
	fingerprint_algo: "sha256",
};

/**
 * Drift detection result when anchor resolution fails
 * Provides context for re-anchoring attempts
 */
export const AnchorDrift = Schema.Struct({
	original_anchor: Anchor,
	content_changed: Schema.Boolean,
	structure_changed: Schema.Boolean,
	fingerprint_mismatch: Schema.Boolean,
	suggested_reanchor: Schema.optional(Anchor),
});
export type AnchorDrift = Schema.Schema.Type<typeof AnchorDrift>;
