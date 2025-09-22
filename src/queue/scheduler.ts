/**
 * Operation queue scheduler for visibility pipeline
 *
 * References SPEC.md Section 7: "fairness = FIFO per note and fair-share across notes;
 * max in-flight visibility updates = 1 per note, 4 per workspace; starvation avoidance via aging"
 */

import { Duration, Effect, Fiber, Ref } from "effect";
import type { NoteId } from "../schema/entities";
import type { VisibilityEvent } from "../schema/events";

/**
 * Queue operation types
 */
export type QueueOperation =
  | { readonly type: "visibility"; readonly event: VisibilityEvent }
  | {
      readonly type: "maintenance";
      readonly task: () => Effect.Effect<void, never>;
    }
  | { readonly type: "health_check"; readonly component: string };

/**
 * Queue item with metadata
 */
export interface QueueItem {
  readonly id: string;
  readonly operation: QueueOperation;
  readonly note_id: NoteId;
  readonly priority: number; // Higher values = higher priority
  readonly submitted_at: Date;
  readonly retries: number;
  readonly max_retries: number;
}

/**
 * Queue configuration
 */
export interface QueueConfig {
  readonly maxInFlightPerNote: number; // SPEC: 1 per note
  readonly maxInFlightPerWorkspace: number; // SPEC: 4 per workspace
  readonly agingIntervalMs: number; // How often to boost priority of waiting items
  readonly agingBoostAmount: number; // How much to boost priority
  readonly maxQueueSize: number; // Maximum queued items
  readonly processingTimeoutMs: number; // Timeout for individual operations
}

/**
 * Default queue configuration per SPEC
 */
export const DEFAULT_QUEUE_CONFIG: QueueConfig = {
  maxInFlightPerNote: 1,
  maxInFlightPerWorkspace: 4,
  agingIntervalMs: 5000, // 5 seconds
  agingBoostAmount: 10, // Boost priority by 10
  maxQueueSize: 1000,
  processingTimeoutMs: 30000, // 30 seconds
} as const;

/**
 * In-flight operation tracking
 */
interface InFlightOperation {
  readonly item: QueueItem;
  readonly started_at: Date;
  readonly fiber: Fiber.Fiber<void, unknown>;
}

/**
 * Queue scheduler state
 */
interface SchedulerState {
  readonly pendingQueues: Map<NoteId, QueueItem[]>; // FIFO queue per note
  readonly inFlightOperations: Map<string, InFlightOperation>; // By operation ID
  readonly inFlightByNote: Map<NoteId, Set<string>>; // Track in-flight ops per note
  readonly totalInFlight: number;
  readonly nextPriorityBoost: Date;
}

/**
 * Scheduler error types
 */
export type SchedulerError =
  | { readonly _tag: "QueueFull"; readonly maxSize: number }
  | { readonly _tag: "OperationTimeout"; readonly operationId: string }
  | {
      readonly _tag: "ProcessingFailed";
      readonly operationId: string;
      readonly reason: string;
    }
  | { readonly _tag: "ConfigurationError"; readonly reason: string };

/**
 * Operation queue scheduler implementation
 */
export class OperationScheduler {
  private state: Ref.Ref<SchedulerState>;
  private config: QueueConfig;
  private isRunning: Ref.Ref<boolean>;

  constructor(
    config: QueueConfig = DEFAULT_QUEUE_CONFIG,
    private readonly processor: (
      operation: QueueOperation,
    ) => Effect.Effect<void, unknown>,
  ) {
    this.config = config;
    this.state = Ref.unsafeMake({
      pendingQueues: new Map(),
      inFlightOperations: new Map(),
      inFlightByNote: new Map(),
      totalInFlight: 0,
      nextPriorityBoost: new Date(Date.now() + config.agingIntervalMs),
    });
    this.isRunning = Ref.unsafeMake(false);
  }

