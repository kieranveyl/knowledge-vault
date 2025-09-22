/**
 * Rate limiting policy and enforcement rules
 *
 * References SPEC.md Section 7: Rate Limits (per session, defaults)
 * Defines rate limiting constraints for queries and mutations
 */

import { Schema } from "@effect/schema";
import { config } from "../config/environment";

/**
 * Rate limit policy constants per session
 *
 * @see SPEC.md Section 7: "Queries: burst ≤ 5 QPS, sustained ≤ 60/min; Mutations: burst ≤ 1/5 s, sustained ≤ 12/min"
 */
export const RATE_LIMIT_POLICY = {
	/** Query rate limits */
	QUERIES: {
		/** Maximum queries per second during burst */
		BURST_QPS: config.rateLimits.queries.burstPerSecond,

		/** Maximum queries per minute sustained */
		SUSTAINED_PER_MINUTE: config.rateLimits.queries.sustainedPerMinute,

		/** Burst window duration in milliseconds */
		BURST_WINDOW_MS: 1000,

		/** Sustained rate window in milliseconds */
		SUSTAINED_WINDOW_MS: 60000,
	},

	/** Mutation rate limits (publish/republish/rollback) */
	MUTATIONS: {
		/** Maximum mutations per window */
		BURST_PER_WINDOW: config.rateLimits.mutations.burstPerWindow,

		/** Maximum mutations per minute sustained */
		SUSTAINED_PER_MINUTE: config.rateLimits.mutations.sustainedPerMinute,

		/** Burst window duration in milliseconds */
		BURST_WINDOW_MS: config.rateLimits.mutations.windowSeconds * 1000,

		/** Sustained rate window in milliseconds */
		SUSTAINED_WINDOW_MS: 60000,
	},

	/** Draft save rate limits (more permissive for UX) */
	DRAFT_SAVES: {
		/** Maximum draft saves per second */
		BURST_PPS: config.rateLimits.drafts.burstPerSecond,

		/** Sustained draft saves per minute */
		SUSTAINED_PER_MINUTE: config.rateLimits.drafts.sustainedPerMinute,

		/** Burst window duration in milliseconds */
		BURST_WINDOW_MS: 1000,

		/** Sustained rate window in milliseconds */
		SUSTAINED_WINDOW_MS: 60000,
	},
} as const;

/**
 * Rate limit violation types
 */
export const RateLimitViolationType = Schema.Literal(
	"query_burst_exceeded",
	"query_sustained_exceeded",
	"mutation_burst_exceeded",
	"mutation_sustained_exceeded",
	"draft_burst_exceeded",
	"draft_sustained_exceeded",
);
export type RateLimitViolationType = Schema.Schema.Type<
	typeof RateLimitViolationType
>;

/**
 * Rate limit enforcement result
 */
export const RateLimitResult = Schema.Struct({
	allowed: Schema.Boolean,
	violation_type: Schema.optional(RateLimitViolationType),
	retry_after_ms: Schema.optional(
		Schema.Number.pipe(Schema.int(), Schema.greaterThan(0)),
	),
	current_count: Schema.Number.pipe(
		Schema.int(),
		Schema.greaterThanOrEqualTo(0),
	),
	limit: Schema.Number.pipe(Schema.int(), Schema.greaterThan(0)),
	window_reset_at: Schema.Date,
});
export type RateLimitResult = Schema.Schema.Type<typeof RateLimitResult>;

/**
 * Rate limit bucket for tracking request counts
 */
export interface RateLimitBucket {
	readonly window_start: Date;
	readonly window_duration_ms: number;
	readonly limit: number;
	count: number;
}

/**
 * Session-scoped rate limiter state
 */
export interface SessionRateLimiter {
	readonly session_id: string;
	readonly query_burst_bucket: RateLimitBucket;
	readonly query_sustained_bucket: RateLimitBucket;
	readonly mutation_burst_bucket: RateLimitBucket;
	readonly mutation_sustained_bucket: RateLimitBucket;
	readonly draft_burst_bucket: RateLimitBucket;
	readonly draft_sustained_bucket: RateLimitBucket;
}

