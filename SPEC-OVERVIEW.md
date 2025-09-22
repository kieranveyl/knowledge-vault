# System Design Spec

## 1. System Overview

### Purpose

A private, local-first personal knowledge repository and discovery system that lets the user create and edit Markdown notes within a collection-based project tree, keep notes as drafts by default, and explicitly publish selected notes so they become part of a versioned, searchable corpus that returns concise, source-cited answers while unpublished drafts remain isolated.

### Objectives

1. Median search response under 200 ms for a 10k published-note corpus, P95 under 500 ms.
2. Drafts remain invisible to search and answers until published, with zero bleed-through.
3. Publish or republish latency under 10 seconds from user action to searchable state.
4. All answers include at least one citation to a specific passage, target 90 percent with two or more.
5. Versioned history preserved for 100 percent of published notes with reversible rollbacks.

### Non-Goals

- External file types beyond Markdown.
- Multi-user collaboration, sharing, or cloud sync.
- Plugin marketplaces or extension runtimes.
- Web crawling, automated internet research, or model training.

## 2. System Boundaries and Context

### External actors and systems

- **User**: Creates, edits, publishes, searches, reads, and manages collections.
- **Local filesystem**: Stores the workspace, notes, versions, snapshots, settings, and logs.
- **Operating system services**: Provide file access, time, and notifications.

### In-scope behaviors

- Markdown note authoring and editing.
- Draft and publish lifecycle with versioning and rollback.
- Collection management and project tree navigation.
- Search, citation-first answers, reading, aggregation views, and session history.

### Out-of-scope behaviors

- Non-Markdown ingestion.
- Remote services, accounts, or permissions.
- Real-time collaboration and concurrent multi-editor sessions.

## 3. Core Concepts

### Domain objects

- **Workspace**: The root container for all collections, notes, and settings.
- **Collection**: A named subset of published notes for scoped search and navigation.
- **Project tree**: A hierarchical view that reflects collections and note locations.
- **Note**: A Markdown document with metadata.
- **Draft**: An editable state of a note that is excluded from search and answers.
- **Publication**: A point-in-time inclusion of a note in the searchable corpus.
- **Version**: An immutable snapshot of a note at publication time.
- **Query**: A user request for information over selected collections.
- **Answer**: A concise response with citations to passages in published notes.
- **Citation**: A reference to a specific passage in a published note.
- **Session**: A sequence of queries, answers, and opened sources for later review.

### Key relationships

- Workspace contains Collections and the Project tree.
- Collection contains Published Notes and their Versions.
- Note has zero or more Versions; Draft is the mutable pre-publication state of a Note.
- Query runs over one or more Collections and yields an Answer with Citations.
- Session records Queries, Answers, and source openings anchored to Versions.

## 4. Feature List (Prioritized)

1. Project tree and collection browser – orient and navigate the workspace by collections and notes.
2. Markdown editor with draft mode – author and revise notes without affecting search.
3. Publish and republish workflow – explicitly move notes into the searchable corpus with versioning.
4. Version history and rollback – inspect, compare, and restore prior published states.
5. Corpus search with citation-first answers – retrieve concise responses backed by exact passages.
6. Reading view with passage navigation – jump to cited spans with context and quick navigation.
7. Scoped search by collection and filters – constrain retrieval to precise subsets.
8. Aggregation views – group related answers, notes, and citations into briefings.
9. Session history and replay – revisit prior queries and results for continuity.
10. Workspace snapshots – capture a consistent state for backup and restoration.

## 5. Feature Specifications

### Feature 1: Project tree and collection browser

- **Intent**: Provide a structured view of collections and notes for rapid orientation and access.
- **Triggers**: App open; user selects a collection; user expands or collapses folders.
- **Preconditions**: Workspace path is available.
- **Postconditions**: The user sees collections and notes with clear draft or published status.
- **Inputs → Outputs**: Inputs: workspace state. Outputs: rendered tree with selection and status.
- **Main flow**:
    1. Load workspace metadata.
    2. List collections and notes with status badges.
    3. Expand or collapse nodes on demand.
    4. Select a node to reveal details and available actions.
    5. Persist current selection and scroll position.
- **Alternate or edge flows**:
    - Empty workspace: show create collection and create note affordances.
- **Rules and constraints**:
    - Drafts and published notes are visually distinct.
    - Collections are unique by name within the workspace.
- **Errors and recovery**:
    - Missing workspace: prompt to choose or create one.
- **Metrics observed**:
    - Time to first render.
    - Navigation depth and dwell time by node type.

### Feature 2: Markdown editor with draft mode

- **Intent**: Enable note creation and editing without affecting search until explicitly published.
- **Triggers**: User creates a new note or edits an existing note.
- **Preconditions**: A collection context or workspace root is selected.
- **Postconditions**: Draft changes are saved and remain excluded from search and answers.
- **Inputs → Outputs**: Inputs: note content and metadata. Outputs: saved draft state and status.
- **Main flow**:
    1. Create or open a note in draft mode.
    2. Edit content and metadata such as title and tags.
    3. Save changes automatically and update draft timestamp.
    4. Offer publish action when ready.
    5. Keep a local edit history for the draft session.
- **Alternate or edge flows**:
    - Revert last draft changes.
    - Convert a published note back to draft for major revision.
- **Rules and constraints**:
    - Drafts are never included in search results or answers.
    - A note can have only one active draft state at a time.
- **Errors and recovery**:
    - Save failure: display a non-blocking alert and allow retry without data loss.
- **Metrics observed**:
    - Draft save frequency.
    - Time from first edit to publish.

### Feature 3: Publish and republish workflow

