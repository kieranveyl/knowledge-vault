import { Elysia } from "elysia";
import { Effect } from "effect";

import {
	RETRIEVAL_DEFAULTS,
	resolveRetrievalPolicy,
	enforceRerankBackoff,
} from "../../policy/retrieval";
import {
	TOKENIZATION_POLICY,
	DEFAULT_TOKENIZATION_CAPABILITIES,
} from "../../policy/tokenization";
import { runEffect } from "../effect";

export const createApp = () =>
	new Elysia({ name: "knowledge-api" })
		.get("/healthz", () => ({ status: "ok" }))
		.get("/status", () =>
			runEffect(
				Effect.succeed({
					runtime: "bun",
					framework: "elysia",
					effect: "effect-ts",
					policies: {
						retrieval: resolveRetrievalPolicy(),
						tokenization: TOKENIZATION_POLICY,
						tokenizationCapabilities: DEFAULT_TOKENIZATION_CAPABILITIES,
					},
				}),
			),
		)
		.get("/policy/retrieval", ({ query }) =>
			runEffect(
				Effect.sync(() => {
					const topKRerank = Number.parseInt(query?.topKRerank ?? "", 10);

					const overrides = Number.isFinite(topKRerank)
						? { topKRerank }
						: undefined;

					return {
						defaults: RETRIEVAL_DEFAULTS,
						resolved: resolveRetrievalPolicy(overrides),
						backoffSample: enforceRerankBackoff({ p95LatencyMs: 600 }),
					};
				}),
			),
		);
