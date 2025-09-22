#!/usr/bin/env bun
/**
 * Database migration script
 */
import { Effect } from "effect";
import {
  createDatabasePool,
  createMigrationManager,
} from "../src/adapters/storage/database";

async function runMigrations() {
  console.log("[ARCH] Running database migrations...");

  try {
    // Create database connection
    const db = createDatabasePool();
    const migrationManager = createMigrationManager(db);

    // Test connection
    console.log("[TARGET] Testing database connection...");
    await Effect.runPromise(db.testConnection());
    console.log("[OK] Database connection successful");

    // Run migrations
    console.log("[ARCH] Running migrations...");
    const result = await Effect.runPromise(migrationManager.runMigrations());

    if (result.applied.length > 0) {
      console.log(`[OK] Applied migrations: ${result.applied.join(", ")}`);
    } else {
      console.log("[OK] No new migrations to apply");
    }

    // Close connection
    await Effect.runPromise(db.close());
    console.log("[OK] Migration complete");
  } catch (error) {
    console.error("[ERR] Migration failed:", error);
    process.exit(1);
  }
}

if (import.meta.main) {
  runMigrations();
}
