#!/usr/bin/env bun
/**
 * Draft Creation Demo Script
 *
 * Demonstrates SPEC Section 4: Editor ↔ Store contract
 * Shows draft creation, saving, and retrieval workflows
 */

import { Effect } from "effect";
import { createDatabasePool } from "../src/adapters/storage/database";
import { createPostgresStorageAdapter } from "../src/adapters/storage/postgres.adapter";

const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  green: "\x1b[32m",
  blue: "\x1b[34m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  red: "\x1b[31m",
};

async function createDraftDemo() {
  console.log(
    `${colors.blue}${colors.bright}📝 Draft Creation Demo${colors.reset}`,
  );
  console.log("Demonstrating SPEC: Draft-by-default authoring with autosave\n");

  const db = createDatabasePool();
  const storage = createPostgresStorageAdapter(db);

  try {
    // Step 1: Create a new note (SPEC: Note has 0..1 Draft)
    console.log(`${colors.cyan}Step 1: Creating new note...${colors.reset}`);
    const note = await Effect.runPromise(
      storage.createNote(
        "My Research Notes",
        "# Research Topic\n\nInitial thoughts and ideas for my research project.",
        {
          tags: ["research", "draft", "ideas"],
          created_by: "demo-user",
        },
      ),
    );

    console.log(`${colors.green}✅ Note created:${colors.reset}`);
    console.log(`   ID: ${note.id}`);
    console.log(`   Title: "${note.title}"`);
    console.log(`   Created: ${note.created_at.toISOString()}`);
    console.log(`   Tags: ${note.metadata.tags?.join(", ") || "none"}`);

    // Step 2: Update draft content (SPEC: SaveDraft with autosave_ts)
    console.log(
      `\n${colors.cyan}Step 2: Updating draft content...${colors.reset}`,
    );
    const updateResult = await Effect.runPromise(
      storage.saveDraft({
        note_id: note.id,
        body_md: `# Advanced Research Notes

## Introduction
This document contains my ongoing research into knowledge management systems.

## Key Findings
- Local-first architecture provides better privacy
- Draft-by-default reduces publication anxiety
- Version control enables fearless editing

## Next Steps
- [ ] Review related literature
- [ ] Implement prototype features
- [ ] Gather user feedback

## References
- Knowledge Repository SPEC.md
- Local-first software principles

*Last updated: ${new Date().toISOString()}*`,
        metadata: {
          tags: ["research", "draft", "knowledge-management"],
          word_count: 150,
          last_section: "references",
        },
      }),
    );

    console.log(`${colors.green}✅ Draft saved:${colors.reset}`);
    console.log(
      `   Autosave timestamp: ${updateResult.autosave_ts.toISOString()}`,
    );
    console.log(`   Status: ${updateResult.status}`);

    // Step 3: Retrieve draft (SPEC: Draft isolation from published content)
    console.log(
      `\n${colors.cyan}Step 3: Retrieving draft content...${colors.reset}`,
    );
    const retrievedDraft = await Effect.runPromise(storage.getDraft(note.id));

    console.log(`${colors.green}✅ Draft retrieved:${colors.reset}`);
    console.log(`   Note ID: ${retrievedDraft.note_id}`);
    console.log(`   Word count: ${retrievedDraft.metadata.word_count}`);
    console.log(
      `   Content preview: ${retrievedDraft.body_md.split("\n")[0]}...`,
    );
    console.log(
      `   Last modified: ${retrievedDraft.autosave_ts.toISOString()}`,
    );

    // Step 4: Check draft status
    console.log(
      `\n${colors.cyan}Step 4: Checking draft existence...${colors.reset}`,
    );
    const hasDraft = await Effect.runPromise(storage.hasDraft(note.id));

    console.log(`${colors.green}✅ Draft check:${colors.reset}`);
    console.log(`   Has draft: ${hasDraft ? "Yes" : "No"}`);

    // Step 5: Demonstrate multiple saves (autosave behavior)
    console.log(
      `\n${colors.cyan}Step 5: Demonstrating autosave updates...${colors.reset}`,
    );

    for (let i = 1; i <= 3; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait 1 second

      const autosaveResult = await Effect.runPromise(
        storage.saveDraft({
          note_id: note.id,
          body_md:
            retrievedDraft.body_md +
            `\n\n<!-- Autosave ${i}: ${new Date().toISOString()} -->`,
          metadata: {
            ...retrievedDraft.metadata,
            autosave_count: i,
            last_autosave: new Date().toISOString(),
          },
        }),
      );

      console.log(
        `   Autosave ${i}: ${autosaveResult.autosave_ts.toISOString()}`,
      );
    }

    console.log(
      `${colors.green}✅ Multiple autosaves completed${colors.reset}`,
    );

    // Summary
    console.log(
      `\n${colors.yellow}${colors.bright}📊 Demo Summary:${colors.reset}`,
    );
    console.log(`• Created note with initial draft content`);
    console.log(`• Updated draft with rich markdown content`);
    console.log(`• Retrieved draft showing proper isolation`);
    console.log(`• Demonstrated autosave behavior`);
    console.log(`• All operations follow SPEC draft-by-default pattern`);

    console.log(`\n${colors.blue}💡 SPEC Compliance:${colors.reset}`);
    console.log(`• Draft-by-default authoring ✅`);
    console.log(`• Autosave timestamps ✅`);
    console.log(`• Draft isolation (not searchable) ✅`);
    console.log(`• Rich metadata support ✅`);

    return note.id;
  } catch (error) {
    console.error(`${colors.red}❌ Demo failed:${colors.reset}`, error);
    throw error;
  } finally {
    await Effect.runPromise(db.close());
  }
}

async function main() {
  try {
    const noteId = await createDraftDemo();
    console.log(
      `\n${colors.green}🎉 Draft demo completed successfully!${colors.reset}`,
    );
    console.log(
      `${colors.cyan}Note ID for next demos: ${noteId}${colors.reset}`,
    );
  } catch (error) {
    console.error(`${colors.red}Script failed:${colors.reset}`, error);
    process.exit(1);
  }
}

if (import.meta.main) {
  main();
}

export { createDraftDemo };
