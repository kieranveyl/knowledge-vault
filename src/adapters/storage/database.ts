/**
 * Database connection and migration management
 *
 * Handles PostgreSQL connection setup and schema migrations
 */

import { Effect } from "effect";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool, type PoolConfig } from "pg";
import { config } from "../../config/environment";

/**
 * Database configuration
 */
export interface DatabaseConfig {
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly user: string;
  readonly password: string;
  readonly ssl?: boolean;
  readonly maxConnections?: number;
}

/**
 * Default database configuration for development
 */
export const DEFAULT_DATABASE_CONFIG: DatabaseConfig = {
  host: config.database.host,
  port: config.database.port,
  database: config.database.name,
  user: config.database.user,
  password: config.database.password,
  ssl: config.database.ssl,
  maxConnections: config.database.maxConnections,
};

/**
 * Database error types
 */
export type DatabaseError =
  | { readonly _tag: "ConnectionFailed"; readonly reason: string }
  | {
      readonly _tag: "MigrationFailed";
      readonly migration: string;
      readonly reason: string;
    }
  | {
      readonly _tag: "QueryFailed";
      readonly query: string;
      readonly reason: string;
    }
  | { readonly _tag: "TransactionFailed"; readonly reason: string };

/**
 * Migration record
 */
export interface Migration {
  readonly id: number;
  readonly name: string;
  readonly sql: string;
  readonly applied_at: Date;
}

/**
 * Database connection pool wrapper
 */
export class DatabasePool {
  private pool: Pool;

  constructor(config: DatabaseConfig = DEFAULT_DATABASE_CONFIG) {
    const poolConfig: PoolConfig = {
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      ssl: config.ssl,
      max: config.maxConnections || 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    };

    this.pool = new Pool(poolConfig);
  }

  /**
   * Tests database connection
   */
  readonly testConnection = (): Effect.Effect<void, DatabaseError> =>
    Effect.promise(async () => {
      try {
        const client = await this.pool.connect();
        await client.query("SELECT 1");
        client.release();
      } catch (error) {
        throw {
          _tag: "ConnectionFailed",
          reason:
            error instanceof Error ? error.message : "Unknown connection error",
        };
      }
    });

  /**
   * Executes a query
   */
  readonly query = <T = any>(
    text: string,
    params?: any[],
  ): Effect.Effect<T[], DatabaseError> =>
    Effect.promise(async () => {
      try {
        const result = await this.pool.query(text, params);
        return result.rows;
      } catch (error) {
        throw {
          _tag: "QueryFailed",
          query: text,
          reason:
            error instanceof Error ? error.message : "Unknown query error",
        };
      }
    });

  /**
   * Executes multiple queries in a transaction
   */
  readonly transaction = <T>(
    operations: (query: typeof this.query) => Effect.Effect<T, DatabaseError>,
  ): Effect.Effect<T, DatabaseError> =>
    Effect.promise(async () => {
      const client = await this.pool.connect();

      try {
        await client.query("BEGIN");

        const transactionQuery = <R = any>(
          text: string,
          params?: any[],
        ): Effect.Effect<R[], DatabaseError> =>
          Effect.promise(async () => {
            try {
              const result = await client.query(text, params);
              return result.rows;
            } catch (error) {
              throw {
                _tag: "QueryFailed",
                query: text,
                reason:
                  error instanceof Error
                    ? error.message
                    : "Transaction query failed",
              };
            }
          });

        const result = await Effect.runPromise(operations(transactionQuery));
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw {
          _tag: "TransactionFailed",
          reason: error instanceof Error ? error.message : "Transaction failed",
        };
      } finally {
        client.release();
      }
    });

  /**
   * Closes the connection pool
   */
  readonly close = (): Effect.Effect<void, never> =>
    Effect.promise(async () => {
      await this.pool.end();
    });

