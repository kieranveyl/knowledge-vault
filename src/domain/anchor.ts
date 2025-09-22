/**
 * Domain logic for anchor creation, resolution, and tokenization
 *
 * References SPEC.md Section 2: Tokenization Standard (Normative)
 * Pure functions with no side effects for deterministic anchor handling
 */

import {
  type Anchor,
  type AnchorDrift,
  type AnchorResolution,
  type Fingerprint,
  type StructurePath,
  TOKENIZATION_CONFIG_V1,
  type TokenizationConfig,
  type TokenLength,
  type TokenOffset,
} from "../schema/anchors";

/**
 * Tokenization result for text processing
 */
export interface TokenizationResult {
  readonly tokens: readonly string[];
  readonly normalizedText: string;
  readonly tokenOffsets: readonly number[]; // Character offsets in normalized text
}

/**
 * Token boundary information
 */
export interface TokenBoundary {
  readonly start: number; // Character offset
  readonly end: number; // Character offset
  readonly token: string;
}

/**
 * Text normalization according to SPEC requirements
 *
 * @param text - Raw text to normalize
 * @param preserveCodeContent - Whether to preserve code spans/blocks exactly
 * @returns Normalized text following Unicode NFC, LF line endings, whitespace collapse
 */
export function normalizeText(
  text: string,
  preserveCodeContent = true,
): string {
  // Step 1: Unicode NFC normalization
  let normalized = text.normalize("NFC");

  // Step 2: Line ending normalization (CR/CRLF -> LF)
  normalized = normalized.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // Step 3: Whitespace collapse (except in code spans/blocks)
  if (preserveCodeContent) {
  // Simple implementation: preserve content within backticks
  // More sophisticated implementation would use a proper Markdown parser
  // For now, just collapse spaces and tabs but preserve line breaks
   normalized = normalized.replace(/[ \t]+/g, " ");
  } else {
  // Collapse all runs of whitespace to single space
   normalized = normalized.replace(/\s+/g, " ");
	}

  // Step 4: Trim leading/trailing whitespace
  return normalized.trim();
}

/**
 * Extracts structure path from Markdown content
 *
 * @param content - Markdown content
 * @returns Structure path representing heading hierarchy
 */
export function extractStructurePath(content: string): StructurePath {
  const lines = content.split("\n");
  const headings: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    // Match ATX headings (# ## ### etc.)
    const match = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (match) {
      const level = match[1].length;
      const heading = match[2].trim();

      // Normalize heading for stable IDs
      const normalizedHeading = heading
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, "")
        .replace(/\s+/g, "-")
        .substring(0, 50); // Reasonable limit

      // Adjust headings array to current level
      headings.splice(level - 1);
      headings[level - 1] = normalizedHeading;
    }
  }

  return (`/${headings.filter(Boolean).join("/")}`) as StructurePath;
}

/**
 * Tokenizes text according to Unicode UAX-29 word boundaries with extensions
 *
 * @param normalizedText - Pre-normalized text
 * @param config - Tokenization configuration
 * @returns Tokenization result with tokens and offsets
 */
export function tokenizeText(
  normalizedText: string,
  config: TokenizationConfig = TOKENIZATION_CONFIG_V1,
): TokenizationResult {
  const tokens: string[] = [];
  const tokenOffsets: number[] = [];

  // Use Intl.Segmenter for Unicode-compliant word segmentation
  const segmenter = new Intl.Segmenter("en", { granularity: "word" });
  const segments = Array.from(segmenter.segment(normalizedText));

  for (const segment of segments) {
    const { segment: text, index, isWordLike } = segment;

    if (!isWordLike) {
      // Skip non-word segments (whitespace, punctuation)
      continue;
    }

    // Apply custom separator rules for _ and /
    if (config.boundaries.underscore_slash_separators && /[_/]/.test(text)) {
    const subTokens = text.split(/[_/]+/);
    let currentOffset = 0;
    for (const subToken of subTokens) {
    if (subToken.length > 0) {
    tokens.push(subToken);
    // Find the actual position of this subtoken in the original text
    const actualOffset = text.indexOf(subToken, currentOffset);
    tokenOffsets.push(index + actualOffset);
    currentOffset = actualOffset + subToken.length;
    }
    }
    } else {
    tokens.push(text);
    tokenOffsets.push(index);
    }
  }

  return {
    tokens,
    normalizedText,
    tokenOffsets,
  };
}