/**
 * Creates a new rate limit bucket
 */
function createBucket(
	limit: number,
	window_duration_ms: number,
): RateLimitBucket {
	return {
		window_start: new Date(),
		window_duration_ms,
		limit,
		count: 0,
	};
}

/**
 * Checks if a bucket window has expired and needs reset
 */
function shouldResetBucket(bucket: RateLimitBucket, now: Date): boolean {
	return (
		now.getTime() - bucket.window_start.getTime() >= bucket.window_duration_ms
	);
}

/**
 * Resets a bucket to start a new window
 */
function resetBucket(bucket: RateLimitBucket, now: Date): void {
	// biome-ignore lint/suspicious/noExplicitAny: Modifying readonly field for internal bucket management
	(bucket as any).window_start = now;
	bucket.count = 0;
}

/**
 * Checks rate limit for a specific bucket
 */
function checkBucketLimit(
	bucket: RateLimitBucket,
	violationType: RateLimitViolationType,
	now: Date = new Date(),
): RateLimitResult {
	// Reset bucket if window has expired
	if (shouldResetBucket(bucket, now)) {
		resetBucket(bucket, now);
	}

	// Check if adding one more request would exceed the limit
	if (bucket.count >= bucket.limit) {
		const window_reset_at = new Date(
			bucket.window_start.getTime() + bucket.window_duration_ms,
		);
		const retry_after_ms = window_reset_at.getTime() - now.getTime();

		return {
			allowed: false,
			violation_type: violationType,
			retry_after_ms: Math.max(0, retry_after_ms),
			current_count: bucket.count,
			limit: bucket.limit,
			window_reset_at,
		};
	}

	// Increment count and allow request
	bucket.count += 1;

	return {
		allowed: true,
		current_count: bucket.count,
		limit: bucket.limit,
		window_reset_at: new Date(
			bucket.window_start.getTime() + bucket.window_duration_ms,
		),
	};
}

/**
 * Creates a new session rate limiter
 */
export function createSessionRateLimiter(
	session_id: string,
): SessionRateLimiter {
	return {
		session_id,
		query_burst_bucket: createBucket(
			RATE_LIMIT_POLICY.QUERIES.BURST_QPS,
			RATE_LIMIT_POLICY.QUERIES.BURST_WINDOW_MS,
		),
		query_sustained_bucket: createBucket(
			RATE_LIMIT_POLICY.QUERIES.SUSTAINED_PER_MINUTE,
			RATE_LIMIT_POLICY.QUERIES.SUSTAINED_WINDOW_MS,
		),
		mutation_burst_bucket: createBucket(
			RATE_LIMIT_POLICY.MUTATIONS.BURST_PER_WINDOW,
			RATE_LIMIT_POLICY.MUTATIONS.BURST_WINDOW_MS,
		),
		mutation_sustained_bucket: createBucket(
			RATE_LIMIT_POLICY.MUTATIONS.SUSTAINED_PER_MINUTE,
			RATE_LIMIT_POLICY.MUTATIONS.SUSTAINED_WINDOW_MS,
		),
		draft_burst_bucket: createBucket(
			RATE_LIMIT_POLICY.DRAFT_SAVES.BURST_PPS,
			RATE_LIMIT_POLICY.DRAFT_SAVES.BURST_WINDOW_MS,
		),
		draft_sustained_bucket: createBucket(
			RATE_LIMIT_POLICY.DRAFT_SAVES.SUSTAINED_PER_MINUTE,
			RATE_LIMIT_POLICY.DRAFT_SAVES.SUSTAINED_WINDOW_MS,
		),
	};
}

/**
 * Checks rate limits for query operations
 *
 * @param limiter - Session rate limiter
 * @returns Rate limit check result
 */
