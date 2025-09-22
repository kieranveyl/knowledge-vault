/**
 * Elysia API adapter implementation
 * 
 * References SPEC.md Section 4: External Interfaces & Contracts
 * Implements REST API routes with proper error handling and rate limiting
 */

import { Elysia, t } from "elysia";
import { Effect } from "effect";
import { Schema } from "@effect/schema";
import type {
	StoragePort,
	IndexingPort,
	ParsingPort,
	ObservabilityPort,
} from "../../services";

import type {
	SaveDraftRequest,
	PublishRequest,
	RollbackRequest,
	SearchRequest,
	ListVersionsRequest,
	LoadSessionRequest,
	OpenStepRequest,
	CreateSnapshotRequest,
	ListSnapshotsRequest,
	RestoreSnapshotRequest,
	ResolveAnchorRequest,
	ApiErrorResponse,
} from "../../schema/api";

import {
	createSessionRateLimiter,
	checkQueryRateLimit,
	checkMutationRateLimit,
	checkDraftSaveRateLimit,
	type SessionRateLimiter,
} from "../../policy/rate-limits";

/**
 * API adapter dependencies
 */
export interface ApiAdapterDependencies {
	readonly storage: StoragePort;
	readonly indexing: IndexingPort;
	readonly parsing: ParsingPort;
	readonly observability: ObservabilityPort;
}

/**
 * Session context for rate limiting
 */
interface SessionContext {
	readonly session_id: string;
	readonly rate_limiter: SessionRateLimiter;
	readonly created_at: Date;
}

/**
 * API error mapping from domain errors to HTTP responses
 */
function mapToApiError(error: unknown): ApiErrorResponse {
	if (typeof error === "object" && error !== null && "_tag" in error) {
		const taggedError = error as { _tag: string; [key: string]: any };
		
		switch (taggedError._tag) {
			case "NotFound":
				return {
					error: {
						type: "NotFound",
						message: `${taggedError.entity} not found: ${taggedError.id}`,
					},
				};
			
			case "ValidationError":
				return {
					error: {
						type: "ValidationError",
						message: "Validation failed",
						details: taggedError.errors?.map((err: string) => ({
							field: "unknown",
							message: err,
							code: "VALIDATION_ERROR",
						})),
					},
				};
			
			case "ConflictError":
				return {
					error: {
						type: "ConflictError",
						message: taggedError.message || "Operation conflict",
					},
				};
			
			case "IndexingFailure":
				return {
					error: {
						type: "IndexingFailure",
						message: taggedError.reason || "Indexing operation failed",
					},
				};
			
			default:
				return {
					error: {
						type: "StorageIO",
						message: "Internal server error",
					},
				};
		}
	}

	return {
		error: {
			type: "StorageIO",
			message: error instanceof Error ? error.message : "Unknown error",
		},
	};
}

/**
 * Rate limit check middleware
 */
function checkRateLimit(
	rateLimiter: SessionRateLimiter,
	operation: "query" | "mutation" | "draft",
) {
	const checkFunction = {
		query: checkQueryRateLimit,
		mutation: checkMutationRateLimit,
		draft: checkDraftSaveRateLimit,
	}[operation];

	const result = checkFunction(rateLimiter);
	
	if (!result.allowed) {
		throw new Error(
			JSON.stringify({
				error: {
					type: "RateLimitExceeded",
					message: `Rate limit exceeded for ${operation} operations`,
					retry_after: Math.ceil((result.retry_after_ms || 0) / 1000),
				},
			}),
		);
	}
}

/**
 * Creates Elysia API application with all routes
 */
