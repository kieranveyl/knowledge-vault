import { Schema } from "@effect/schema";
import dotenv from "dotenv";

// Load environment variables as early as possible
dotenv.config();

const RawEnvironmentSchema = Schema.Struct({
  NODE_ENV: Schema.optional(Schema.String),
  PORT: Schema.optional(Schema.String),
  SERVER_PORT: Schema.optional(Schema.String),
  DB_HOST: Schema.optional(Schema.String),
  DB_PORT: Schema.optional(Schema.String),
  DB_NAME: Schema.optional(Schema.String),
  DB_USER: Schema.optional(Schema.String),
  DB_PASSWORD: Schema.optional(Schema.String),
  DB_SSL: Schema.optional(Schema.String),
  DB_MAX_CONNECTIONS: Schema.optional(Schema.String),
  USE_POSTGRES: Schema.optional(Schema.String),
  AUTO_MIGRATE: Schema.optional(Schema.String),
  OBSERVABILITY_ENABLED: Schema.optional(Schema.String),
  TELEMETRY_RETENTION_DAYS: Schema.optional(Schema.String),
  RATE_LIMIT_QUERY_BURST: Schema.optional(Schema.String),
  RATE_LIMIT_QUERY_SUSTAINED: Schema.optional(Schema.String),
  RATE_LIMIT_MUTATION_BURST: Schema.optional(Schema.String),
  RATE_LIMIT_MUTATION_WINDOW_SECONDS: Schema.optional(Schema.String),
  RATE_LIMIT_MUTATION_SUSTAINED: Schema.optional(Schema.String),
  RATE_LIMIT_DRAFT_BURST: Schema.optional(Schema.String),
  RATE_LIMIT_DRAFT_SUSTAINED: Schema.optional(Schema.String),
});

type RawEnvironment = Schema.Schema.Type<typeof RawEnvironmentSchema>;

const ConfigSchema = Schema.Struct({
  nodeEnv: Schema.Union(
    Schema.Literal("development"),
    Schema.Literal("test"),
    Schema.Literal("production"),
  ),
  server: Schema.Struct({
    port: Schema.Number.pipe(Schema.int(), Schema.greaterThan(0)),
  }),
  database: Schema.Struct({
    host: Schema.String,
    port: Schema.Number.pipe(Schema.int(), Schema.greaterThan(0)),
    name: Schema.String,
    user: Schema.String,
    password: Schema.String,
    ssl: Schema.Boolean,
    maxConnections: Schema.Number.pipe(Schema.int(), Schema.greaterThan(0)),
  }),
  features: Schema.Struct({
    usePostgres: Schema.Boolean,
    autoMigrate: Schema.Boolean,
  }),
  observability: Schema.Struct({
    enabled: Schema.Boolean,
    retentionDays: Schema.Number.pipe(
      Schema.int(),
      Schema.greaterThanOrEqualTo(0),
    ),
  }),
  rateLimits: Schema.Struct({
    queries: Schema.Struct({
      burstPerSecond: Schema.Number.pipe(Schema.int(), Schema.greaterThan(0)),
      sustainedPerMinute: Schema.Number.pipe(
        Schema.int(),
        Schema.greaterThan(0),
      ),
    }),
    mutations: Schema.Struct({
      burstPerWindow: Schema.Number.pipe(Schema.int(), Schema.greaterThan(0)),
      windowSeconds: Schema.Number.pipe(Schema.int(), Schema.greaterThan(0)),
      sustainedPerMinute: Schema.Number.pipe(
        Schema.int(),
        Schema.greaterThan(0),
      ),
    }),
    drafts: Schema.Struct({
      burstPerSecond: Schema.Number.pipe(Schema.int(), Schema.greaterThan(0)),
      sustainedPerMinute: Schema.Number.pipe(
        Schema.int(),
        Schema.greaterThan(0),
      ),
    }),
  }),
});

export type AppConfig = Schema.Schema.Type<typeof ConfigSchema>;

const rawEnv = Schema.decodeUnknownSync(RawEnvironmentSchema)(process.env);

const defaults = {
  nodeEnv: "development" as const,
  server: { port: 3001 },
  database: {
    host: "localhost",
    port: 54321,
    name: "knowledge",
    user: "postgres",
    password: "password",
    ssl: false,
    maxConnections: 10,
  },
  features: {
    usePostgres: true,
    autoMigrate: true,
  },
  observability: {
    enabled: true,
    retentionDays: 30,
  },
  rateLimits: {
    queries: {
      burstPerSecond: 5,
      sustainedPerMinute: 60,
    },
    mutations: {
      burstPerWindow: 1,
      windowSeconds: 5,
      sustainedPerMinute: 12,
    },
    drafts: {
      burstPerSecond: 10,
      sustainedPerMinute: 300,
    },
  },
} as const;

