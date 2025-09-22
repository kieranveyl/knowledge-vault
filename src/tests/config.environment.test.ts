import { describe, expect, it } from "bun:test";
import { config } from "../config/environment";

describe("environment config", () => {
	it("exports numeric ports and positive rate limits", () => {
		expect(Number.isInteger(config.server.port)).toBe(true);
		expect(config.server.port).toBeGreaterThan(0);

		expect(Number.isInteger(config.database.port)).toBe(true);
		expect(config.database.port).toBeGreaterThan(0);

		expect(config.rateLimits.queries.burstPerSecond).toBeGreaterThan(0);
		expect(config.rateLimits.mutations.windowSeconds).toBeGreaterThan(0);
		expect(config.rateLimits.drafts.sustainedPerMinute).toBeGreaterThan(0);
	});

	it("respects boolean feature flags", () => {
		expect(typeof config.features.usePostgres).toBe("boolean");
		expect(typeof config.features.autoMigrate).toBe("boolean");
		expect(typeof config.observability.enabled).toBe("boolean");
	});
});
