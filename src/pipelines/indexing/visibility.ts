/**
 * Visibility pipeline for staged index builds and atomic swaps
 * 
 * References SPEC.md Section 5: "staged build then atomic swap; search reads committed segments only"
 * Implements the two-phase commit for search visibility
 */

import { Effect, Queue, Ref, Schedule } from "effect";
import type {
	VersionId,
	Corpus,
	Index,
	CorpusId,
	IndexId,
} from "../../schema/entities";

import type {
	VisibilityEvent,
	IndexUpdateStarted,
	IndexUpdateCommitted,
	IndexUpdateFailed,
} from "../../schema/events";

import type { IndexingPort, IndexingError } from "../../services/indexing.port";
import type { ObservabilityPort } from "../../services/observability.port";
import { chunkContent, createPassagesFromChunks } from "../chunking/passage";

/**
 * Visibility pipeline error types
 */
export type VisibilityError =
	| { readonly _tag: "BuildStageFailed"; readonly reason: string; readonly version_id: VersionId }
	| { readonly _tag: "CommitStageFailed"; readonly reason: string; readonly index_id: IndexId }
	| { readonly _tag: "HealthCheckFailed"; readonly reason: string; readonly index_id: IndexId }
	| { readonly _tag: "VisibilityTimeout"; readonly version_id: VersionId; readonly elapsed_ms: number }
	| { readonly _tag: "ConcurrentUpdateConflict"; readonly version_id: VersionId };

/**
 * Visibility operation state
 */
export interface VisibilityOperation {
	readonly version_id: VersionId;
	readonly operation: "publish" | "republish" | "rollback";
	readonly collections: readonly string[];
	readonly started_at: Date;
	readonly stage: "queued" | "building" | "built" | "committing" | "committed" | "failed";
	readonly error?: string;
	readonly index_id?: IndexId;
	readonly estimated_completion?: Date;
}

/**
 * Index build result
 */
export interface IndexBuildResult {
	readonly index_id: IndexId;
	readonly corpus_id: CorpusId;
	readonly passage_count: number;
	readonly build_duration_ms: number;
	readonly health_check_passed: boolean;
}

/**
 * Visibility pipeline state
 */
interface VisibilityPipelineState {
	readonly currentCorpus?: Corpus;
	readonly currentIndex?: Index;
	readonly buildingIndex?: Index;
	readonly operations: Map<VersionId, VisibilityOperation>;
}

/**
 * Visibility pipeline implementation
 */
export class VisibilityPipeline {
	private state: Ref.Ref<VisibilityPipelineState>;
	private eventQueue: Queue.Queue<VisibilityEvent>;
	private processingQueue: Queue.Queue<VisibilityOperation>;

	constructor(
		private readonly indexing: IndexingPort,
		private readonly observability: ObservabilityPort,
	) {
		this.state = Ref.unsafeMake({
			operations: new Map(),
		});
		
		this.eventQueue = Queue.unbounded<VisibilityEvent>();
		this.processingQueue = Queue.bounded<VisibilityOperation>(100);
	}

	/**
	 * Processes a visibility event through the pipeline
	 * SPEC: "Validate → Create Version → Enqueue VisibilityEvent"
	 * 
	 * @param event - Visibility event to process
	 * @returns Effect resolving to update started event
	 */
	readonly processVisibilityEvent = (
		event: VisibilityEvent,
	): Effect.Effect<IndexUpdateStarted, VisibilityError> =>
		Effect.gen(this, function* () {
			// Create operation tracking
			const operation: VisibilityOperation = {
				version_id: event.version_id,
				operation: event.op,
				collections: event.collections,
				started_at: new Date(),
				stage: "queued",
				estimated_completion: new Date(Date.now() + 10000), // 10s estimate
			};

			// Update state
			yield* Ref.update(this.state, state => ({
				...state,
				operations: new Map(state.operations).set(event.version_id, operation),
			}));

			// Enqueue for processing
			yield* Queue.offer(this.eventQueue, event);
			yield* Queue.offer(this.processingQueue, operation);

			// Record metrics
			yield* this.observability.recordCounter("visibility.events_total", 1, {
				operation: event.op,
			});

			// Start timer for visibility latency tracking
			const timerEnd = yield* this.observability.startTimer("visibility.latency_ms", {
				operation: event.op,
				version_id: event.version_id,
			});

			// Begin async processing
			Effect.runFork(this.processOperationAsync(operation, timerEnd));

			return {
				event_id: `evt_${Date.now()}`,
				timestamp: new Date(),
				schema_version: "1.0.0",
				type: "IndexUpdateStarted",
				version_id: event.version_id,
			};
		});