- **Intent**: Explicitly add a note to the searchable corpus and capture a versioned state.
- **Triggers**: User selects Publish or Republish on a draft or published note.
- **Preconditions**: Draft exists and passes basic validation such as required title.
- **Postconditions**: A new Version is created and the note becomes searchable within selected collections.
- **Inputs → Outputs**: Inputs: draft content, target collection. Outputs: Version record, published status.
- **Main flow**:
    1. User selects a target collection.
    2. Validate required metadata.
    3. Create a Version from current draft or published state.
    4. Mark the note as published and attach it to the collection.
    5. Update the corpus so the note is available to search and answers.
- **Alternate or edge flows**:
    - Publish to multiple collections.
    - Republish with minor or major revision labels.
- **Rules and constraints**:
    - Publication is explicit and reversible.
    - Each publication creates an immutable Version.
- **Errors and recovery**:
    - Validation failure: show missing fields and block publication.
- **Metrics observed**:
    - Time from publish action to searchable state.
    - Publication frequency and republish rate.

### Feature 4: Version history and rollback

- **Intent**: Preserve and restore prior published states to ensure trustworthy citations and reversibility.
- **Triggers**: User opens Version history or selects Roll back.
- **Preconditions**: The note has at least one Version.
- **Postconditions**: The selected Version becomes the current published state, and search reflects it.
- **Inputs → Outputs**: Inputs: note identifier, chosen Version. Outputs: updated published state and audit entry.
- **Main flow**:
    1. Display Versions with timestamps and labels.
    2. Compare two Versions with highlighted differences.
    3. Select a Version to activate.
    4. Confirm rollback intent.
    5. Update published state and propagate to corpus.
- **Alternate or edge flows**:
    - View a Version in read-only mode without activation.
- **Rules and constraints**:
    - Rollback creates a new Version that references the source Version.
- **Errors and recovery**:
    - Activation conflict: block if another operation is in progress and retry after it completes.
- **Metrics observed**:
    - Rollback frequency.
    - Time to consistency after rollback.

### Feature 5: Corpus search with citation-first answers

- **Intent**: Return concise answers backed by pinpoint citations into published notes.
- **Triggers**: User submits a query with optional collection scope and filters.
- **Preconditions**: At least one published note exists.
- **Postconditions**: The user receives an answer with citations and a ranked results list.
- **Inputs → Outputs**: Inputs: query text, selected collections, filters. Outputs: answer text, citations, ranked items.
- **Main flow**:
    1. Accept query and scope.
    2. Retrieve candidate passages from the corpus.
    3. Rank candidates and select supporting passages.
    4. Compose an answer that references the selected passages.
    5. Display citations with jump-to controls and a secondary ranked list.
- **Alternate or edge flows**:
    - No suitable evidence: return a no-answer statement and closest passages.
- **Rules and constraints**:
    - Every declarative claim in an answer must map to at least one citation.
- **Errors and recovery**:
    - Query failure: show a retry option without losing the query text.
- **Metrics observed**:
    - Answer latency and variance.
    - Citation coverage and follow-through rate.

### Feature 6: Reading view with passage navigation

- **Intent**: Let users open a published note at the cited span and review surrounding context.
- **Triggers**: User opens a result or clicks a citation.
- **Preconditions**: The cited Version exists and is accessible.
- **Postconditions**: The note opens at the correct passage with highlights and context controls.
- **Inputs → Outputs**: Inputs: citation target. Outputs: focused reading view with highlights.
- **Main flow**:
    1. Open the note in reading view.
    2. Scroll to the cited span and highlight it.
    3. Show heading trail and adjacent sections.
    4. Provide next and previous citation navigation.
    5. Offer a switch to view other Versions.
- **Alternate or edge flows**:
    - Multiple citations in one note: cycle through highlights.
- **Rules and constraints**:
    - Highlights remain stable across formatting changes.
- **Errors and recovery**:
    - Missing target: display message and link to the note start.
- **Metrics observed**:
    - Time to open and highlight.
    - Navigation actions per session.

### Feature 7: Scoped search by collection and filters

- **Intent**: Narrow retrieval to relevant subsets for higher precision and control.
- **Triggers**: User selects one or more collections and optional filters such as tags or date ranges.
- **Preconditions**: Collections and published notes exist.
- **Postconditions**: Results reflect only the chosen scope and filters.
- **Inputs → Outputs**: Inputs: selected collections, filters. Outputs: scoped results set and answer.
- **Main flow**:
    1. Capture scope and filters.
    2. Apply scope during candidate gathering.
    3. Present results and answer within scope.
    4. Allow quick toggles to adjust scope.
    5. Persist the last used scope per session.
- **Alternate or edge flows**:
    - Empty scope: prompt to broaden or remove constraints.
- **Rules and constraints**:
    - Scope selection does not persist across workspaces.
- **Errors and recovery**:
    - Invalid filter values: show guidance and ignore the bad filter.
- **Metrics observed**:
    - Precision and recall deltas when scoped vs unscoped.
    - Scope reuse rate.

### Feature 8: Session history and replay

- **Intent**: Preserve a trail of queries and opened sources for continuity and review.
- **Triggers**: User opens History or selects Replay.
- **Preconditions**: At least one prior session exists.
- **Postconditions**: The user can revisit past answers and sources with their original Versions.
- **Inputs → Outputs**: Inputs: session identifier. Outputs: ordered queries, answers, and citation openings.
- **Main flow**:
    1. List recent sessions with timestamps and counts.
    2. Open a session to view its timeline.
    3. Select a query to reload its answer and citations.
    4. Jump to any cited passage as it existed at that Version.
