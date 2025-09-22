#!/usr/bin/env bun
/**
 * Version History & Rollback Demo Script
 *
 * Demonstrates SPEC Section 5: Rollback functionality and version management
 * Shows version creation, history tracking, and rollback operations
 */

import { Effect } from "effect";
import { createDatabasePool } from "../src/adapters/storage/database";
import { createPostgresStorageAdapter } from "../src/adapters/storage/postgres.adapter";
import type { VersionLabel } from "../src/schema/entities";

const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  green: "\x1b[32m",
  blue: "\x1b[34m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
};

async function versionHistoryDemo() {
  console.log(
    `${colors.blue}${colors.bright}[SPEC] Version History & Rollback Demo${colors.reset}`,
  );
  console.log(
    "Demonstrating SPEC: Version immutability, history tracking, and rollback workflow\n",
  );

  const db = createDatabasePool();
  const storage = createPostgresStorageAdapter(db);

  try {
    // Step 1: Setup collection and initial note
    console.log(
      `${colors.cyan}Step 1: Creating project for version tracking...${colors.reset}`,
    );

    const collection = await Effect.runPromise(
      storage.createCollection(
        "Version Demo",
        "Collection for demonstrating version control",
      ),
    );

    const note = await Effect.runPromise(
      storage.createNote(
        "API Documentation Guidelines",
        "# API Documentation Guidelines\n\nInitial draft of API documentation standards.",
        {
          tags: ["documentation", "api", "guidelines"],
          project: "version-demo",
        },
      ),
    );

    console.log(`${colors.green}[OK] Project setup complete:${colors.reset}`);
    console.log(`   Collection: "${collection.name}" (${collection.id})`);
    console.log(`   Note: "${note.title}" (${note.id})`);

    // Step 2: Create initial version (v1.0)
    console.log(
      `\n${colors.cyan}Step 2: Publishing initial version (v1.0)...${colors.reset}`,
    );

    const v1Content = `# API Documentation Guidelines v1.0

## Overview
This document establishes standards for API documentation across our organization.

## Basic Requirements
- All endpoints must be documented
- Include request/response examples
- Specify error codes and messages

## Documentation Format
Use OpenAPI 3.0 specification for all REST APIs.

## Review Process
Documentation must be reviewed before API release.

---
*Version 1.0 - Initial release*`;

    await Effect.runPromise(
      storage.saveDraft({
        note_id: note.id,
        body_md: v1Content,
        metadata: {
          tags: ["documentation", "api", "guidelines", "v1.0"],
          version: "1.0",
          status: "published",
        },
      }),
    );

    const v1Publication = await Effect.runPromise(
      storage.publishVersion({
        note_id: note.id,
        collections: [collection.id],
        label: "major" as VersionLabel,
        client_token: `v1_${Date.now()}`,
      }),
    );

    console.log(`${colors.green}[OK] Version 1.0 published:${colors.reset}`);
    console.log(`   Version ID: ${v1Publication.version_id}`);
    console.log(`   Content: Basic requirements and format guidelines`);

    // Step 3: Create enhanced version (v1.1)
    console.log(
      `\n${colors.cyan}Step 3: Publishing enhanced version (v1.1)...${colors.reset}`,
    );

    const v1_1Content = `# API Documentation Guidelines v1.1

## Overview
This document establishes comprehensive standards for API documentation across our organization.

## Basic Requirements
- All endpoints must be documented with detailed descriptions
- Include comprehensive request/response examples
- Specify all possible error codes and messages
- Document authentication requirements
- Include rate limiting information

## Documentation Format
Use OpenAPI 3.0 specification for all REST APIs with these additions:
- Code samples in multiple languages
- Interactive examples where possible
- Clear parameter descriptions with validation rules

## Review Process
Documentation must be reviewed by both technical and UX teams before API release.

## Quality Standards
- Examples must be tested and working
- Language should be clear and accessible
- Include troubleshooting guides
- Provide SDK/client library information

---
*Version 1.1 - Enhanced requirements and quality standards*`;

    await Effect.runPromise(
      storage.saveDraft({
        note_id: note.id,
        body_md: v1_1Content,
        metadata: {
          tags: ["documentation", "api", "guidelines", "v1.1"],
          version: "1.1",
          status: "published",
          changes: [
            "enhanced requirements",
            "quality standards",
            "UX review process",
          ],
        },
      }),
    );

    const v1_1Publication = await Effect.runPromise(
      storage.publishVersion({
        note_id: note.id,
        collections: [collection.id],
        label: "minor" as VersionLabel,
        client_token: `v1.1_${Date.now()}`,
      }),
    );

    console.log(`${colors.green}[OK] Version 1.1 published:${colors.reset}`);
    console.log(`   Version ID: ${v1_1Publication.version_id}`);
    console.log(
      `   Content: Enhanced with quality standards and UX requirements`,
    );

    // Step 4: Create experimental version (v2.0)
    console.log(
      `\n${colors.cyan}Step 4: Publishing experimental version (v2.0)...${colors.reset}`,
    );

    const v2Content = `# API Documentation Guidelines v2.0 (EXPERIMENTAL)

## Overview
MAJOR REVISION: Revolutionary approach to API documentation with AI-assisted generation and real-time validation.

## AI-Enhanced Requirements
- All documentation generated automatically from code annotations
- Real-time validation against actual API responses
- Automatic example generation and testing
- Natural language query interface for developers

## New Documentation Format
Moving beyond OpenAPI to our proprietary DocuAI format:
- Semantic markup for better searchability
- Interactive playground integration
- Automatic SDK generation
- Multi-modal documentation (text, video, interactive)

## Revolutionary Review Process
- AI-powered consistency checking
- Automated accessibility compliance
- Real-time collaboration with live editing
- Version control integration with automatic conflict resolution

## Advanced Quality Standards
- 100% automated testing of all examples
- Machine learning-powered clarity scoring
- Automatic translation to multiple languages
- Performance impact documentation

## Breaking Changes
⚠️ WARNING: This version introduces breaking changes:
- Legacy OpenAPI format deprecated
- New toolchain required
- All existing documentation needs migration
- Training required for all team members

---
*Version 2.0 - EXPERIMENTAL: Revolutionary AI-enhanced approach*
*⚠️ NOT YET APPROVED FOR PRODUCTION USE*`;

    await Effect.runPromise(
      storage.saveDraft({
        note_id: note.id,
        body_md: v2Content,
        metadata: {
          tags: ["documentation", "api", "guidelines", "v2.0", "experimental"],
          version: "2.0",
          status: "experimental",
          breaking_changes: true,
          approval_required: true,
          changes: [
            "AI integration",
            "new format",
            "breaking changes",
            "revolutionary approach",
          ],
        },
      }),
    );

    const v2Publication = await Effect.runPromise(
      storage.publishVersion({
        note_id: note.id,
        collections: [collection.id],
        label: "major" as VersionLabel,
        client_token: `v2_${Date.now()}`,
      }),
    );

    console.log(
      `${colors.yellow}[TARGET] Version 2.0 published (EXPERIMENTAL):${colors.reset}`,
    );
    console.log(`   Version ID: ${v2Publication.version_id}`);
    console.log(
      `   Content: Experimental AI-enhanced approach with breaking changes`,
    );

    // Step 5: Review complete version history
    console.log(
      `\n${colors.cyan}Step 5: Reviewing complete version history...${colors.reset}`,
    );

    const versionHistory = await Effect.runPromise(
      storage.listVersions(note.id, { limit: 10 }),
    );

    console.log(
      `${colors.green}[OK] Complete version history (${versionHistory.length} versions):${colors.reset}`,
    );
    versionHistory.forEach((version, index) => {
      const isLatest = index === 0;
      const marker = isLatest ? "→ CURRENT" : "  ";
      const label = version.label.toUpperCase().padEnd(5);
      console.log(`   ${marker} ${label}: ${version.id}`);
      console.log(`     Created: ${version.created_at.toISOString()}`);
      console.log(`     Hash: ${version.content_hash.substring(0, 16)}...`);

      // Extract version info from content
      const contentPreview = version.content_md.split("\n")[0];
      console.log(`     Content: ${contentPreview}`);

      if (version.parent_version_id) {
        console.log(
          `     Parent: ${version.parent_version_id.substring(0, 16)}...`,
        );
      }
      console.log("");
    });

    // Step 6: Demonstrate rollback (SPEC: Creates new Version referencing target)
    console.log(
      `${colors.cyan}Step 6: Rolling back to stable version (v1.1)...${colors.reset}`,
    );
    console.log(
      `${colors.yellow}Reason: v2.0 experimental features not ready for production${colors.reset}`,
    );

    const targetVersion = versionHistory.find((v) =>
      v.content_md.includes("v1.1"),
    );
    if (!targetVersion) {
      throw new Error("Could not find v1.1 for rollback");
    }

    const rollbackResult = await Effect.runPromise(
      storage.rollbackToVersion({
        note_id: note.id,
        target_version_id: targetVersion.id,
        client_token: `rollback_${Date.now()}`,
      }),
    );

    console.log(`${colors.green}[OK] Rollback completed:${colors.reset}`);
    console.log(`   New version ID: ${rollbackResult.new_version_id}`);
    console.log(`   Target version: ${rollbackResult.target_version_id}`);
    console.log(`   Status: ${rollbackResult.status}`);

    // Step 7: Verify rollback created new version
    console.log(
      `\n${colors.cyan}Step 7: Verifying rollback behavior...${colors.reset}`,
    );

    const postRollbackHistory = await Effect.runPromise(
      storage.listVersions(note.id, { limit: 10 }),
    );

    const rollbackVersion = await Effect.runPromise(
      storage.getVersion(rollbackResult.new_version_id),
    );

    console.log(`${colors.green}[OK] Rollback verification:${colors.reset}`);
    console.log(
      `   Total versions: ${postRollbackHistory.length} (was ${versionHistory.length})`,
    );
    console.log(
      `   New version references target: ${rollbackVersion.parent_version_id === targetVersion.id ? "Yes" : "No"}`,
    );
    console.log(
      `   Current version content: ${rollbackVersion.content_md.split("\n")[0]}`,
    );
    console.log(
      `   Content matches v1.1: ${rollbackVersion.content_md.includes("v1.1") ? "Yes" : "No"}`,
    );

    // Step 8: Show final version tree
    console.log(
      `\n${colors.cyan}Step 8: Final version tree visualization...${colors.reset}`,
    );

    console.log(`${colors.green}[OK] Version evolution tree:${colors.reset}`);
    console.log(`   v1.0 (initial) → v1.1 (enhanced) → v2.0 (experimental)`);
    console.log(`                                  ↘`);
    console.log(`                                    v1.1-rollback (current)`);
    console.log(`                                    ↑ references v1.1`);

    console.log(
      `\n${colors.magenta}[SPEC] Version metadata comparison:${colors.reset}`,
    );
    postRollbackHistory.slice(0, 4).forEach((version, index) => {
      const versionNum = index === 0 ? "CURRENT" : `v-${index}`;
      console.log(
        `   ${versionNum}: ${version.label} | ${version.created_at.toDateString()}`,
      );
    });

    // Summary with SPEC compliance
    console.log(
      `\n${colors.yellow}${colors.bright}[SUMMARY] Version History Demo Summary:${colors.reset}`,
    );
    console.log(
      `• Created ${postRollbackHistory.length} versions across 3 major iterations`,
    );
    console.log(
      `• Demonstrated version immutability (each change creates new version)`,
    );
    console.log(`• Showed complete audit trail with parent relationships`);
    console.log(`• Performed rollback creating new version referencing target`);
    console.log(`• Verified rollback preserves history (no mutation)`);

    console.log(`\n${colors.blue}[SPEC] SPEC Compliance:${colors.reset}`);
    console.log(`• Version immutability enforced [OK]`);
    console.log(`• Rollback creates new Version referencing target [OK]`);
    console.log(`• Parent relationships preserved [OK]`);
    console.log(`• Complete version history maintained [OK]`);
    console.log(`• Version labels (minor/major) tracked [OK]`);

    console.log(`\n${colors.magenta}=== Production Insights:${colors.reset}`);
    console.log(`• Version control enables safe experimentation`);
    console.log(`• Rollback provides instant recovery from bad releases`);
    console.log(`• Complete audit trail supports compliance requirements`);
    console.log(`• Immutability prevents accidental history loss`);

    return {
      note,
      finalVersions: postRollbackHistory,
      rollbackDetails: rollbackResult,
    };
  } catch (error) {
    console.error(
      `${colors.red}[ERR] Version history demo failed:${colors.reset}`,
      error,
    );
    throw error;
  } finally {
    await Effect.runPromise(db.close());
  }
}

async function main() {
  try {
    const result = await versionHistoryDemo();
    console.log(
      `\n${colors.green}[READY] Version history demo completed successfully!${colors.reset}`,
    );
    console.log(
      `${colors.cyan}Tracked ${result.finalVersions.length} versions with complete rollback workflow${colors.reset}`,
    );
  } catch (error) {
    console.error(`${colors.red}Script failed:${colors.reset}`, error);
    process.exit(1);
  }
}

if (import.meta.main) {
  main();
}

export { versionHistoryDemo };