	/**
	 * Asynchronous operation processing
	 * SPEC: "Indexer builds/updates segment → Commit swap → Search reflects within SLA"
	 */
	private readonly processOperationAsync = (
		operation: VisibilityOperation,
		timerEnd: () => Effect.Effect<any, any>,
	): Effect.Effect<void, VisibilityError> =>
		Effect.gen(this, function* () {
			try {
				// Stage 1: Build index segment
				yield* this.updateOperationStage(operation.version_id, "building");
				const buildResult = yield* this.buildIndexSegment(operation);

				// Stage 2: Validate index health
				yield* this.updateOperationStage(operation.version_id, "built");
				const healthCheck = yield* this.validateIndexHealth(buildResult.index_id);
				
				if (!healthCheck.healthy) {
					throw {
						_tag: "HealthCheckFailed",
						reason: "Index health validation failed",
						index_id: buildResult.index_id,
					};
				}

				// Stage 3: Atomic commit
				yield* this.updateOperationStage(operation.version_id, "committing");
				yield* this.indexing.commitIndex(buildResult.index_id);
				yield* this.updateOperationStage(operation.version_id, "committed");

				// Record successful completion
				const duration = yield* timerEnd();
				yield* this.observability.recordVisibilityLatency(
					duration.duration_ms,
					operation.version_id,
					operation.operation,
				);

				yield* this.observability.recordCounter("visibility.success_total", 1, {
					operation: operation.operation,
				});

			} catch (error) {
				// Handle failure
				yield* this.updateOperationStage(
					operation.version_id, 
					"failed", 
					error instanceof Error ? error.message : "Unknown error"
				);

				yield* this.observability.recordCounter("visibility.failures_total", 1, {
					operation: operation.operation,
					error_type: typeof error === "object" && error !== null && "_tag" in error 
						? (error as any)._tag 
						: "Unknown",
				});

				// Don't propagate error - it's handled in operation state
			}
		});

	/**
	 * Builds index segment for version
	 * SPEC: "Index health: all published Versions appear in the committed Index"
	 */
	private readonly buildIndexSegment = (
		operation: VisibilityOperation,
	): Effect.Effect<IndexBuildResult, VisibilityError> =>
		Effect.gen(this, function* () {
			const startTime = Date.now();

			// Get current corpus or create new one
			let corpus: Corpus;
			try {
				corpus = yield* this.indexing.getCurrentCorpus();
			} catch {
				// Create new corpus with this version
				corpus = yield* this.indexing.createCorpus([operation.version_id]);
			}

			// Add version to corpus if not already present
			if (!corpus.version_ids.includes(operation.version_id)) {
				corpus = yield* this.indexing.createCorpus([
					...corpus.version_ids,
					operation.version_id,
				]);
			}

			// Build index from updated corpus
			const index = yield* this.indexing.buildIndex(corpus.id);
			
			// TODO: In a real implementation, this would:
			// 1. Load version content
			// 2. Chunk into passages
			// 3. Index passages in Orama
			// 4. Validate completeness

			const buildDuration = Date.now() - startTime;

			return {
				index_id: index.id,
				corpus_id: corpus.id,
				passage_count: 0, // TODO: Calculate actual passage count
				build_duration_ms: buildDuration,
				health_check_passed: false, // Will be checked separately
			};
		}).pipe(
			Effect.catchAll(error => 
				Effect.fail({
					_tag: "BuildStageFailed",
					reason: error instanceof Error ? error.message : "Build stage failed",
					version_id: operation.version_id,
				} as VisibilityError)
			)
		);

