/**
 * Retrieval policy defaults defined in DESIGN-SPEC-LOW.md.
 * Deterministic ordering is guaranteed when consumers honour these defaults
 * or register workspace overrides via {@link resolveRetrievalPolicy}.
 */
export interface RetrievalPolicyConfig {
  readonly topKRetrieve: number;
  readonly topKRerank: number;
  readonly pageSize: number;
  readonly stableSort: readonly ["score", "version_id", "passage_id"];
  readonly rerankBackoff: {
    /** Target P95 latency threshold in milliseconds. */
    readonly thresholdMs: number;
    /** Rerank cap used when the threshold is breached within a session. */
    readonly sessionTopKRerank: number;
  };
}

export interface RetrievalPolicy extends RetrievalPolicyConfig {
  /** True when overrides preserve deterministic ordering guarantees. */
  readonly deterministic: boolean;
}

export const RETRIEVAL_DEFAULTS: RetrievalPolicyConfig = Object.freeze({
  topKRetrieve: 128,
  topKRerank: 64,
  pageSize: 10,
  stableSort: ["score", "version_id", "passage_id"],
  rerankBackoff: {
    thresholdMs: 500,
    sessionTopKRerank: 32
  }
});

export interface RetrievalOverrides {
  readonly topKRetrieve?: number;
  readonly topKRerank?: number;
  readonly pageSize?: number;
}

/**
 * Applies workspace overrides while tracking whether determinism is affected.
 */
export const resolveRetrievalPolicy = (
  overrides: RetrievalOverrides = {}
): RetrievalPolicy => {
  const resolved: RetrievalPolicyConfig = {
    ...RETRIEVAL_DEFAULTS,
    ...overrides,
    stableSort: RETRIEVAL_DEFAULTS.stableSort,
    rerankBackoff: RETRIEVAL_DEFAULTS.rerankBackoff
  };

  const deterministic =
    (overrides.topKRetrieve ?? RETRIEVAL_DEFAULTS.topKRetrieve) ===
      RETRIEVAL_DEFAULTS.topKRetrieve &&
    (overrides.topKRerank ?? RETRIEVAL_DEFAULTS.topKRerank) ===
      RETRIEVAL_DEFAULTS.topKRerank &&
    (overrides.pageSize ?? RETRIEVAL_DEFAULTS.pageSize) ===
      RETRIEVAL_DEFAULTS.pageSize;

  return Object.freeze({ ...resolved, deterministic });
};

export interface RerankBackoffSignal {
  readonly p95LatencyMs: number;
}

/**
 * Implements the session-scoped SLO backoff requirement.
 */
export const enforceRerankBackoff = (
  signal: RerankBackoffSignal,
  policy: RetrievalPolicyConfig = RETRIEVAL_DEFAULTS
): number =>
  signal.p95LatencyMs > policy.rerankBackoff.thresholdMs
    ? policy.rerankBackoff.sessionTopKRerank
    : policy.topKRerank;

