/**
 * Observability port interface for metrics, telemetry, and health monitoring
 *
 * References SPEC.md Section 8: Observability Signals (privacy-preserving)
 * Defines abstract interface for system monitoring without exposing content
 */

import type { Effect } from "effect";
import type {
  AnswerId,
  QueryId,
  SessionId,
  VersionId,
} from "../schema/entities";

/**
 * Observability error types
 */
export type ObservabilityError =
  | {
      readonly _tag: "MetricRecordingFailed";
      readonly metric: string;
      readonly reason: string;
    }
  | { readonly _tag: "TelemetryStorageFailed"; readonly event: string }
  | {
      readonly _tag: "HealthCheckFailed";
      readonly component: string;
      readonly reason: string;
    };

/**
 * Metric types for different measurements
 */
export type MetricType = "counter" | "timer" | "gauge" | "histogram";

/**
 * Metric measurement
 */
export interface Metric {
  readonly name: string;
  readonly type: MetricType;
  readonly value: number;
  readonly timestamp: Date;
  readonly tags?: Record<string, string>;
}

/**
 * Timer measurement result
 */
export interface TimerResult {
  readonly duration_ms: number;
  readonly started_at: Date;
  readonly completed_at: Date;
}

/**
 * System health status
 */
export interface HealthStatus {
  readonly component: string;
  readonly status: "healthy" | "degraded" | "unhealthy";
  readonly details?: string;
  readonly last_check: Date;
  readonly response_time_ms?: number;
}

/**
 * SLO (Service Level Objective) measurement
 */
export interface SloMeasurement {
  readonly metric_name: string;
  readonly target_ms: number;
  readonly current_p50_ms: number;
  readonly current_p95_ms: number;
  readonly current_p99_ms: number;
  readonly breach_count_24h: number;
  readonly last_breach?: Date;
}

/**
 * Telemetry event (privacy-preserving)
 */
export interface TelemetryEvent {
  readonly event_type: string;
  readonly timestamp: Date;
  readonly session_id?: SessionId;
  readonly metadata: Record<string, string | number | boolean>;
  // NOTE: No content bodies stored per SPEC privacy requirements
}

/**
 * Observability port interface for monitoring operations
 */
export interface ObservabilityPort {
  // Metric recording
  /**
   * Records a counter metric (monotonically increasing)
   */
  readonly recordCounter: (
    name: string,
    value: number,
    tags?: Record<string, string>,
  ) => Effect.Effect<void, ObservabilityError>;

  /**
   * Records a gauge metric (current value)
   */
  readonly recordGauge: (
    name: string,
    value: number,
    tags?: Record<string, string>,
  ) => Effect.Effect<void, ObservabilityError>;

  /**
   * Records a timer measurement
   */
  readonly recordTimer: (
    name: string,
    duration_ms: number,
    tags?: Record<string, string>,
  ) => Effect.Effect<void, ObservabilityError>;

  /**
   * Starts a timer and returns completion function
   */
  readonly startTimer: (
    name: string,
    tags?: Record<string, string>,
  ) => Effect.Effect<
    () => Effect.Effect<TimerResult, ObservabilityError>,
    ObservabilityError
  >;

  // SLO monitoring
  /**
   * Records search latency for SLO tracking
   * SPEC: "P50 ≤ 200 ms; P95 ≤ 500 ms on 10k corpus"
   */
  readonly recordSearchLatency: (
    duration_ms: number,
    query_id: QueryId,
    result_count: number,
  ) => Effect.Effect<void, ObservabilityError>;

  /**
   * Records visibility latency for SLO tracking
   * SPEC: "P50 ≤ 5 s; P95 ≤ 10 s from action to committed corpus visibility"
   */
  readonly recordVisibilityLatency: (
    duration_ms: number,
    version_id: VersionId,
    operation: "publish" | "republish" | "rollback",
  ) => Effect.Effect<void, ObservabilityError>;

  /**
   * Records reading view latency
   * SPEC: "reading open+highlight 200/500 ms"
   */
  readonly recordReadingLatency: (
    duration_ms: number,
    version_id: VersionId,
    anchor_resolved: boolean,
  ) => Effect.Effect<void, ObservabilityError>;

  /**
   * Gets current SLO measurements
   */
  readonly getSloMeasurements: () => Effect.Effect<
    readonly SloMeasurement[],
    ObservabilityError
  >;

  /**
   * Checks if SLO is currently breached
   */
  readonly isSloBreached: (
    metric_name: string,
  ) => Effect.Effect<boolean, ObservabilityError>;

  // Event recording (privacy-preserving)
  /**
   * Records query submission event
   * SPEC: "structured events without content"
   */
  readonly recordQueryEvent: (
    query_id: QueryId,
    scope_collection_count: number,
    has_filters: boolean,
  ) => Effect.Effect<void, ObservabilityError>;

  /**
   * Records answer composition event
   */
  readonly recordAnswerEvent: (
    answer_id: AnswerId,
    citation_count: number,
    composition_time_ms: number,
    coverage_ratio: number,
  ) => Effect.Effect<void, ObservabilityError>;

  /**
   * Records no-answer event
   */
  readonly recordNoAnswerEvent: (
    query_id: QueryId,
    reason: "insufficient_evidence" | "unresolved_citations",
    candidate_count: number,
  ) => Effect.Effect<void, ObservabilityError>;