const truthyPattern = /^(true|1|yes|on)$/i;
const falsyPattern = /^(false|0|no|off)$/i;

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }
  if (truthyPattern.test(value)) {
    return true;
  }
  if (falsyPattern.test(value)) {
    return false;
  }
  throw new Error(`Invalid boolean value: ${value}`);
}

function parseNumber(
  value: string | undefined,
  fallback: number,
  label: string,
): number {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid number for ${label}: ${value}`);
  }
  return parsed;
}

const nodeEnv = (rawEnv.NODE_ENV ?? defaults.nodeEnv).toLowerCase();

const candidateConfig = {
  nodeEnv,
  server: {
    port: parseNumber(
      rawEnv.SERVER_PORT ?? rawEnv.PORT,
      defaults.server.port,
      "SERVER_PORT",
    ),
  },
  database: {
    host: rawEnv.DB_HOST ?? defaults.database.host,
    port: parseNumber(rawEnv.DB_PORT, defaults.database.port, "DB_PORT"),
    name: rawEnv.DB_NAME ?? defaults.database.name,
    user: rawEnv.DB_USER ?? defaults.database.user,
    password: rawEnv.DB_PASSWORD ?? defaults.database.password,
    ssl: parseBoolean(rawEnv.DB_SSL, defaults.database.ssl),
    maxConnections: parseNumber(
      rawEnv.DB_MAX_CONNECTIONS,
      defaults.database.maxConnections,
      "DB_MAX_CONNECTIONS",
    ),
  },
  features: {
    usePostgres: parseBoolean(
      rawEnv.USE_POSTGRES,
      defaults.features.usePostgres,
    ),
    autoMigrate: parseBoolean(
      rawEnv.AUTO_MIGRATE,
      defaults.features.autoMigrate,
    ),
  },
  observability: {
    enabled: parseBoolean(
      rawEnv.OBSERVABILITY_ENABLED,
      defaults.observability.enabled,
    ),
    retentionDays: parseNumber(
      rawEnv.TELEMETRY_RETENTION_DAYS,
      defaults.observability.retentionDays,
      "TELEMETRY_RETENTION_DAYS",
    ),
  },
  rateLimits: {
    queries: {
      burstPerSecond: parseNumber(
        rawEnv.RATE_LIMIT_QUERY_BURST,
        defaults.rateLimits.queries.burstPerSecond,
        "RATE_LIMIT_QUERY_BURST",
      ),
      sustainedPerMinute: parseNumber(
        rawEnv.RATE_LIMIT_QUERY_SUSTAINED,
        defaults.rateLimits.queries.sustainedPerMinute,
        "RATE_LIMIT_QUERY_SUSTAINED",
      ),
    },
    mutations: {
      burstPerWindow: parseNumber(
        rawEnv.RATE_LIMIT_MUTATION_BURST,
        defaults.rateLimits.mutations.burstPerWindow,
        "RATE_LIMIT_MUTATION_BURST",
      ),
      windowSeconds: parseNumber(
        rawEnv.RATE_LIMIT_MUTATION_WINDOW_SECONDS,
        defaults.rateLimits.mutations.windowSeconds,
        "RATE_LIMIT_MUTATION_WINDOW_SECONDS",
      ),
      sustainedPerMinute: parseNumber(
        rawEnv.RATE_LIMIT_MUTATION_SUSTAINED,
        defaults.rateLimits.mutations.sustainedPerMinute,
        "RATE_LIMIT_MUTATION_SUSTAINED",
      ),
    },
    drafts: {
      burstPerSecond: parseNumber(
        rawEnv.RATE_LIMIT_DRAFT_BURST,
        defaults.rateLimits.drafts.burstPerSecond,
        "RATE_LIMIT_DRAFT_BURST",
      ),
      sustainedPerMinute: parseNumber(
        rawEnv.RATE_LIMIT_DRAFT_SUSTAINED,
        defaults.rateLimits.drafts.sustainedPerMinute,
        "RATE_LIMIT_DRAFT_SUSTAINED",
      ),
    },
  },
};

export const config: AppConfig = (() => {
  try {
    return Schema.decodeUnknownSync(ConfigSchema)(candidateConfig);
  } catch (error) {
    console.error("Invalid environment configuration", error);
    throw error;
  }
})();
