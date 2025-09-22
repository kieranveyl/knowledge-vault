/**
 * Runtime layers for dependency injection
 * 
 * References SCAFFOLD.md Phase 5: "runtime/layers/* binds ports→adapters"
 * Composes all adapters and creates the application layer
 */

import { Effect, Layer, Context } from "effect";
import type {
	StoragePort,
	IndexingPort,
	ParsingPort,
	ObservabilityPort,
} from "../services";

import {
	createDatabasePool,
	createMigrationManager,
	type DatabasePool,
} from "../adapters/storage/database";

import { createPostgresStorageAdapter } from "../adapters/storage/postgres.adapter";
import { createMemoryStorageAdapter } from "../adapters/storage/memory.adapter";
import { createOramaSearchAdapter } from "../adapters/search/orama.adapter";
import { createMarkdownParsingAdapter } from "../adapters/parsing/markdown.adapter";
import { createLocalObservabilityAdapter } from "../adapters/observability/local.adapter";

import type { ApiAdapterDependencies } from "../adapters/api/elysia.adapter";
import { config } from "../config/environment";

/**
 * Database layer - provides database connection
 */
export const DatabaseLayer = Layer.effect(
	Context.GenericTag<DatabasePool>("DatabasePool"),
	Effect.gen(function* () {
		const pool = createDatabasePool();
		
		// Test connection
		yield* pool.testConnection().pipe(
			Effect.catchAll(() => 
				Effect.logWarning("Database connection failed - using memory storage as fallback")
			)
		);

		return pool;
	}),
);

/**
 * Storage layer - provides storage implementation
 */
export const StorageLayer = Layer.effect(
	Context.GenericTag<StoragePort>("StoragePort"),
	Effect.gen(function* () {
		if (config.features.usePostgres) {
			try {
				const db = yield* Context.get(Context.GenericTag<DatabasePool>("DatabasePool"));
				
				// Run migrations if enabled
				if (config.features.autoMigrate) {
					const migrationManager = createMigrationManager(db);
					const result = yield* migrationManager.runMigrations();
					
					if (result.applied.length > 0) {
						yield* Effect.log(`Applied ${result.applied.length} database migrations`);
					}
				}

				yield* Effect.log("Using PostgreSQL storage adapter");
				return createPostgresStorageAdapter(db);
			} catch (error) {
				yield* Effect.logWarning(`PostgreSQL setup failed: ${error}, falling back to memory storage`);
				return createMemoryStorageAdapter();
			}
		} else {
			yield* Effect.log("Using memory storage adapter");
			return createMemoryStorageAdapter();
		}
	}),
).pipe(Layer.provide(DatabaseLayer));

/**
 * Indexing layer - provides search implementation
 */
export const IndexingLayer = Layer.effect(
	Context.GenericTag<IndexingPort>("IndexingPort"),
	Effect.gen(function* () {
		yield* Effect.log("Using Orama search adapter");
		return createOramaSearchAdapter();
	}),
);

/**
 * Parsing layer - provides content processing
 */
export const ParsingLayer = Layer.effect(
	Context.GenericTag<ParsingPort>("ParsingPort"),
	Effect.gen(function* () {
		yield* Effect.log("Using Markdown parsing adapter");
		return createMarkdownParsingAdapter();
	}),
);

/**
 * Observability layer - provides metrics and telemetry
 */
export const ObservabilityLayer = Layer.effect(
	Context.GenericTag<ObservabilityPort>("ObservabilityPort"),
	Effect.gen(function* () {
		const config = getAppConfigFromEnv();
		
		if (config.observability.enabled) {
			yield* Effect.log("Using local observability adapter");
			return createLocalObservabilityAdapter();
		} else {
			yield* Effect.log("Observability disabled");
			// Return no-op implementation
			return createLocalObservabilityAdapter();
		}
	}),
);

/**
 * Application dependencies layer - combines all services
 */
export const AppDependenciesLayer = Layer.effect(
	Context.GenericTag<ApiAdapterDependencies>("ApiAdapterDependencies"),
	Effect.gen(function* () {
		const storage = yield* Context.get(Context.GenericTag<StoragePort>("StoragePort"));
		const indexing = yield* Context.get(Context.GenericTag<IndexingPort>("IndexingPort"));
		const parsing = yield* Context.get(Context.GenericTag<ParsingPort>("ParsingPort"));
		const observability = yield* Context.get(Context.GenericTag<ObservabilityPort>("ObservabilityPort"));

		return {
			storage,
			indexing,
			parsing,
			observability,
		};
	}),
).pipe(
	Layer.provide(StorageLayer),
	Layer.provide(IndexingLayer),
	Layer.provide(ParsingLayer),
	Layer.provide(ObservabilityLayer)
);

/**
 * Main application layer
 */
export const MainLayer = Layer.mergeAll(
	DatabaseLayer,
	StorageLayer,
	IndexingLayer,
	ParsingLayer,
	ObservabilityLayer,
	AppDependenciesLayer,
);

/**
 * Initializes application with all dependencies
 */
export const initializeApp = (): Effect.Effect<ApiAdapterDependencies, never> =>
	Effect.gen(function* () {
		yield* Effect.log("Initializing knowledge repository application...");
		
		const deps = yield* Context.get(Context.GenericTag<ApiAdapterDependencies>("ApiAdapterDependencies"));
		
		// Initialize workspace
		yield* deps.storage.initializeWorkspace().pipe(
			Effect.catchAll(error => 
				Effect.logWarning(`Workspace initialization failed: ${JSON.stringify(error)}`)
			)
		);

		// Record startup event
		yield* deps.observability.recordCounter("system.startup_total", 1);
		yield* deps.observability.recordHealthStatus("application", {
			component: "application",
			status: "healthy",
			last_check: new Date(),
		});

		yield* Effect.log("Application initialized successfully");
		return deps;
	}).pipe(
		Effect.provide(MainLayer)
	);

/**
 * Application shutdown cleanup
 */
export const shutdownApp = (deps: ApiAdapterDependencies): Effect.Effect<void, never> =>
	Effect.gen(function* () {
		yield* Effect.log("Shutting down application...");

		// Record shutdown event
		yield* deps.observability.recordCounter("system.shutdown_total", 1).pipe(
			Effect.catchAll(() => Effect.void)
		);

		// Perform storage maintenance
		yield* deps.storage.performMaintenance().pipe(
			Effect.catchAll(() => Effect.void)
		);

		yield* Effect.log("Application shutdown complete");
	});