  /**
   * Gets pool status
   */
  readonly getStatus = (): Effect.Effect<
    {
      readonly totalCount: number;
      readonly idleCount: number;
      readonly waitingCount: number;
    },
    never
  > =>
    Effect.sync(() => ({
      totalCount: this.pool.totalCount,
      idleCount: this.pool.idleCount,
      waitingCount: this.pool.waitingCount,
    }));
}

/**
 * Migration manager for database schema updates
 */
export class MigrationManager {
  constructor(private readonly db: DatabasePool) {}

  /**
   * Initializes migration tracking table
   */
  readonly initializeMigrations = (): Effect.Effect<void, DatabaseError> =>
    this.db
      .query(
        `
			CREATE TABLE IF NOT EXISTS schema_migrations (
				id SERIAL PRIMARY KEY,
				name TEXT NOT NULL UNIQUE,
				applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
			)
		`,
      )
      .pipe(Effect.asVoid);

  /**
   * Gets applied migrations
   */
  readonly getAppliedMigrations = (): Effect.Effect<
    readonly Migration[],
    DatabaseError
  > =>
    this.db.query<Migration>(`
			SELECT id, name, applied_at
			FROM schema_migrations
			ORDER BY id ASC
		`);

  /**
   * Applies a migration
   */
  readonly applyMigration = (
    name: string,
    sql: string,
  ): Effect.Effect<void, DatabaseError> =>
    this.db.transaction((query) =>
      Effect.gen(this, function* () {
        // Check if already applied
        const existing = yield* query<{ count: string }>(
          "SELECT COUNT(*) as count FROM schema_migrations WHERE name = $1",
          [name],
        );

        if (existing[0].count !== "0") {
          return; // Already applied
        }

        // Apply migration
        yield* query(sql);

        // Record migration
        yield* query("INSERT INTO schema_migrations (name) VALUES ($1)", [
          name,
        ]);
      }).pipe(
        Effect.catchAll((error) =>
          Effect.fail({
            _tag: "MigrationFailed",
            migration: name,
            reason: error instanceof Error ? error.message : "Migration failed",
          } as DatabaseError),
        ),
      ),
    );

  /**
   * Runs all pending migrations
   */
  readonly runMigrations = (): Effect.Effect<
    { applied: readonly string[] },
    DatabaseError
  > =>
    Effect.gen(this, function* () {
      yield* this.initializeMigrations();

      const appliedMigrations = yield* this.getAppliedMigrations();
      const appliedNames = new Set(appliedMigrations.map((m) => m.name));

      // Load migration files
      const migrationDir = join(__dirname, "migrations");
      const migrationFiles = ["001_initial_schema.sql"]; // TODO: Read from filesystem
      const appliedNames_: string[] = [];

      for (const file of migrationFiles) {
        const migrationName = file.replace(".sql", "");

        if (!appliedNames.has(migrationName)) {
          try {
            const sql = readFileSync(join(migrationDir, file), "utf-8");
            yield* this.applyMigration(migrationName, sql);
            appliedNames_.push(migrationName);
          } catch (error) {
            yield* Effect.fail({
              _tag: "MigrationFailed",
              migration: migrationName,
              reason:
                error instanceof Error
                  ? error.message
                  : "Failed to read migration file",
            } as DatabaseError);
          }
        }
      }

      return { applied: appliedNames_ };
    });
}

/**
 * Creates database pool with configuration
 */
export function createDatabasePool(
  overrides?: Partial<DatabaseConfig>,
): DatabasePool {
  const fullConfig = { ...DEFAULT_DATABASE_CONFIG, ...overrides };
  return new DatabasePool(fullConfig);
}

/**
 * Creates migration manager
 */
export function createMigrationManager(db: DatabasePool): MigrationManager {
  return new MigrationManager(db);
}

/**
 * Gets database configuration from environment
 */
export function getDatabaseConfigFromEnv(): DatabaseConfig {
  return { ...DEFAULT_DATABASE_CONFIG };
}