export function createApiAdapter(deps: ApiAdapterDependencies): Elysia {
	// Session management (simplified - would use proper session store in production)
	const sessions = new Map<string, SessionContext>();

	const getOrCreateSession = (sessionId?: string): SessionContext => {
		if (sessionId && sessions.has(sessionId)) {
			return sessions.get(sessionId)!;
		}

		const newSessionId = sessionId || `ses_${Date.now()}`;
		const context: SessionContext = {
			session_id: newSessionId,
			rate_limiter: createSessionRateLimiter(newSessionId),
			created_at: new Date(),
		};

		sessions.set(newSessionId, context);
		return context;
	};

	return new Elysia({ name: "knowledge-api" })
		// Health and status endpoints
		.get("/healthz", () => ({ status: "ok" }))
		.get("/health", async () => {
			const healthResult = await Effect.runPromise(deps.storage.getStorageHealth());
			return healthResult;
		})

		// Draft operations
		.post(
			"/drafts",
			async ({ body, headers }) => {
				const sessionContext = getOrCreateSession(headers["x-session-id"]);
				checkRateLimit(sessionContext.rate_limiter, "draft");

				try {
					const request = Schema.decodeUnknownSync(SaveDraftRequest)(body);
					const response = await Effect.runPromise(deps.storage.saveDraft(request));
					return response;
				} catch (error) {
					throw new Error(JSON.stringify(mapToApiError(error)));
				}
			},
			{
				body: t.Object({
					note_id: t.String(),
					body_md: t.String(),
					metadata: t.Object({
						tags: t.Optional(t.Array(t.String())),
					}),
					client_token: t.Optional(t.String()),
				}),
			},
		)

		.get("/drafts/:note_id", async ({ params }) => {
			try {
				const draft = await Effect.runPromise(
					deps.storage.getDraft(params.note_id as any),
				);
				return draft;
			} catch (error) {
				throw new Error(JSON.stringify(mapToApiError(error)));
			}
		})

		// Publication operations
		.post(
			"/publish",
			async ({ body, headers }) => {
				const sessionContext = getOrCreateSession(headers["x-session-id"]);
				checkRateLimit(sessionContext.rate_limiter, "mutation");

				try {
					const request = Schema.decodeUnknownSync(PublishRequest)(body);
					const response = await Effect.runPromise(deps.storage.publishVersion(request));
					return response;
				} catch (error) {
					throw new Error(JSON.stringify(mapToApiError(error)));
				}
			},
			{
				body: t.Object({
					note_id: t.String(),
					collections: t.Array(t.String()),
					label: t.Optional(t.Union([t.Literal("minor"), t.Literal("major")])),
					client_token: t.String(),
				}),
			},
		)

		.post(
			"/rollback",
			async ({ body, headers }) => {
				const sessionContext = getOrCreateSession(headers["x-session-id"]);
				checkRateLimit(sessionContext.rate_limiter, "mutation");

				try {
					const request = Schema.decodeUnknownSync(RollbackRequest)(body);
					const response = await Effect.runPromise(deps.storage.rollbackToVersion(request));
					return response;
				} catch (error) {
					throw new Error(JSON.stringify(mapToApiError(error)));
				}
			},
			{
				body: t.Object({
					note_id: t.String(),
					target_version_id: t.String(),
					client_token: t.String(),
				}),
			},
		)

		// Search operations
		.get("/search", async ({ query, headers }) => {
			const sessionContext = getOrCreateSession(headers["x-session-id"]);
			checkRateLimit(sessionContext.rate_limiter, "query");

			try {
				const request: SearchRequest = {
					q: query.q as string,
					collections: query.collections ? 
						(Array.isArray(query.collections) ? query.collections : [query.collections]) as any[] :
						undefined,
					page: query.page ? Number.parseInt(query.page, 10) : undefined,
					page_size: query.page_size ? Number.parseInt(query.page_size, 10) : undefined,
				};

				const response = await Effect.runPromise(deps.indexing.search(request));
				return response;
			} catch (error) {
				throw new Error(JSON.stringify(mapToApiError(error)));
			}
		})

		// Version operations
		.get("/notes/:note_id/versions", async ({ params, query }) => {
			try {
				const request: ListVersionsRequest = {
					note_id: params.note_id as any,
					page: query.page ? Number.parseInt(query.page, 10) : undefined,
					page_size: query.page_size ? Number.parseInt(query.page_size, 10) : undefined,
				};

				const versions = await Effect.runPromise(
					deps.storage.listVersions(request.note_id, {
						offset: (request.page || 0) * (request.page_size || 10),
						limit: request.page_size || 10,
					}),
				);

				return {
					versions,
					page: request.page || 0,
					page_size: request.page_size || 10,
					total_count: versions.length,
					has_more: false, // TODO: Implement proper pagination
				};
			} catch (error) {
				throw new Error(JSON.stringify(mapToApiError(error)));
			}
		})

		.get("/versions/:version_id", async ({ params }) => {
			try {
				const version = await Effect.runPromise(
					deps.storage.getVersion(params.version_id as any),
				);
				return version;
			} catch (error) {
				throw new Error(JSON.stringify(mapToApiError(error)));
			}
		})

		// Collection operations
		.get("/collections", async ({ query }) => {
			try {
				const collections = await Effect.runPromise(
					deps.storage.listCollections({
						offset: query.offset ? Number.parseInt(query.offset, 10) : undefined,
						limit: query.limit ? Number.parseInt(query.limit, 10) : undefined,
					}),
				);
				return { collections };
			} catch (error) {
				throw new Error(JSON.stringify(mapToApiError(error)));
			}
		})

		.post(
			"/collections",
			async ({ body }) => {
				try {
					const collection = await Effect.runPromise(
						deps.storage.createCollection(body.name, body.description),
					);
					return collection;
				} catch (error) {
					throw new Error(JSON.stringify(mapToApiError(error)));
				}
			},
			{
				body: t.Object({
					name: t.String(),
					description: t.Optional(t.String()),
				}),
			},
		)

		.get("/collections/:collection_id", async ({ params }) => {
			try {
				const collection = await Effect.runPromise(
					deps.storage.getCollection(params.collection_id as any),
				);
				return collection;
			} catch (error) {
				throw new Error(JSON.stringify(mapToApiError(error)));
			}
		})

		// Session operations
		.get("/sessions", async ({ query }) => {
			try {
				const sessions = await Effect.runPromise(
					deps.storage.listSessions({
						offset: query.offset ? Number.parseInt(query.offset, 10) : undefined,
						limit: query.limit ? Number.parseInt(query.limit, 10) : undefined,
					}),
				);
				return { sessions };
			} catch (error) {
				throw new Error(JSON.stringify(mapToApiError(error)));
			}
		})

		.get("/sessions/:session_id", async ({ params }) => {
			try {
				const session = await Effect.runPromise(
					deps.storage.getSession(params.session_id as any),
				);
				return { session };
			} catch (error) {
				throw new Error(JSON.stringify(mapToApiError(error)));
			}
		})

		// Anchor resolution for reading view
		.post(
			"/resolve-anchor",
			async ({ body }) => {
				try {
					const request = Schema.decodeUnknownSync(ResolveAnchorRequest)(body);
					
					// Get version content
					const version = await Effect.runPromise(
						deps.storage.getVersion(request.version_id),
					);

					// Resolve anchor using parsing service
					const resolution = await Effect.runPromise(
						deps.parsing.resolveAnchor(request.anchor as any, version.content_md),
					);

					return {
						resolved: resolution.resolved,
						content: resolution.resolved ? 
							await Effect.runPromise(
								deps.parsing.extractAnchorContent(request.anchor as any, version.content_md)
							) : undefined,
						error: resolution.error,
					};
				} catch (error) {
					throw new Error(JSON.stringify(mapToApiError(error)));
				}
			},
			{
				body: t.Object({
					version_id: t.String(),
					anchor: t.Object({
						structure_path: t.String(),
						token_offset: t.Number(),
						token_length: t.Number(),
						fingerprint: t.String(),
					}),
				}),
			},
		)

		// Global error handler
		.onError(({ error, set }) => {
			// Try to parse as JSON error response
			try {
				const errorResponse = JSON.parse(error.message);
				if (errorResponse.error) {
					set.status = getHttpStatusForError(errorResponse.error.type);
					return errorResponse;
				}
			} catch {
				// Not a JSON error, handle as generic error
			}

			// Generic error response
			set.status = 500;
			return {
				error: {
					type: "StorageIO",
					message: error.message || "Internal server error",
				},
			};
		});
}

