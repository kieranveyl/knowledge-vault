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

import {
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
	type ApiErrorResponse,
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
 * Maps error type to HTTP status code
 */
function getHttpStatusFromError(error: unknown): number {
	if (typeof error === "object" && error !== null && "_tag" in error) {
		const taggedError = error as { _tag: string };
		
		switch (taggedError._tag) {
			case "NotFound":
				return 404;
			case "ValidationError":
				return 400;
			case "ConflictError":
				return 409;
			case "IndexingFailure":
				return 502; // Bad Gateway
			case "RateLimitExceeded":
				return 429; // Too Many Requests
			default:
				return 500; // Internal Server Error
		}
	}
	return 500;
}

/**
 * Maps database error to storage error (duplicated from postgres adapter)
 */
function mapDatabaseError(error: any): any {
  switch (error._tag) {
    case "ConnectionFailed":
      return { _tag: "StorageIOError", cause: error };
    case "QueryFailed":
      // Check for UNIQUE CONSTRAINT violations (conflicts)
      if (
        error.reason.includes("duplicate key value violates unique constraint") ||
        error.reason.includes("unique constraint") ||
        error.reason.includes("duplicate") ||
        error.reason.includes("already exists")
      ) {
        return { _tag: "ConflictError", message: error.reason };
      }
      
      // Check for NOT FOUND errors
      if (
        error.reason.includes("not found") ||
        error.reason.includes("does not exist")
      ) {
        return { _tag: "NotFound", entity: "Unknown", id: "unknown" };
      }
      
      // Check for FOREIGN KEY violations
      if (
        error.reason.includes("foreign key") ||
        error.reason.includes("violates foreign key constraint")
      ) {
        return { _tag: "ValidationError", errors: [error.reason] };
      }
      
      return { _tag: "StorageIOError", cause: error };
    case "TransactionFailed":
      return { _tag: "StorageIOError", cause: error };
    default:
      return { _tag: "StorageIOError", cause: error };
  }
}

/**
 * API error mapping from domain errors to HTTP responses
 */
function mapToApiError(error: unknown): ApiErrorResponse {
	// Handle FiberFailure with JSON message (Effect errors)
	if (error instanceof Error && error.message.startsWith("{")) {
		try {
			const parsedError = JSON.parse(error.message);
			if (parsedError._tag) {
				// If it's a DatabaseError, map it to StorageError first
				if (parsedError._tag === "QueryFailed" || parsedError._tag === "ConnectionFailed" || parsedError._tag === "TransactionFailed") {
					const storageError = mapDatabaseError(parsedError);
					return mapToApiError(storageError);
				}
				// Otherwise treat as already a domain error
				return mapToApiError(parsedError);
			}
		} catch {
			// Fall through to default error handling
		}
	}

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
			
			case "RateLimitExceeded":
				return {
					error: {
						type: "RateLimitExceeded",
						message: taggedError.message || "Rate limit exceeded",
						retry_after: taggedError.retry_after,
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

function respondWithValidationError(
	set: { status?: number } | undefined,
	details: ReadonlyArray<{ field: string; message: string; code: string }>,
	status: number = 400,
) {
	if (set) {
		set.status = status;
	}

	return {
		error: {
			type: "ValidationError",
			message: "Validation failed",
			details: details.length ? details : undefined,
		},
	};
}

/**
 * Properly handle Effect errors and return HTTP responses
 */
function handleEffectError(error: unknown, set?: { status?: number }): any {
	// Extract original error from FiberFailure per Effect.js documentation
	let originalError = error;
	
	if (error && typeof error === 'object' && 'error' in error) {
		originalError = (error as any).error;
	}
	
	if (typeof originalError === "object" && originalError !== null && (originalError as any)._tag === "ParseError") {
		return respondWithValidationError(set, [{ field: "body", message: "Request payload failed validation", code: "SCHEMA_PARSE_ERROR" }]);
	}

	// If it's still a FiberFailure with JSON message, parse it
	if (originalError instanceof Error && originalError.message.startsWith("{")) {
		try {
			const parsedError = JSON.parse(originalError.message);
			if (parsedError._tag) {
				// Map database errors to domain errors
				if (parsedError._tag === "QueryFailed" || parsedError._tag === "ConnectionFailed" || parsedError._tag === "TransactionFailed") {
					originalError = mapDatabaseError(parsedError);
				} else {
					originalError = parsedError;
				}
			}
		} catch {
			// Use the error as-is
		}
	}
	
	const statusCode = getHttpStatusFromError(originalError);
	const apiError = mapToApiError(originalError);
	
	if (set) {
		set.status = statusCode;
	}
	
	return apiError;
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
		throw {
			_tag: "RateLimitExceeded",
			message: `Rate limit exceeded for ${operation} operations`,
			retry_after: Math.ceil((result.retry_after_ms || 0) / 1000),
		};
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
			async ({ body, headers, set }) => {
				const sessionContext = getOrCreateSession(headers["x-session-id"]);
				try {
					checkRateLimit(sessionContext.rate_limiter, "draft");
				} catch (error) {
					return handleEffectError(error, set);
				}

				try {
					const request = Schema.decodeUnknownSync(SaveDraftRequest)(body);
					const response = await Effect.runPromise(deps.storage.saveDraft(request));
					return response;
				} catch (error) {
					return handleEffectError(error, set);
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

		.get("/drafts/:note_id", async ({ params, set }) => {
			try {
				const draft = await Effect.runPromise(
					deps.storage.getDraft(params.note_id as any),
				);
				return draft;
			} catch (error) {
				return handleEffectError(error, set);
			}
		})

		// Publication operations
		.post(
			"/publish",
			async ({ body, headers, set }) => {
				const sessionContext = getOrCreateSession(headers["x-session-id"]);
				try {
					checkRateLimit(sessionContext.rate_limiter, "mutation");
				} catch (error) {
					return handleEffectError(error, set);
				}

				try {
					const request = Schema.decodeUnknownSync(PublishRequest)(body);

					const note = await Effect.runPromise(deps.storage.getNote(request.note_id));
					const titleLength = note.title.trim().length;
					if (titleLength < 1 || titleLength > 200) {
						return respondWithValidationError(set, [{ field: "title", message: "Title must be between 1 and 200 characters", code: "TITLE_LENGTH_RANGE" }]);
					}

					// Step 1: Publish version to storage
					const publishResponse = await Effect.runPromise(deps.storage.publishVersion(request));
					
					// Step 2: Emit visibility event for indexing
					const visibilityEvent = {
						event_id: `evt_${Date.now()}`,
						timestamp: new Date(),
						schema_version: "1.0.0",
						type: "VisibilityEvent" as const,
						version_id: publishResponse.version_id,
						op: "publish" as const,
						collections: request.collections,
					};
					
					// Trigger indexing pipeline
					await Effect.runPromise(deps.indexing.enqueueVisibilityEvent(visibilityEvent));
					
					return {
						...publishResponse,
						indexing_started: true,
					};
				} catch (error) {
					return handleEffectError(error, set);
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
			async ({ body, headers, set }) => {
				const sessionContext = getOrCreateSession(headers["x-session-id"]);
				try {
					checkRateLimit(sessionContext.rate_limiter, "mutation");
				} catch (error) {
					return handleEffectError(error, set);
				}

				try {
					const request = Schema.decodeUnknownSync(RollbackRequest)(body);
					
					// Step 1: Perform rollback in storage
					const rollbackResponse = await Effect.runPromise(deps.storage.rollbackToVersion(request));

					const rollbackCollections = await Effect.runPromise(
						deps.storage.getNoteCollections(request.note_id),
					);
					const rollbackCollectionIds = rollbackCollections.map((collection) => collection.id);
					if (rollbackCollectionIds.length === 0) {
						return respondWithValidationError(set, [{ field: "collections", message: "Rollback visibility requires at least one collection", code: "COLLECTION_REQUIRED" }], 409);
					}

					// Step 2: Emit visibility event for indexing
					const visibilityEvent = {
						event_id: `evt_${Date.now()}`,
						timestamp: new Date(),
						schema_version: "1.0.0",
						type: "VisibilityEvent" as const,
						version_id: rollbackResponse.new_version_id,
						op: "rollback" as const,
						collections: rollbackCollectionIds,
					};
					
					// Trigger indexing pipeline
					await Effect.runPromise(deps.indexing.enqueueVisibilityEvent(visibilityEvent));
					
					return {
						...rollbackResponse,
						indexing_started: true,
					};
				} catch (error) {
					return handleEffectError(error, set);
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
		.get("/search", async ({ request, headers, set }) => {
			const sessionContext = getOrCreateSession(headers["x-session-id"]);
			try {
				checkRateLimit(sessionContext.rate_limiter, "query");
			} catch (error) {
				return handleEffectError(error, set);
			}

			try {
				const url = new URL(request.url);
				const queryText = url.searchParams.get("q");
				if (!queryText || queryText.trim().length === 0) {
					return respondWithValidationError(set, [{ field: "q", message: "Query text is required", code: "QUERY_REQUIRED" }]);
				}

				const collectionParams = url.searchParams.getAll("collections");
				const pageParam = url.searchParams.get("page");
				const pageSizeParam = url.searchParams.get("page_size");

				const searchRequest: SearchRequest = {
					q: queryText,
					collections: collectionParams.length ? (collectionParams as any[]) : undefined,
					page: pageParam ? Number.parseInt(pageParam, 10) : undefined,
					page_size: pageSizeParam ? Number.parseInt(pageSizeParam, 10) : undefined,
				};

				const searchResponse = await Effect.runPromise(deps.indexing.search(searchRequest));

				if (searchResponse.answer) {
					const citations = searchResponse.citations ?? [];
					if (citations.length === 0) {
						return respondWithValidationError(set, [{ field: "answer.citations", message: "Answer must include at least one citation", code: "CITATION_REQUIRED" }], 409);
					}
					if (citations.length > 3) {
						return respondWithValidationError(set, [{ field: "answer.citations", message: "Answer may include at most three citations", code: "CITATION_LIMIT" }], 422);
					}

					const missingCitation = searchResponse.answer.citations.find((citationId) => !citations.some((citation) => citation.id === citationId));
					if (missingCitation) {
						return respondWithValidationError(set, [{ field: "answer.citations", message: `Citation ${missingCitation} is missing from response body`, code: "CITATION_MISSING" }], 409);
					}

					const uniqueAnswerCitationCount = new Set(searchResponse.answer.citations).size;
					if (uniqueAnswerCitationCount !== searchResponse.answer.citations.length) {
						return respondWithValidationError(set, [{ field: "answer.citations", message: "Duplicate citation identifiers are not allowed", code: "CITATION_DUPLICATE" }], 409);
					}
				}

				if (searchRequest.collections && searchRequest.collections.length > 0) {
					const allowedCollections = new Set(searchRequest.collections as readonly string[]);
					const invalidResult = searchResponse.results.find((result) => result.collection_ids.some((collectionId) => !allowedCollections.has(collectionId as string)));
					if (invalidResult) {
						return respondWithValidationError(set, [{ field: "results", message: "Search results must respect requested collections scope", code: "SCOPE_VIOLATION" }], 409);
					}
				}

				return searchResponse;
			} catch (error) {
				return handleEffectError(error, set);
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
		.get("/collections", async ({ query, set }) => {
			try {
				const collections = await Effect.runPromise(
					deps.storage.listCollections({
						offset: query.offset ? Number.parseInt(query.offset, 10) : undefined,
						limit: query.limit ? Number.parseInt(query.limit, 10) : undefined,
					}),
				);
				return { collections };
			} catch (error) {
				return handleEffectError(error, set);
			}
		})

		.post(
			"/collections",
			async ({ body, set }) => {
				try {
					const collection = await Effect.runPromise(
						deps.storage.createCollection(body.name, body.description),
					);
					return collection;
				} catch (error) {
					return handleEffectError(error, set);
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
