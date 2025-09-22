/**
 * Indexing port interface for search corpus management
 * 
 * References SPEC.md Section 4: Store ↔ Indexer contract
 * Defines abstract interface for search indexing and retrieval operations
 */

import type { Effect } from "effect";
import type {
	VersionId,
	CollectionId,
	Passage,
	Corpus,
	Index,
	CorpusId,
	IndexId,
} from "../schema/entities";

import type {
	VisibilityEvent,
	IndexUpdateStarted,
	IndexUpdateCommitted,
	IndexUpdateFailed,
} from "../schema/events";

import type {
	SearchRequest,
	SearchResponse,
} from "../schema/api";

/**
 * Indexing error types
 */
export type IndexingError =
	| { readonly _tag: "IndexingFailure"; readonly reason: string; readonly version_id: VersionId }
	| { readonly _tag: "VisibilityTimeout"; readonly version_id: VersionId }
	| { readonly _tag: "CorpusNotFound"; readonly corpus_id: CorpusId }
	| { readonly _tag: "IndexNotReady"; readonly index_id: IndexId }
	| { readonly _tag: "IndexHealthCheckFailed"; readonly reason: string }
	| { readonly _tag: "ConcurrentUpdateConflict"; readonly version_id: VersionId };

/**
 * Search result item from index
 */
export interface IndexSearchResult {
	readonly version_id: VersionId;
	readonly passage_id: string;
	readonly score: number;
	readonly snippet: string;
	readonly structure_path: string;
	readonly collection_ids: readonly CollectionId[];
}

/**
 * Index build status
 */
export interface IndexBuildStatus {
	readonly state: "Building" | "Ready" | "Swapping" | "Failed";
	readonly progress?: number; // 0.0 to 1.0
	readonly estimated_completion?: Date;
	readonly error?: string;
}

/**
 * Corpus statistics
 */
export interface CorpusStats {
	readonly version_count: number;
	readonly passage_count: number;
	readonly total_tokens: number;
	readonly collection_count: number;
	readonly last_updated: Date;
}

/**
 * Index health check result
 */
export interface IndexHealthCheck {
	readonly healthy: boolean;
	readonly version_coverage: number; // 0.0 to 1.0 - fraction of expected versions present
	readonly missing_versions: readonly VersionId[];
	readonly orphaned_passages: readonly string[];
	readonly last_checked: Date;
}

/**
 * Indexing port interface for search corpus operations
 */
export interface IndexingPort {
	// Visibility event processing
	/**
	 * Processes visibility event to update corpus/index
	 * SPEC: "transform Version changes into Corpus/Index updates and commit visibility"
	 */
	readonly processVisibilityEvent: (
		event: VisibilityEvent,
	) => Effect.Effect<IndexUpdateStarted, IndexingError>;

	/**
	 * Checks status of visibility event processing
	 */
	readonly getVisibilityEventStatus: (
		version_id: VersionId,
	) => Effect.Effect<IndexUpdateCommitted | IndexUpdateFailed | "processing", IndexingError>;

	// Corpus operations
	/**
	 * Gets current active corpus
	 */
	readonly getCurrentCorpus: () => Effect.Effect<Corpus, IndexingError>;

	/**
	 * Creates a new corpus with specified versions
	 */
	readonly createCorpus: (
		version_ids: readonly VersionId[],
	) => Effect.Effect<Corpus, IndexingError>;

	/**
	 * Gets corpus statistics
	 */
	readonly getCorpusStats: (corpus_id: CorpusId) => Effect.Effect<CorpusStats, IndexingError>;

	// Index operations
	/**
	 * Gets current active index
	 */
	readonly getCurrentIndex: () => Effect.Effect<Index, IndexingError>;

	/**
	 * Builds index from corpus
	 * SPEC: "staged build then atomic swap"
	 */
	readonly buildIndex: (corpus_id: CorpusId) => Effect.Effect<Index, IndexingError>;

	/**
	 * Gets index build status
	 */
	readonly getIndexBuildStatus: (index_id: IndexId) => Effect.Effect<IndexBuildStatus, IndexingError>;

	/**
	 * Commits index (atomic swap)
	 * SPEC: "swap only after complete readiness"
	 */
	readonly commitIndex: (index_id: IndexId) => Effect.Effect<void, IndexingError>;

	// Search operations
	/**
	 * Searches the committed index
	 * SPEC: "map Query{text, scope, filters} → Answer{text, citations[], ranked_items}"
	 */
	readonly search: (request: SearchRequest) => Effect.Effect<SearchResponse, IndexingError>;

	/**
	 * Retrieves candidate passages for query
	 * SPEC: "top_k_retrieve = 128 passages after applying collection scope and filters"
	 */
	readonly retrieveCandidates: (
		query_text: string,
		collection_ids: readonly CollectionId[],
		top_k: number,
	) => Effect.Effect<readonly IndexSearchResult[], IndexingError>;

	/**
	 * Re-ranks candidate passages
	 * SPEC: "top_k_rerank = 64 (subset of retrieved candidates)"
	 */
	readonly rerankCandidates: (
		query_text: string,
		candidates: readonly IndexSearchResult[],
		top_k: number,
	) => Effect.Effect<readonly IndexSearchResult[], IndexingError>;

	// Passage operations
	/**
	 * Gets passages for a version
	 */
	readonly getVersionPassages: (
		version_id: VersionId,
	) => Effect.Effect<readonly Passage[], IndexingError>;

	/**
	 * Resolves passage content for citation
	 */
	readonly resolvePassageContent: (
		version_id: VersionId,
		structure_path: string,
		token_offset: number,
		token_length: number,
	) => Effect.Effect<string | null, IndexingError>;

	// Health and maintenance
	/**
	 * Performs index health check
	 * SPEC: "CommittedIndexMustContain(version_id) at commit"
	 */
	readonly performHealthCheck: () => Effect.Effect<IndexHealthCheck, IndexingError>;

	/**
	 * Validates index integrity
	 */
	readonly validateIndexIntegrity: (
		expected_versions: readonly VersionId[],
	) => Effect.Effect<{ valid: boolean; issues: readonly string[] }, IndexingError>;

	/**
	 * Rebuilds index from scratch (maintenance operation)
	 */
	readonly rebuildIndex: () => Effect.Effect<Index, IndexingError>;

	/**
	 * Optimizes index (compaction, cleanup)
	 */
	readonly optimizeIndex: () => Effect.Effect<void, IndexingError>;

	// Event queue operations (for visibility pipeline)
	/**
	 * Enqueues visibility event for processing
	 * SPEC: "per-note ordering preserved; cross-note updates may be concurrent"
	 */
	readonly enqueueVisibilityEvent: (
		event: VisibilityEvent,
	) => Effect.Effect<void, IndexingError>;

	/**
	 * Gets visibility event queue status
	 */
	readonly getQueueStatus: () => Effect.Effect<{
		pending_count: number;
		processing_count: number;
		failed_count: number;
		oldest_pending?: Date;
	}, IndexingError>;

	/**
	 * Retries failed visibility events
	 */
	readonly retryFailedEvents: (
		max_retries?: number,
	) => Effect.Effect<{ retried_count: number }, IndexingError>;
}

/**
 * Indexing port identifier for dependency injection
 */
export const IndexingPort = Symbol("IndexingPort");
export type IndexingPortSymbol = typeof IndexingPort;
