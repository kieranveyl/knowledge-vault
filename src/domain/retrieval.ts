/**
 * Domain logic for search result retrieval, ranking, and deduplication
 *
 * References SPEC.md Section 5: Retrieval Defaults (Deterministic)
 * Pure functions for deterministic search result processing
 */

import type { NoteId, PassageId, VersionId } from "../schema/entities";

/**
 * Search result item with scoring information
 */
export interface SearchResultItem {
  readonly note_id: NoteId;
  readonly version_id: VersionId;
  readonly passage_id: PassageId;
  readonly score: number; // 0.0 to 1.0
  readonly snippet: string;
  readonly structure_path: string;
  readonly collection_ids: readonly string[];
}

/**
 * Deduplication key for search results
 */
export interface DeduplicationKey {
  readonly note_id: NoteId;
  readonly version_id: VersionId;
}

/**
 * Retrieval configuration for deterministic processing
 */
export interface RetrievalConfig {
  readonly topKRetrieve: number;
  readonly topKRerank: number;
  readonly pageSize: number;
  readonly maxPageSize: number;
  readonly deterministic: boolean;
}

/**
 * Pagination parameters
 */
export interface PaginationParams {
  readonly page: number;
  readonly pageSize: number;
}

/**
 * Paginated result set
 */
export interface PaginatedResults<T> {
  readonly items: readonly T[];
  readonly page: number;
  readonly pageSize: number;
  readonly totalCount: number;
  readonly hasMore: boolean;
}

/**
 * Default retrieval configuration matching SPEC.md
 */
export const DEFAULT_RETRIEVAL_CONFIG: RetrievalConfig = {
  topKRetrieve: 128,
  topKRerank: 64,
  pageSize: 10,
  maxPageSize: 50,
  deterministic: true,
} as const;

/**
 * Creates a deduplication key from a search result item
 *
 * @param item - Search result item
 * @returns Deduplication key
 */
export function createDeduplicationKey(
  item: SearchResultItem,
): DeduplicationKey {
  return {
    note_id: item.note_id,
    version_id: item.version_id,
  };
}

/**
 * Serializes a deduplication key for comparison
 *
 * @param key - Deduplication key
 * @returns String representation for comparison
 */
export function serializeDeduplicationKey(key: DeduplicationKey): string {
  return `${key.note_id}:${key.version_id}`;
}

/**
 * Deduplicates search results by (Note, Version) keeping highest-ranked passage
 *
 * @param results - Array of search results
 * @returns Deduplicated results with highest score per (note_id, version_id)
 */
export function deduplicateResults(
  results: readonly SearchResultItem[],
): SearchResultItem[] {
  const deduplicationMap = new Map<string, SearchResultItem>();

  for (const item of results) {
    const key = serializeDeduplicationKey(createDeduplicationKey(item));
    const existing = deduplicationMap.get(key);

    if (!existing || item.score > existing.score) {
      deduplicationMap.set(key, item);
    }
  }

  return Array.from(deduplicationMap.values());
}

/**
 * Stable comparator for search result deterministic ordering
 *
 * Tie-breaking order: score desc → version_id asc → passage_id asc
 *
 * @param a - First search result
 * @param b - Second search result
 * @returns Comparison result (-1, 0, 1)
 */
export function compareSearchResults(
  a: SearchResultItem,
  b: SearchResultItem,
): number {
  // Primary sort: score descending (higher scores first)
  if (a.score !== b.score) {
    return b.score - a.score;
  }

  // Secondary sort: version_id ascending (stable identifier)
  if (a.version_id !== b.version_id) {
    return a.version_id.localeCompare(b.version_id);
  }

  // Tertiary sort: passage_id ascending (stable identifier)
  return a.passage_id.localeCompare(b.passage_id);
}

/**
 * Sorts search results with deterministic tie-breaking
 *
 * @param results - Array of search results to sort
 * @returns Sorted array (new array, original unchanged)
 */
export function sortSearchResults(
  results: readonly SearchResultItem[],
): SearchResultItem[] {
  return [...results].sort(compareSearchResults);
}

/**
 * Processes raw search results with deduplication and stable sorting
 *
 * @param rawResults - Raw search results from retrieval
 * @param config - Retrieval configuration
 * @returns Processed and sorted results
 */
export function processSearchResults(
  rawResults: readonly SearchResultItem[],
  config: RetrievalConfig = DEFAULT_RETRIEVAL_CONFIG,
): SearchResultItem[] {
  // Step 1: Deduplicate by (note_id, version_id)
  const deduplicated = deduplicateResults(rawResults);

  // Step 2: Sort with deterministic tie-breaking
  const sorted = sortSearchResults(deduplicated);

  // Step 3: Apply top-k rerank limit if configured
  const topK = Math.min(sorted.length, config.topKRerank);

  return sorted.slice(0, topK);
}

/**
 * Paginates search results
 *
 * @param results - Sorted search results
 * @param pagination - Pagination parameters
 * @param config - Retrieval configuration for limits
 * @returns Paginated result set
 */
export function paginateResults<T>(
  results: readonly T[],
  pagination: PaginationParams,
  config: RetrievalConfig = DEFAULT_RETRIEVAL_CONFIG,
): PaginatedResults<T> {
  const { page, pageSize } = pagination;

  // Validate and clamp page size
  const effectivePageSize = Math.min(Math.max(1, pageSize), config.maxPageSize);

  // Calculate pagination bounds
  const startIndex = page * effectivePageSize;
  const endIndex = startIndex + effectivePageSize;

  // Extract page items
  const items = results.slice(startIndex, endIndex);

  return {
    items,
    page,
    pageSize: effectivePageSize,
    totalCount: results.length,
    hasMore: endIndex < results.length,
  };
}