export function checkQueryRateLimit(
	limiter: SessionRateLimiter,
): RateLimitResult {
	// Check burst limit first (more restrictive short-term)
	const burstResult = checkBucketLimit(
		limiter.query_burst_bucket,
		"query_burst_exceeded",
	);

	if (!burstResult.allowed) {
		return burstResult;
	}

	// Check sustained limit
	const sustainedResult = checkBucketLimit(
		limiter.query_sustained_bucket,
		"query_sustained_exceeded",
	);

	if (!sustainedResult.allowed) {
		// Decrement burst bucket since sustained limit was hit
		limiter.query_burst_bucket.count -= 1;
		return sustainedResult;
	}

	return sustainedResult;
}

/**
 * Checks rate limits for mutation operations (publish/republish/rollback)
 *
 * @param limiter - Session rate limiter
 * @returns Rate limit check result
 */
export function checkMutationRateLimit(
	limiter: SessionRateLimiter,
): RateLimitResult {
	// Check burst limit first
	const burstResult = checkBucketLimit(
		limiter.mutation_burst_bucket,
		"mutation_burst_exceeded",
	);

	if (!burstResult.allowed) {
		return burstResult;
	}

	// Check sustained limit
	const sustainedResult = checkBucketLimit(
		limiter.mutation_sustained_bucket,
		"mutation_sustained_exceeded",
	);

	if (!sustainedResult.allowed) {
		// Decrement burst bucket since sustained limit was hit
		limiter.mutation_burst_bucket.count -= 1;
		return sustainedResult;
	}

	return sustainedResult;
}

/**
 * Checks rate limits for draft save operations
 *
 * @param limiter - Session rate limiter
 * @returns Rate limit check result
 */
export function checkDraftSaveRateLimit(
	limiter: SessionRateLimiter,
): RateLimitResult {
	// Check burst limit first
	const burstResult = checkBucketLimit(
		limiter.draft_burst_bucket,
		"draft_burst_exceeded",
	);

	if (!burstResult.allowed) {
		return burstResult;
	}

	// Check sustained limit
	const sustainedResult = checkBucketLimit(
		limiter.draft_sustained_bucket,
		"draft_sustained_exceeded",
	);

	if (!sustainedResult.allowed) {
		// Decrement burst bucket since sustained limit was hit
		limiter.draft_burst_bucket.count -= 1;
		return sustainedResult;
	}

	return sustainedResult;
}

/**
 * Gets current rate limit status without consuming quota
 *
 * @param limiter - Session rate limiter
 * @returns Current status of all rate limiters
 */
export function getRateLimitStatus(limiter: SessionRateLimiter) {
	const now = new Date();

	return {
		queries: {
			burst: {
				count: limiter.query_burst_bucket.count,
				limit: limiter.query_burst_bucket.limit,
				window_reset_at: new Date(
					limiter.query_burst_bucket.window_start.getTime() +
						limiter.query_burst_bucket.window_duration_ms,
				),
				expired: shouldResetBucket(limiter.query_burst_bucket, now),
			},
			sustained: {
				count: limiter.query_sustained_bucket.count,
				limit: limiter.query_sustained_bucket.limit,
				window_reset_at: new Date(
					limiter.query_sustained_bucket.window_start.getTime() +
						limiter.query_sustained_bucket.window_duration_ms,
				),
				expired: shouldResetBucket(limiter.query_sustained_bucket, now),
			},
		},
		mutations: {
			burst: {
				count: limiter.mutation_burst_bucket.count,
				limit: limiter.mutation_burst_bucket.limit,
				window_reset_at: new Date(
					limiter.mutation_burst_bucket.window_start.getTime() +
						limiter.mutation_burst_bucket.window_duration_ms,
				),
				expired: shouldResetBucket(limiter.mutation_burst_bucket, now),
			},
			sustained: {
				count: limiter.mutation_sustained_bucket.count,
				limit: limiter.mutation_sustained_bucket.limit,
				window_reset_at: new Date(
					limiter.mutation_sustained_bucket.window_start.getTime() +
						limiter.mutation_sustained_bucket.window_duration_ms,
				),
				expired: shouldResetBucket(limiter.mutation_sustained_bucket, now),
			},
		},
	};
}