/**
 * Computes deterministic fingerprint for token span content
 *
 * @param tokens - Token array
 * @param offset - Starting token offset
 * @param length - Number of tokens
 * @param algorithm - Fingerprint algorithm to use
 * @returns Collision-resistant fingerprint
 */
export async function computeFingerprint(
  tokens: readonly string[],
  offset: number,
  length: number,
  algorithm: "sha256" | "blake3" = "sha256",
): Promise<Fingerprint> {
  if (offset < 0 || offset + length > tokens.length) {
    throw new Error("Token span out of bounds");
  }

  const spanContent = tokens.slice(offset, offset + length).join(" ");
  const encoder = new TextEncoder();
  const data = encoder.encode(spanContent);

  let hashBytes: ArrayBuffer;

  if (algorithm === "sha256") {
    hashBytes = await crypto.subtle.digest("SHA-256", data);
  } else {
    // For blake3, we'll use SHA-256 as fallback since blake3 isn't available in all environments
    // In a real implementation, you'd use a blake3 library
    hashBytes = await crypto.subtle.digest("SHA-256", data);
  }

  // Convert to hex string
  const hashArray = Array.from(new Uint8Array(hashBytes));
  const hashHex = hashArray
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return hashHex as Fingerprint;
}

/**
 * Creates an anchor for a specific token span in content
 *
 * @param content - Markdown content
 * @param structurePath - Heading-based structure path
 * @param tokenOffset - Starting token position
 * @param tokenLength - Number of tokens to anchor
 * @param config - Tokenization configuration
 * @returns Promise resolving to created anchor
 */
export async function createAnchor(
  content: string,
  structurePath: StructurePath,
  tokenOffset: TokenOffset,
  tokenLength: TokenLength,
  config: TokenizationConfig = TOKENIZATION_CONFIG_V1,
): Promise<Anchor> {
  const normalizedText = normalizeText(
    content,
    config.normalization.preserve_code_content,
  );
  const tokenization = tokenizeText(normalizedText, config);

  if (
    tokenOffset < 0 ||
    tokenOffset + tokenLength > tokenization.tokens.length
  ) {
    throw new Error("Token span exceeds content bounds");
  }

  const fingerprint = await computeFingerprint(
    tokenization.tokens,
    tokenOffset,
    tokenLength,
    config.fingerprint_algo,
  );

  return {
    structure_path: structurePath,
    token_offset: tokenOffset,
    token_length: tokenLength,
    fingerprint,
    tokenization_version: config.version,
    fingerprint_algo: config.fingerprint_algo,
  };
}

/**
 * Resolves an anchor against current content
 *
 * @param anchor - Anchor to resolve
 * @param content - Current content to resolve against
 * @param config - Tokenization configuration
 * @returns Promise resolving to anchor resolution result
 */