	/**
	 * Validates index health before commit
	 * SPEC: "CommittedIndexMustContain(version_id) at commit; swap only after complete readiness"
	 */
	private readonly validateIndexHealth = (
		index_id: IndexId,
	): Effect.Effect<{ healthy: boolean; issues: readonly string[] }, VisibilityError> =>
		Effect.gen(this, function* () {
			const healthCheck = yield* this.indexing.performHealthCheck();
			
			// SPEC requirement: all published versions must be in committed index
			if (!healthCheck.healthy) {
				return {
					healthy: false,
					issues: [`Health check failed: ${healthCheck.missing_versions.length} missing versions`],
				};
			}

			// Additional validations
			const issues: string[] = [];
			
			if (healthCheck.version_coverage < 1.0) {
				issues.push(`Incomplete version coverage: ${healthCheck.version_coverage}`);
			}

			if (healthCheck.orphaned_passages.length > 0) {
				issues.push(`${healthCheck.orphaned_passages.length} orphaned passages found`);
			}

			return {
				healthy: issues.length === 0,
				issues,
			};
		}).pipe(
			Effect.catchAll(error =>
				Effect.fail({
					_tag: "HealthCheckFailed",
					reason: error instanceof Error ? error.message : "Health check failed",
					index_id,
				} as VisibilityError)
			)
		);

	/**
	 * Updates operation stage and state
	 */
	private readonly updateOperationStage = (
		version_id: VersionId,
		stage: VisibilityOperation["stage"],
		error?: string,
	): Effect.Effect<void, never> =>
		Ref.update(this.state, state => {
			const operation = state.operations.get(version_id);
			if (!operation) {
				return state;
			}

			const updatedOperation: VisibilityOperation = {
				...operation,
				stage,
				error,
			};

			return {
				...state,
				operations: new Map(state.operations).set(version_id, updatedOperation),
			};
		});

	/**
	 * Gets operation status
	 * 
	 * @param version_id - Version ID to check
	 * @returns Current operation status
	 */
	readonly getOperationStatus = (
		version_id: VersionId,
	): Effect.Effect<VisibilityOperation | null, never> =>
		Ref.get(this.state).pipe(
			Effect.map(state => state.operations.get(version_id) || null)
		);

	/**
	 * Lists all active operations
	 * 
	 * @returns Array of all tracked operations
	 */
	readonly getActiveOperations = (): Effect.Effect<readonly VisibilityOperation[], never> =>
		Ref.get(this.state).pipe(
			Effect.map(state => Array.from(state.operations.values()))
		);

	/**
	 * Retries failed operations
	 * 
	 * @param maxRetries - Maximum number of retry attempts
	 * @returns Effect resolving to retry results
	 */
	readonly retryFailedOperations = (
		maxRetries = 3,
	): Effect.Effect<{ retried_count: number; success_count: number }, VisibilityError> =>
		Effect.gen(this, function* () {
			const state = yield* Ref.get(this.state);
			const failedOperations = Array.from(state.operations.values())
				.filter(op => op.stage === "failed");

			let retriedCount = 0;
			let successCount = 0;

			for (const operation of failedOperations) {
				if (retriedCount >= maxRetries) {
					break;
				}

				// Create new visibility event for retry
				const retryEvent: VisibilityEvent = {
					event_id: `evt_retry_${Date.now()}`,
					timestamp: new Date(),
					schema_version: "1.0.0",
					type: "VisibilityEvent",
					version_id: operation.version_id,
					op: operation.operation,
					collections: operation.collections as any[],
				};

				try {
					yield* this.processVisibilityEvent(retryEvent);
					successCount++;
				} catch {
					// Retry failed, continue with next
				}

				retriedCount++;
			}

			return { retried_count: retriedCount, success_count: successCount };
		});

