import { Effect } from "effect";
import { createApp } from "./http/app";
import { createKnowledgeApiApp, type ApiAdapterDependencies } from "../adapters/api/elysia.adapter";

// Import adapters directly
import { createPostgresStorageAdapter } from "../adapters/storage/postgres.adapter";
import { createMemoryStorageAdapter } from "../adapters/storage/memory.adapter";
import { createDatabasePool, createMigrationManager } from "../adapters/storage/database";
import { createOramaSearchAdapter } from "../adapters/search/orama.adapter";
import { createMarkdownParsingAdapter } from "../adapters/parsing/markdown.adapter";
import { createLocalObservabilityAdapter } from "../adapters/observability/local.adapter";
import { config } from "../config/environment";

const port = config.server.port; // defaults to 3001 to avoid conflict with ElectricSQL

/**
 * Simple dependency injection for now
 */
async function createDependencies(): Promise<ApiAdapterDependencies> {
	console.log("🔧 Setting up application dependencies...");
	
	let storage = createMemoryStorageAdapter();

	if (config.features.usePostgres) {
		console.log("🗄️ Connecting to PostgreSQL database...");
		try {
			const db = createDatabasePool();
			await Effect.runPromise(db.testConnection());
			console.log("✅ Database connection verified");

			if (config.features.autoMigrate) {
				const migrationManager = createMigrationManager(db);
				const result = await Effect.runPromise(migrationManager.runMigrations());
				if (result.applied.length > 0) {
					console.log(`📦 Applied ${result.applied.length} database migrations`);
				}
			}

			storage = createPostgresStorageAdapter(db);
			console.log("🗄️ Using PostgreSQL storage adapter");
		} catch (error) {
			console.warn("⚠️ PostgreSQL setup failed, falling back to in-memory storage", error);
		}
	} else {
		console.log("🗄️ Using in-memory storage adapter (Postgres disabled)");
	}

	// Create adapters
	const indexing = createOramaSearchAdapter();
	const parsing = createMarkdownParsingAdapter();
	const observability = createLocalObservabilityAdapter();

	// Initialize workspace
	console.log("📁 Initializing workspace...");
	await Effect.runPromise(storage.initializeWorkspace());

	// Record startup metrics (when observability is enabled)
	if (config.observability.enabled) {
		await Effect.runPromise(observability.recordCounter("system.startup_total", 1));
	}

	console.log("✅ Dependencies ready");
	return { storage, indexing, parsing, observability };
}

/**
 * Main application startup
 */
async function main() {
	try {
		console.log("🚀 Starting Knowledge Repository...");
		
		// Create dependencies
		const deps = await createDependencies();

		// Create API application
		const apiApp = createKnowledgeApiApp(deps);

		// Start server
		apiApp.listen({ port }, () => {
			console.log(`✅ Knowledge Repository API listening on http://localhost:${port}`);
			console.log(`📊 Health check: http://localhost:${port}/healthz`);
			console.log(`🔍 Search endpoint: http://localhost:${port}/search`);
			console.log(`📝 Draft save: POST http://localhost:${port}/drafts`);
			console.log(`📚 Collections: http://localhost:${port}/collections`);
		});

		// Setup graceful shutdown
		const shutdown = async () => {
			console.log("\n🛑 Shutting down gracefully...");
			if (config.observability.enabled) {
				await Effect.runPromise(deps.observability.recordCounter("system.shutdown_total", 1));
			}
			process.exit(0);
		};

		process.on("SIGINT", shutdown);
		process.on("SIGTERM", shutdown);

		return deps;
	} catch (error) {
		console.error("❌ Application startup failed:", error);
		process.exit(1);
	}
}

if (import.meta.main) {
	main();
}

export type KnowledgeApp = Awaited<ReturnType<typeof main>>;
