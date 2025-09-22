import { createApp } from "./http/app";

const port = Number.parseInt(Bun.env.PORT ?? "3000", 10);

const app = createApp();

if (import.meta.main) {
	app.listen({ port });
	console.log(`knowledge API listening on http://localhost:${port}`);
}

export type KnowledgeApp = typeof app;