export async function resolveAnchor(
  anchor: Anchor,
  content: string,
  config: TokenizationConfig = TOKENIZATION_CONFIG_V1,
): Promise<AnchorResolution> {
  try {
    const normalizedText = normalizeText(
      content,
      config.normalization.preserve_code_content,
    );
    const tokenization = tokenizeText(normalizedText, config);

    // Check bounds
    if (
      anchor.token_offset + anchor.token_length >
      tokenization.tokens.length
    ) {
      return {
        anchor,
        resolved: false,
        error: "Token span exceeds current content bounds",
      };
    }

    // Compute current fingerprint
    const currentFingerprint = await computeFingerprint(
      tokenization.tokens,
      anchor.token_offset,
      anchor.token_length,
      anchor.fingerprint_algo,
    );

    // Check fingerprint match
    if (currentFingerprint === anchor.fingerprint) {
      return {
        anchor,
        resolved: true,
      };
    }

    // Try to find nearest match by scanning around the original offset
    const searchRadius = Math.min(
      10,
      tokenization.tokens.length - anchor.token_length,
    );
    for (let delta = 1; delta <= searchRadius; delta++) {
      // Try offsets before and after the original position
      for (const offset of [
        anchor.token_offset - delta,
        anchor.token_offset + delta,
      ]) {
        if (
          offset >= 0 &&
          offset + anchor.token_length <= tokenization.tokens.length
        ) {
          const nearbyFingerprint = await computeFingerprint(
            tokenization.tokens,
            offset,
            anchor.token_length,
            anchor.fingerprint_algo,
          );

          if (nearbyFingerprint === anchor.fingerprint) {
            return {
              anchor,
              resolved: true,
              nearest_offset: offset as TokenOffset,
            };
          }
        }
      }
    }

    return {
      anchor,
      resolved: false,
      nearest_offset: anchor.token_offset,
      error: "Fingerprint mismatch - content has changed",
    };
  } catch (error) {
    return {
      anchor,
      resolved: false,
      error:
        error instanceof Error ? error.message : "Unknown resolution error",
    };
  }
}

/**
 * Detects anchor drift between versions
 *
 * @param originalAnchor - Original anchor
 * @param currentContent - Current content
 * @param config - Tokenization configuration
 * @returns Promise resolving to drift detection result
 */
export async function detectAnchorDrift(
  originalAnchor: Anchor,
  currentContent: string,
  config: TokenizationConfig = TOKENIZATION_CONFIG_V1,
): Promise<AnchorDrift> {
  const resolution = await resolveAnchor(
    originalAnchor,
    currentContent,
    config,
  );

  if (resolution.resolved && !resolution.nearest_offset) {
    // No drift - exact match
    return {
      original_anchor: originalAnchor,
      content_changed: false,
      structure_changed: false,
      fingerprint_mismatch: false,
    };
  }

  const currentStructurePath = extractStructurePath(currentContent);
  const structureChanged =
    currentStructurePath !== originalAnchor.structure_path;

  let suggestedReanchor: Anchor | undefined;

  if (resolution.nearest_offset !== undefined) {
    // Try to create a re-anchored version
    try {
      suggestedReanchor = await createAnchor(
        currentContent,
        currentStructurePath,
        resolution.nearest_offset,
        originalAnchor.token_length,
        config,
      );
    } catch {
      // Re-anchoring failed
    }
  }

  return {
    original_anchor: originalAnchor,
    content_changed: true,
    structure_changed: structureChanged,
    fingerprint_mismatch: !resolution.resolved,
    suggested_reanchor: suggestedReanchor,
  };
}

/**
 * Extracts text content for a resolved anchor
 *
 * @param anchor - Resolved anchor
 * @param content - Content to extract from
 * @param config - Tokenization configuration
 * @returns Extracted text snippet or null if anchor cannot be resolved
 */
export async function extractAnchorContent(
  anchor: Anchor,
  content: string,
  config: TokenizationConfig = TOKENIZATION_CONFIG_V1,
): Promise<string | null> {
  const resolution = await resolveAnchor(anchor, content, config);

  if (!resolution.resolved) {
    return null;
  }

  const normalizedText = normalizeText(
    content,
    config.normalization.preserve_code_content,
  );
  const tokenization = tokenizeText(normalizedText, config);

  const effectiveOffset = resolution.nearest_offset ?? anchor.token_offset;
  const tokens = tokenization.tokens.slice(
    effectiveOffset,
    effectiveOffset + anchor.token_length,
  );

  return tokens.join(" ");
}
