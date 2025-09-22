/**
 * Canonical tokenization standard for anchors.
 *
 * - Anchors preserve original casing; search pipelines may apply case-insensitive folding.
 * - Token boundaries follow Unicode UAX-29 with custom separators for `_` and `/` outside code spans.
 * - CJK segmentation prefers dictionary-based segmentation with code-point fallback.
 */
export interface TokenizationPolicy {
	readonly tokenizationVersion: string;
	readonly fingerprintAlgorithm: "BLAKE3" | "SHA-256";
	readonly casePolicy: {
		readonly anchors: "preserve";
		readonly search: "case-insensitive-allowed";
	};
	readonly segmentation: {
		readonly standard: "UAX-29";
		readonly cjkStrategy: "dictionary-first";
	};
	readonly separators: {
		readonly treatUnderscoreAsSeparator: boolean;
		readonly treatSlashAsSeparator: boolean;
		readonly ignoreInsideCodeSpans: boolean;
	};
}

export const TOKENIZATION_POLICY: TokenizationPolicy = Object.freeze({
	tokenizationVersion: "2025-09-01",
	fingerprintAlgorithm: "BLAKE3",
	casePolicy: {
		anchors: "preserve",
		search: "case-insensitive-allowed",
	},
	segmentation: {
		standard: "UAX-29",
		cjkStrategy: "dictionary-first",
	},
	separators: {
		treatUnderscoreAsSeparator: true,
		treatSlashAsSeparator: true,
		ignoreInsideCodeSpans: true,
	},
});

export interface TokenizationCapabilities {
	readonly dictionaryLocales: readonly string[];
	readonly fallbackLocale: string;
}

/**
 * Provides locales where dictionary-based segmentation can be applied.
 */
export const DEFAULT_TOKENIZATION_CAPABILITIES: TokenizationCapabilities =
	Object.freeze({
		dictionaryLocales: ["ja", "zh", "ko"],
		fallbackLocale: "und",
	});
