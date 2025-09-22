import { describe, expect, it } from "bun:test";

import {
	RETRIEVAL_DEFAULTS,
	resolveRetrievalPolicy,
	enforceRerankBackoff,
} from "../policy/retrieval";

describe("retrieval policy", () => {
	it("returns deterministic policy when no overrides are provided", () => {
		const policy = resolveRetrievalPolicy();

		expect(policy.topKRetrieve).toBe(RETRIEVAL_DEFAULTS.topKRetrieve);
		expect(policy.deterministic).toBe(true);
	});

	it("flags non-deterministic overrides", () => {
		const policy = resolveRetrievalPolicy({ topKRerank: 32 });

		expect(policy.topKRerank).toBe(32);
		expect(policy.deterministic).toBe(false);
	});

	it("reduces rerank window when P95 latency breaches", () => {
		const rerank = enforceRerankBackoff({ p95LatencyMs: 900 });

		expect(rerank).toBe(RETRIEVAL_DEFAULTS.rerankBackoff.sessionTopKRerank);
	});
});