  /**
   * Records citation interaction event
   */
  readonly recordCitationInteraction: (
    citation_id: string,
    action: "opened" | "followed" | "resolved" | "unresolved",
    session_id?: SessionId,
  ) => Effect.Effect<void, ObservabilityError>;

  // Health monitoring
  /**
   * Records component health status
   */
  readonly recordHealthStatus: (
    component: string,
    status: HealthStatus,
  ) => Effect.Effect<void, ObservabilityError>;

  /**
   * Gets overall system health
   */
  readonly getSystemHealth: () => Effect.Effect<
    {
      readonly overall_status: "healthy" | "degraded" | "unhealthy";
      readonly components: readonly HealthStatus[];
      readonly critical_issues: readonly string[];
    },
    ObservabilityError
  >;

  /**
   * Performs health check for a component
   */
  readonly performHealthCheck: (
    component: string,
  ) => Effect.Effect<HealthStatus, ObservabilityError>;

  // Telemetry data access
  /**
   * Gets metrics for a time range
   */
  readonly getMetrics: (
    metric_names: readonly string[],
    start_time: Date,
    end_time: Date,
  ) => Effect.Effect<readonly Metric[], ObservabilityError>;

  /**
   * Gets telemetry events for analysis
   */
  readonly getTelemetryEvents: (
    event_types: readonly string[],
    start_time: Date,
    end_time: Date,
    limit?: number,
  ) => Effect.Effect<readonly TelemetryEvent[], ObservabilityError>;

  /**
   * Exports telemetry data (privacy-compliant)
   * SPEC: "no content bodies in telemetry"
   */
  readonly exportTelemetryData: (
    start_time: Date,
    end_time: Date,
    include_traces?: boolean,
  ) => Effect.Effect<
    {
      readonly metrics: readonly Metric[];
      readonly events: readonly TelemetryEvent[];
      readonly anonymization_applied: boolean;
    },
    ObservabilityError
  >;

  // Data lifecycle management
  /**
   * Purges old telemetry data
   * SPEC: "events/counters 30 days; traces 7 days"
   */
  readonly purgeTelemetryData: (
    older_than: Date,
    include_traces?: boolean,
  ) => Effect.Effect<{ deleted_count: number }, ObservabilityError>;

  /**
   * Gets telemetry retention status
   */
  readonly getTelemetryRetentionStatus: () => Effect.Effect<
    {
      readonly metrics_retention_days: number;
      readonly events_retention_days: number;
      readonly traces_retention_days: number;
      readonly oldest_metric: Date;
      readonly oldest_event: Date;
      readonly total_storage_mb: number;
    },
    ObservabilityError
  >;

  // Real-time monitoring
  /**
   * Subscribes to real-time metric updates
   */
  readonly subscribeToMetrics: (
    metric_names: readonly string[],
    callback: (metrics: readonly Metric[]) => void,
  ) => Effect.Effect<() => void, ObservabilityError>; // Returns unsubscribe function

  /**
   * Subscribes to SLO breach alerts
   */
  readonly subscribeToSloBreaches: (
    callback: (breach: {
      metric: string;
      current_value: number;
      threshold: number;
    }) => void,
  ) => Effect.Effect<() => void, ObservabilityError>;
}

/**
 * Observability port identifier for dependency injection
 */
export const ObservabilityPort = Symbol("ObservabilityPort");
export type ObservabilityPortSymbol = typeof ObservabilityPort;

/**
 * Well-known metric names for consistency
 */
export const METRIC_NAMES = {
  // Search metrics
  SEARCH_LATENCY: "search.latency_ms",
  SEARCH_REQUESTS: "search.requests_total",
  SEARCH_NO_ANSWER: "search.no_answer_total",
  SEARCH_RESULT_COUNT: "search.result_count",

  // Visibility metrics
  VISIBILITY_LATENCY: "visibility.latency_ms",
  VISIBILITY_EVENTS: "visibility.events_total",
  VISIBILITY_FAILURES: "visibility.failures_total",

  // Reading metrics
  READING_LATENCY: "reading.latency_ms",
  READING_OPENS: "reading.opens_total",
  CITATION_OPENS: "reading.citation_opens_total",

  // System metrics
  MEMORY_USAGE: "system.memory_usage_mb",
  STORAGE_SIZE: "system.storage_size_mb",
  INDEX_SIZE: "system.index_size_mb",

  // Quality metrics
  ANCHOR_RESOLUTION_RATE: "quality.anchor_resolution_rate",
  CITATION_COVERAGE: "quality.citation_coverage_ratio",
  INDEX_HEALTH_SCORE: "quality.index_health_score",
} as const;

/**
 * Well-known event types for consistency
 */
export const EVENT_TYPES = {
  QUERY_SUBMITTED: "query.submitted",
  ANSWER_COMPOSED: "answer.composed",
  NO_ANSWER_RETURNED: "answer.no_answer",
  CITATION_OPENED: "citation.opened",
  VERSION_PUBLISHED: "version.published",
  VERSION_ROLLED_BACK: "version.rolled_back",
  SESSION_STARTED: "session.started",
  SESSION_ENDED: "session.ended",
  HEALTH_CHECK_PERFORMED: "health.check_performed",
  SLO_BREACH_DETECTED: "slo.breach_detected",
} as const;
