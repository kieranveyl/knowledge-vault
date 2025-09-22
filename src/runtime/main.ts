import { Effect } from "effect";
import { createApp } from "./http/app";
import { createKnowledgeApiApp, type ApiAdapterDependencies } from "../adapters/api/elysia.adapter";

// Import adapters directly
import { createMemoryStorageAdapter } from "../adapters/storage/memory.adapter";
import { createOramaSearchAdapter } from "../adapters/search/orama.adapter";
import { createMarkdownParsingAdapter } from "../adapters/parsing/markdown.adapter";
import { createLocalObservabilityAdapter } from "../adapters/observability/local.adapter";

const port = Number.parseInt(Bun.env.PORT ?? "3001", 10); // Port 3001 to avoid conflict with ElectricSQL

/**
 * Simple dependency injection for now
 */
async function createDependencies(): Promise<ApiAdapterDependencies> {
	console.log("🔧 Setting up application dependencies...");
	
	// Create adapters (using memory storage for now)
	const storage = createMemoryStorageAdapter();
	const indexing = createOramaSearchAdapter();
	const parsing = createMarkdownParsingAdapter();
	const observability = createLocalObservabilityAdapter();

	// Initialize workspace
	console.log("📁 Initializing workspace...");
	await Effect.runPromise(storage.initializeWorkspace());

	// Record startup metrics
	await Effect.runPromise(observability.recordCounter("system.startup_total", 1));

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
			await Effect.runPromise(deps.observability.recordCounter("system.shutdown_total", 1));
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