	/**
	 * Performs cleanup of completed operations
	 * 
	 * @param olderThan - Remove operations older than this date
	 * @returns Effect resolving to cleanup results
	 */
	readonly cleanupOperations = (
		olderThan: Date,
	): Effect.Effect<{ removed_count: number }, never> =>
		Ref.update(this.state, state => {
			const operations = new Map(state.operations);
			let removedCount = 0;

			for (const [versionId, operation] of operations) {
				if (
					operation.started_at < olderThan &&
					(operation.stage === "committed" || operation.stage === "failed")
				) {
					operations.delete(versionId);
					removedCount++;
				}
			}

			return { ...state, operations };
		}).pipe(
			Effect.as({ removed_count: 0 }) // Placeholder return
		);

	/**
	 * Gets pipeline health status
	 * 
	 * @returns Current pipeline health metrics
	 */
	readonly getPipelineHealth = (): Effect.Effect<{
		readonly healthy: boolean;
		readonly active_operations: number;
		readonly failed_operations: number;
		readonly average_processing_time_ms: number;
		readonly oldest_pending_operation?: Date;
	}, never> =>
		Ref.get(this.state).pipe(
			Effect.map(state => {
				const operations = Array.from(state.operations.values());
				const activeOps = operations.filter(op => 
					op.stage !== "committed" && op.stage !== "failed"
				).length;
				const failedOps = operations.filter(op => op.stage === "failed").length;
				
				// Calculate average processing time for completed operations
				const completedOps = operations.filter(op => op.stage === "committed");
				const avgProcessingTime = completedOps.length > 0
					? completedOps.reduce((sum, op) => {
						const now = new Date();
						return sum + (now.getTime() - op.started_at.getTime());
					}, 0) / completedOps.length
					: 0;

				// Find oldest pending operation
				const pendingOps = operations.filter(op => 
					op.stage === "queued" || op.stage === "building"
				);
				const oldestPending = pendingOps.length > 0
					? pendingOps.reduce((oldest, op) => 
						op.started_at < oldest.started_at ? op : oldest
					).started_at
					: undefined;

				return {
					healthy: failedOps === 0 && activeOps < 10, // Healthy if no failures and reasonable queue
					active_operations: activeOps,
					failed_operations: failedOps,
					average_processing_time_ms: avgProcessingTime,
					oldest_pending_operation: oldestPending,
				};
			})
		);

	/**
	 * Starts the pipeline worker
	 * 
	 * @returns Effect that runs the pipeline worker loop
	 */
	readonly startWorker = (): Effect.Effect<never, never> =>
		Effect.gen(this, function* () {
			// Process events from the queue
			yield* Effect.forever(
				Effect.gen(this, function* () {
					const operation = yield* Queue.take(this.processingQueue);
					yield* this.processOperationAsync(operation, () => Effect.succeed({ duration_ms: 0 }));
				})
			);
		}).pipe(
			Effect.catchAllCause(() => Effect.never) // Keep worker running
		);

	/**
	 * Processes operation asynchronously (same as before but with proper pipeline integration)
	 */
	private readonly processOperationAsync = (
		operation: VisibilityOperation,
		timerEnd: () => Effect.Effect<any, any>,
	): Effect.Effect<void, VisibilityError> =>
		Effect.gen(this, function* () {
			try {
				// Stage 1: Build
				yield* this.updateOperationStage(operation.version_id, "building");
				const buildResult = yield* this.buildIndexSegment(operation);

				// Stage 2: Health check
				yield* this.updateOperationStage(operation.version_id, "built");
				const healthResult = yield* this.validateIndexHealth(buildResult.index_id);
				
				if (!healthResult.healthy) {
					throw {
						_tag: "HealthCheckFailed",
						reason: healthResult.issues.join("; "),
						index_id: buildResult.index_id,
					};
				}

				// Stage 3: Atomic commit
				yield* this.updateOperationStage(operation.version_id, "committing");
				yield* this.indexing.commitIndex(buildResult.index_id);
				yield* this.updateOperationStage(operation.version_id, "committed");

				// Record success metrics
				const duration = yield* timerEnd();
				yield* this.observability.recordVisibilityLatency(
					duration.duration_ms,
					operation.version_id,
					operation.operation,
				);

			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : "Unknown error";
				yield* this.updateOperationStage(operation.version_id, "failed", errorMessage);

				yield* this.observability.recordCounter("visibility.failures_total", 1, {
					operation: operation.operation,
					error_type: typeof error === "object" && error !== null && "_tag" in error 
						? (error as any)._tag 
						: "Unknown",
				});
			}
		});