  /**
   * Submits operation to the queue
   * SPEC: "FIFO per note and fair-share across notes"
   *
   * @param operation - Operation to queue
   * @param noteId - Note ID for operation grouping
   * @param priority - Initial priority (default 100)
   * @param maxRetries - Maximum retry attempts (default 3)
   * @returns Effect resolving to queued item ID
   */
  readonly submitOperation = (
    operation: QueueOperation,
    noteId: NoteId,
    priority = 100,
    maxRetries = 3,
  ): Effect.Effect<string, SchedulerError> =>
    Effect.gen(this, function* () {
      const state = yield* Ref.get(this.state);

      // Check queue capacity
      const totalQueued = Array.from(state.pendingQueues.values()).reduce(
        (sum, queue) => sum + queue.length,
        0,
      );

      if (totalQueued >= this.config.maxQueueSize) {
        yield* Effect.fail({
          _tag: "QueueFull",
          maxSize: this.config.maxQueueSize,
        } as SchedulerError);
      }

      // Create queue item
      const item: QueueItem = {
        id: `qitem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        operation,
        note_id: noteId,
        priority,
        submitted_at: new Date(),
        retries: 0,
        max_retries: maxRetries,
      };

      // Add to note-specific queue (FIFO per note)
      yield* Ref.update(this.state, (currentState) => {
        const noteQueue = currentState.pendingQueues.get(noteId) || [];
        const updatedQueues = new Map(currentState.pendingQueues);
        updatedQueues.set(noteId, [...noteQueue, item]);

        return {
          ...currentState,
          pendingQueues: updatedQueues,
        };
      });

      return item.id;
    });

  /**
   * Starts the scheduler worker
   * SPEC: "fair-share across notes"
   *
   * @returns Effect that runs the scheduler loop
   */
  readonly start = (): Effect.Effect<never, never> =>
    Effect.gen(this, function* () {
      yield* Ref.set(this.isRunning, true);

      // Start aging worker
      const agingFiber = yield* Effect.fork(this.runAgingWorker());

      // Main scheduling loop
      yield* Effect.forever(
        Effect.gen(this, function* () {
          yield* Effect.sleep(Duration.millis(100)); // Small delay between cycles

          const canProcess = yield* this.checkCanProcessMore();
          if (!canProcess) {
            return; // Wait for in-flight operations to complete
          }

          const nextItem = yield* this.selectNextItem();
          if (!nextItem) {
            return; // No items to process
          }

          // Start processing
          yield* this.startProcessing(nextItem);
        }),
      );
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          Ref.unsafeSet(this.isRunning, false);
        }),
      ),
    );

  /**
   * Stops the scheduler
   */
  readonly stop = (): Effect.Effect<void, never> =>
    Effect.gen(this, function* () {
      yield* Ref.set(this.isRunning, false);

      // Cancel all in-flight operations
      const state = yield* Ref.get(this.state);
      for (const inFlight of state.inFlightOperations.values()) {
        yield* Fiber.interrupt(inFlight.fiber);
      }

      // Clear state
      yield* Ref.set(this.state, {
        pendingQueues: new Map(),
        inFlightOperations: new Map(),
        inFlightByNote: new Map(),
        totalInFlight: 0,
        nextPriorityBoost: new Date(),
      });
    });

  /**
   * Checks if more operations can be processed
   * SPEC: "max in-flight visibility updates = 1 per note, 4 per workspace"
   */
  private readonly checkCanProcessMore = (): Effect.Effect<boolean, never> =>
    Ref.get(this.state).pipe(
      Effect.map(
        (state) => state.totalInFlight < this.config.maxInFlightPerWorkspace,
      ),
    );

  /**
   * Selects next item using fair-share algorithm
   * SPEC: "fair-share across notes"
   */
  private readonly selectNextItem = (): Effect.Effect<
    QueueItem | null,
    never
  > =>
    Effect.gen(this, function* () {
      const state = yield* Ref.get(this.state);

      // Find notes with pending operations that aren't at their in-flight limit
      const eligibleNotes: NoteId[] = [];

      for (const [noteId, queue] of state.pendingQueues) {
        if (queue.length === 0) continue;

        const noteInFlight = state.inFlightByNote.get(noteId)?.size || 0;
        if (noteInFlight < this.config.maxInFlightPerNote) {
          eligibleNotes.push(noteId);
        }
      }

      if (eligibleNotes.length === 0) {
        return null;
      }

      // Fair-share: round-robin between eligible notes
      // Sort by note ID for deterministic ordering
      eligibleNotes.sort();

      // Find note with highest priority item
      let bestNote: NoteId | null = null;
      let bestPriority = -Infinity;

      for (const noteId of eligibleNotes) {
        const queue = state.pendingQueues.get(noteId)!;
        const highestPriorityItem = queue.reduce((best, item) =>
          item.priority > best.priority ? item : best,
        );

        if (highestPriorityItem.priority > bestPriority) {
          bestPriority = highestPriorityItem.priority;
          bestNote = noteId;
        }
      }

      if (!bestNote) {
        return null;
      }

      // Remove item from queue and return it
      let selectedItem: QueueItem | null = null;

      yield* Ref.update(this.state, (currentState) => {
        const noteQueue = currentState.pendingQueues.get(bestNote!) || [];
        const itemIndex = noteQueue.findIndex(
          (item) => item.priority === bestPriority,
        );

        if (itemIndex !== -1) {
          selectedItem = noteQueue[itemIndex];
          const updatedQueue = [...noteQueue];
          updatedQueue.splice(itemIndex, 1);

          const updatedQueues = new Map(currentState.pendingQueues);
          if (updatedQueue.length === 0) {
            updatedQueues.delete(bestNote!);
          } else {
            updatedQueues.set(bestNote!, updatedQueue);
          }

          return {
            ...currentState,
            pendingQueues: updatedQueues,
          };
        }

        return currentState;
      });

      return selectedItem;
    });

  /**
   * Starts processing an operation
   */
  private readonly startProcessing = (
    item: QueueItem,
  ): Effect.Effect<void, never> =>
    Effect.gen(this, function* () {
      // Create processing fiber
      const processingFiber = yield* Effect.fork(
        Effect.gen(this, function* () {
          yield* this.processor(item.operation);
        }).pipe(
          Effect.timeout(Duration.millis(this.config.processingTimeoutMs)),
          Effect.catchAll((error) =>
            Effect.sync(() => {
              console.error(`Operation ${item.id} failed:`, error);
            }),
          ),
          Effect.ensuring(this.markOperationComplete(item.id)),
        ),
      );

      // Track in-flight operation
      const inFlightOp: InFlightOperation = {
        item,
        started_at: new Date(),
        fiber: processingFiber,
      };

      yield* Ref.update(this.state, (state) => {
        const inFlightOps = new Map(state.inFlightOperations);
        inFlightOps.set(item.id, inFlightOp);

        const inFlightByNote = new Map(state.inFlightByNote);
        const noteSet = inFlightByNote.get(item.note_id) || new Set();
        noteSet.add(item.id);
        inFlightByNote.set(item.note_id, noteSet);

        return {
          ...state,
          inFlightOperations: inFlightOps,
          inFlightByNote,
          totalInFlight: state.totalInFlight + 1,
        };
      });
    });

  /**
   * Marks operation as complete and cleans up tracking
   */
  private readonly markOperationComplete = (
    operationId: string,
  ): Effect.Effect<void, never> =>
    Ref.update(this.state, (state) => {
      const inFlightOp = state.inFlightOperations.get(operationId);
      if (!inFlightOp) {
        return state;
      }

      const inFlightOps = new Map(state.inFlightOperations);
      inFlightOps.delete(operationId);

      const inFlightByNote = new Map(state.inFlightByNote);
      const noteSet = inFlightByNote.get(inFlightOp.item.note_id);
      if (noteSet) {
        const updatedSet = new Set(noteSet);
        updatedSet.delete(operationId);

        if (updatedSet.size === 0) {
          inFlightByNote.delete(inFlightOp.item.note_id);
        } else {
          inFlightByNote.set(inFlightOp.item.note_id, updatedSet);
        }
      }

      return {
        ...state,
        inFlightOperations: inFlightOps,
        inFlightByNote,
        totalInFlight: state.totalInFlight - 1,
      };
    });

  /**
   * Aging worker for starvation avoidance
   * SPEC: "starvation avoidance via aging (long-waiting items gain priority)"
   */
  private readonly runAgingWorker = (): Effect.Effect<never, never> =>
    Effect.gen(this, function* () {
      yield* Effect.forever(
        Effect.gen(this, function* () {
          yield* Effect.sleep(Duration.millis(this.config.agingIntervalMs));

          const state = yield* Ref.get(this.state);
          const now = new Date();

          // Check if it's time to boost priorities
          if (now >= state.nextPriorityBoost) {
            yield* this.boostWaitingItemPriorities();

            yield* Ref.update(this.state, (currentState) => ({
              ...currentState,
              nextPriorityBoost: new Date(
                now.getTime() + this.config.agingIntervalMs,
              ),
            }));
          }
        }),
      );
    }).pipe(
      Effect.catchAllCause(() => Effect.never), // Keep aging worker running
    );

  /**
   * Boosts priority of long-waiting items
   */
  private readonly boostWaitingItemPriorities = (): Effect.Effect<
    void,
    never
  > =>
    Ref.update(this.state, (state) => {
      const now = new Date();
      const updatedQueues = new Map<NoteId, QueueItem[]>();

      for (const [noteId, queue] of state.pendingQueues) {
        const boostedQueue = queue.map((item) => {
          const waitingTimeMs = now.getTime() - item.submitted_at.getTime();

          // Boost priority if item has been waiting more than 2x aging interval
          if (waitingTimeMs > this.config.agingIntervalMs * 2) {
            return {
              ...item,
              priority: item.priority + this.config.agingBoostAmount,
            };
          }

          return item;
        });

        if (boostedQueue.length > 0) {
          updatedQueues.set(noteId, boostedQueue);
        }
      }

      return {
        ...state,
        pendingQueues: updatedQueues,
      };
    });

  /**
   * Gets queue status and metrics
   *
   * @returns Current queue status
   */
  readonly getQueueStatus = (): Effect.Effect<
    {
      readonly totalPending: number;
      readonly totalInFlight: number;
      readonly pendingByNote: Map<NoteId, number>;
      readonly avgWaitingTimeMs: number;
      readonly oldestPendingItem?: Date;
      readonly queueUtilization: number; // 0.0 to 1.0
    },
    never
  > =>
    Ref.get(this.state).pipe(
      Effect.map((state) => {
        const pendingByNote = new Map<NoteId, number>();
        let totalPending = 0;
        let totalWaitingTime = 0;
        let oldestSubmission: Date | undefined;

        const now = new Date();

        for (const [noteId, queue] of state.pendingQueues) {
          pendingByNote.set(noteId, queue.length);
          totalPending += queue.length;

          for (const item of queue) {
            totalWaitingTime += now.getTime() - item.submitted_at.getTime();

            if (!oldestSubmission || item.submitted_at < oldestSubmission) {
              oldestSubmission = item.submitted_at;
            }
          }
        }

        const avgWaitingTimeMs =
          totalPending > 0 ? totalWaitingTime / totalPending : 0;
        const queueUtilization = totalPending / this.config.maxQueueSize;

        return {
          totalPending,
          totalInFlight: state.totalInFlight,
          pendingByNote,
          avgWaitingTimeMs,
          oldestPendingItem: oldestSubmission,
          queueUtilization,
        };
      }),
    );

  /**
   * Gets detailed operation status
   *
   * @param operationId - Operation ID to check
   * @returns Operation status or null if not found
   */
  readonly getOperationStatus = (
    operationId: string,
  ): Effect.Effect<
    {
      readonly status: "pending" | "processing" | "completed" | "failed";
      readonly item?: QueueItem;
      readonly started_at?: Date;
      readonly processing_duration_ms?: number;
    } | null,
    never
  > =>
    Ref.get(this.state).pipe(
      Effect.map((state) => {
        // Check in-flight operations
        const inFlight = state.inFlightOperations.get(operationId);
        if (inFlight) {
          return {
            status: "processing" as const,
            item: inFlight.item,
            started_at: inFlight.started_at,
            processing_duration_ms: Date.now() - inFlight.started_at.getTime(),
          };
        }

        // Check pending queues
        for (const queue of state.pendingQueues.values()) {
          const item = queue.find((item) => item.id === operationId);
          if (item) {
            return {
              status: "pending" as const,
              item,
            };
          }
        }

        return null; // Operation not found (completed or failed)
      }),
    );

  /**
   * Cancels a pending operation
   *
   * @param operationId - Operation ID to cancel
   * @returns Effect resolving to cancellation result
   */
  readonly cancelOperation = (
    operationId: string,
  ): Effect.Effect<boolean, never> =>
    Effect.gen(this, function* () {
      const state = yield* Ref.get(this.state);

      // Try to remove from pending queues
      let removed = false;

      yield* Ref.update(this.state, (currentState) => {
        const updatedQueues = new Map<NoteId, QueueItem[]>();

        for (const [noteId, queue] of currentState.pendingQueues) {
          const filteredQueue = queue.filter((item) => {
            if (item.id === operationId) {
              removed = true;
              return false;
            }
            return true;
          });

          if (filteredQueue.length > 0) {
            updatedQueues.set(noteId, filteredQueue);
          }
        }

        return {
          ...currentState,
          pendingQueues: updatedQueues,
        };
      });

      // If not in pending, try to cancel in-flight operation
      if (!removed) {
        const inFlight = state.inFlightOperations.get(operationId);
        if (inFlight) {
          yield* Fiber.interrupt(inFlight.fiber);
          removed = true;
        }
      }

      return removed;
    });

  /**
   * Gets scheduler health metrics
   *
   * @returns Health status and performance metrics
   */
  readonly getSchedulerHealth = (): Effect.Effect<
    {
      readonly healthy: boolean;
      readonly utilization: number;
      readonly avgWaitingTimeMs: number;
      readonly stuckOperations: number;
      readonly details: readonly string[];
    },
    never
  > =>
    Effect.gen(this, function* () {
      const queueStatus = yield* this.getQueueStatus();
      const state = yield* Ref.get(this.state);
      const now = new Date();

      // Check for stuck operations (processing for too long)
      let stuckOperations = 0;
      for (const inFlight of state.inFlightOperations.values()) {
        const processingTime = now.getTime() - inFlight.started_at.getTime();
        if (processingTime > this.config.processingTimeoutMs * 1.5) {
          stuckOperations++;
        }
      }

      const details: string[] = [];

      if (queueStatus.queueUtilization > 0.8) {
        details.push("Queue utilization high");
      }

      if (queueStatus.avgWaitingTimeMs > 10000) {
        details.push("Average waiting time exceeds 10 seconds");
      }

      if (stuckOperations > 0) {
        details.push(`${stuckOperations} operations appear stuck`);
      }

      const healthy =
        queueStatus.queueUtilization < 0.9 &&
        queueStatus.avgWaitingTimeMs < 15000 &&
        stuckOperations === 0;

      return {
        healthy,
        utilization: queueStatus.queueUtilization,
        avgWaitingTimeMs: queueStatus.avgWaitingTimeMs,
        stuckOperations,
        details,
      };
    });
}

/**
 * Creates an operation scheduler
 *
 * @param processor - Function to process operations
 * @param config - Queue configuration
 * @returns New operation scheduler instance
 */
export function createOperationScheduler(
  processor: (operation: QueueOperation) => Effect.Effect<void, unknown>,
  config: QueueConfig = DEFAULT_QUEUE_CONFIG,
): OperationScheduler {
  return new OperationScheduler(config, processor);
}

/**
 * Validates queue configuration
 *
 * @param config - Configuration to validate
 * @returns Validation errors (empty if valid)
 */
export function validateQueueConfig(config: QueueConfig): string[] {
  const errors: string[] = [];

  if (config.maxInFlightPerNote < 1) {
    errors.push("maxInFlightPerNote must be at least 1");
  }

  if (config.maxInFlightPerWorkspace < config.maxInFlightPerNote) {
    errors.push("maxInFlightPerWorkspace must be at least maxInFlightPerNote");
  }

  if (config.agingIntervalMs < 1000) {
    errors.push("agingIntervalMs must be at least 1000ms");
  }

  if (config.agingBoostAmount <= 0) {
    errors.push("agingBoostAmount must be positive");
  }

  if (config.maxQueueSize < 10) {
    errors.push("maxQueueSize must be at least 10");
  }

  if (config.processingTimeoutMs < 5000) {
    errors.push("processingTimeoutMs must be at least 5000ms");
  }

  return errors;
}