/**
 * Validates retrieval configuration
 *
 * @param config - Configuration to validate
 * @returns Array of validation errors (empty if valid)
 */
export function validateRetrievalConfig(
  config: Partial<RetrievalConfig>,
): string[] {
  const errors: string[] = [];

  if (config.topKRetrieve !== undefined) {
    if (config.topKRetrieve < 1 || config.topKRetrieve > 1000) {
      errors.push("topKRetrieve must be between 1 and 1000");
    }
  }

  if (config.topKRerank !== undefined) {
    if (config.topKRerank < 1 || config.topKRerank > 500) {
      errors.push("topKRerank must be between 1 and 500");
    }
  }

  if (config.pageSize !== undefined) {
    if (config.pageSize < 1 || config.pageSize > 50) {
      errors.push("pageSize must be between 1 and 50");
    }
  }

  if (config.maxPageSize !== undefined) {
    if (config.maxPageSize < 1 || config.maxPageSize > 100) {
      errors.push("maxPageSize must be between 1 and 100");
    }
  }

  // Cross-validation: topKRerank should not exceed topKRetrieve
  if (
    config.topKRetrieve !== undefined &&
    config.topKRerank !== undefined &&
    config.topKRerank > config.topKRetrieve
  ) {
    errors.push("topKRerank cannot exceed topKRetrieve");
  }

  return errors;
}

/**
 * Creates a retrieval configuration with validation
 *
 * @param overrides - Configuration overrides
 * @param base - Base configuration (defaults to DEFAULT_RETRIEVAL_CONFIG)
 * @returns Validated retrieval configuration
 * @throws Error if configuration is invalid
 */
export function createRetrievalConfig(
  overrides: Partial<RetrievalConfig> = {},
  base: RetrievalConfig = DEFAULT_RETRIEVAL_CONFIG,
): RetrievalConfig {
  const merged = {
    ...base,
    ...overrides,
  };

  const errors = validateRetrievalConfig(merged);
  if (errors.length > 0) {
    throw new Error(`Invalid retrieval configuration: ${errors.join(", ")}`);
  }

  // Determine if configuration maintains deterministic ordering
  const deterministic =
    merged.topKRetrieve === DEFAULT_RETRIEVAL_CONFIG.topKRetrieve &&
    merged.topKRerank === DEFAULT_RETRIEVAL_CONFIG.topKRerank &&
    merged.pageSize === DEFAULT_RETRIEVAL_CONFIG.pageSize;

  return {
    ...merged,
    deterministic,
  };
}

/**
 * SLO backoff logic for rerank reduction under high latency
 *
 * @param p95LatencyMs - Current P95 search latency in milliseconds
 * @param config - Current retrieval configuration
 * @param thresholdMs - Latency threshold for backoff (default 500ms)
 * @returns Adjusted topKRerank value
 */
export function applySloBackoff(
  p95LatencyMs: number,
  config: RetrievalConfig = DEFAULT_RETRIEVAL_CONFIG,
  thresholdMs = 500,
): number {
  if (p95LatencyMs > thresholdMs) {
    // Reduce rerank window to 32 when SLO is breached
    return Math.min(32, config.topKRerank);
  }

  return config.topKRerank;
}

/**
 * Scores the diversity of search results across collections
 *
 * @param results - Search results to analyze
 * @returns Diversity score from 0.0 (all same collection) to 1.0 (maximum diversity)
 */
export function calculateResultDiversity(
  results: readonly SearchResultItem[],
): number {
  if (results.length === 0) {
    return 0.0;
  }

  // Count unique collections represented
  const allCollections = new Set<string>();
  for (const result of results) {
    for (const collectionId of result.collection_ids) {
      allCollections.add(collectionId);
    }
  }

  // Calculate entropy-based diversity score
  const collectionCounts = new Map<string, number>();
  let totalCount = 0;

  for (const result of results) {
    for (const collectionId of result.collection_ids) {
      collectionCounts.set(
        collectionId,
        (collectionCounts.get(collectionId) || 0) + 1,
      );
      totalCount++;
    }
  }

  if (allCollections.size <= 1) {
    return 0.0; // No diversity
  }

  // Calculate Shannon entropy
  let entropy = 0.0;
  for (const count of collectionCounts.values()) {
    const probability = count / totalCount;
    entropy -= probability * Math.log2(probability);
  }

  // Normalize by maximum possible entropy
  const maxEntropy = Math.log2(allCollections.size);
  return maxEntropy > 0 ? entropy / maxEntropy : 0.0;
}

/**
 * Filters search results to ensure minimum citation coverage
 *
 * @param results - Search results to filter
 * @param minCitationCoverage - Minimum fraction of results that must be citable (0.0-1.0)
 * @returns Filtered results that meet citation requirements
 */
export function filterForCitationCoverage(
  results: readonly SearchResultItem[],
  minCitationCoverage = 0.8,
): SearchResultItem[] {
  if (results.length === 0) {
    return [];
  }

  const minCitableResults = Math.ceil(results.length * minCitationCoverage);

  // Simple implementation: assume all results with score > 0.3 are citable
  // In practice, this would check anchor resolution and content availability
  const citableResults = results.filter((result) => result.score > 0.3);

  if (citableResults.length >= minCitableResults) {
    return [...results]; // All results are acceptable
  }

  // Return only the citable results if we don't meet coverage threshold
  return [...citableResults];
}