	/**
	 * Builds index segment for operation (extracted for reuse)
	 */
	private readonly buildIndexSegment = (
		operation: VisibilityOperation,
	): Effect.Effect<IndexBuildResult, VisibilityError> =>
		Effect.gen(this, function* () {
			const startTime = Date.now();

			// Get or create corpus
			let corpus: Corpus;
			try {
				corpus = yield* this.indexing.getCurrentCorpus();
				
				// Update corpus with new version
				if (!corpus.version_ids.includes(operation.version_id)) {
					corpus = yield* this.indexing.createCorpus([
						...corpus.version_ids,
						operation.version_id,
					]);
				}
			} catch {
				// Create new corpus
				corpus = yield* this.indexing.createCorpus([operation.version_id]);
			}

			// Build index
			const index = yield* this.indexing.buildIndex(corpus.id);

			const buildDuration = Date.now() - startTime;

			return {
				index_id: index.id,
				corpus_id: corpus.id,
				passage_count: 0, // TODO: Get actual count from index
				build_duration_ms: buildDuration,
				health_check_passed: false, // Will be validated separately
			};
		}).pipe(
			Effect.catchAll(error =>
				Effect.fail({
					_tag: "BuildStageFailed",
					reason: error instanceof Error ? error.message : "Build failed",
					version_id: operation.version_id,
				} as VisibilityError)
			)
		);

	/**
	 * Validates index health (extracted for reuse)
	 */
	private readonly validateIndexHealth = (
		index_id: IndexId,
	): Effect.Effect<{ healthy: boolean; issues: readonly string[] }, VisibilityError> =>
		Effect.gen(this, function* () {
			const healthCheck = yield* this.indexing.performHealthCheck();
			
			const issues: string[] = [];
			
			if (healthCheck.version_coverage < 1.0) {
				issues.push(`Incomplete version coverage: ${healthCheck.version_coverage}`);
			}

			if (healthCheck.missing_versions.length > 0) {
				issues.push(`Missing versions: ${healthCheck.missing_versions.join(", ")}`);
			}

			if (healthCheck.orphaned_passages.length > 0) {
				issues.push(`Orphaned passages: ${healthCheck.orphaned_passages.length}`);
			}

			return {
				healthy: issues.length === 0,
				issues,
			};
		}).pipe(
			Effect.catchAll(error =>
				Effect.fail({
					_tag: "HealthCheckFailed",
					reason: error instanceof Error ? error.message : "Health check failed",
					index_id,
				} as VisibilityError)
			)
		);
}

/**
 * Creates a visibility pipeline instance
 * 
 * @param indexing - Indexing port implementation
 * @param observability - Observability port implementation
 * @returns New visibility pipeline
 */
export function createVisibilityPipeline(
	indexing: IndexingPort,
	observability: ObservabilityPort,
): VisibilityPipeline {
	return new VisibilityPipeline(indexing, observability);
}

/**
 * Visibility pipeline configuration
 */
export interface VisibilityPipelineConfig {
	readonly maxConcurrentBuilds: number;
	readonly buildTimeoutMs: number;
	readonly healthCheckTimeoutMs: number;
	readonly retryDelayMs: number;
	readonly maxRetries: number;
}

/**
 * Default pipeline configuration
 */
export const DEFAULT_VISIBILITY_CONFIG: VisibilityPipelineConfig = {
	maxConcurrentBuilds: 4, // SPEC: max 4 per workspace
	buildTimeoutMs: 30000, // 30 second timeout
	healthCheckTimeoutMs: 5000, // 5 second health check timeout
	retryDelayMs: 2000, // 2 second retry delay
	maxRetries: 3, // SPEC: 3 attempts with exponential backoff
} as const;