/**
 * Maps error types to HTTP status codes
 */
function getHttpStatusForError(errorType: string): number {
	switch (errorType) {
		case "NotFound":
			return 404;
		case "ValidationError":
			return 400;
		case "ConflictError":
			return 409;
		case "RateLimitExceeded":
			return 429;
		case "VisibilityTimeout":
		case "IndexingFailure":
			return 503;
		case "SchemaVersionMismatch":
			return 422;
		default:
			return 500;
	}
}

/**
 * Type definitions for API adapter dependencies injection
 */
export const ApiAdapterPort = Symbol("ApiAdapterPort");
export type ApiAdapterPortSymbol = typeof ApiAdapterPort;

/**
 * Creates API adapter with dependency injection
 */
export const createApiAdapterFactory = (deps: ApiAdapterDependencies) => () =>
	createApiAdapter(deps);

/**
 * Enhanced app factory that includes all required routes
 */
export function createKnowledgeApiApp(deps: ApiAdapterDependencies): Elysia {
	const apiAdapter = createApiAdapter(deps);
	
	return new Elysia({ name: "knowledge-repository-api" })
		.use(apiAdapter)
		// Add CORS headers for local development
		.onRequest(({ set }) => {
			set.headers["Access-Control-Allow-Origin"] = "*";
			set.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS";
			set.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, X-Session-ID";
		})
		// Add request/response logging
		.onBeforeHandle(({ request, set }) => {
			console.log(`${request.method} ${new URL(request.url).pathname}`);
			set.headers["X-Request-ID"] = `req_${Date.now()}`;
		})
		.onAfterHandle(({ response, set }) => {
			console.log(`Response: ${set.status || 200}`);
		});
}
