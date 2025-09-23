# API V1 Requirements: Roadmap to a Turnkey Client-Ready Service

## 1. Introduction

This document outlines the necessary additions and refinements to transition the Knowledge Repository API from its current state to a complete, "turnkey" V1 service. The goal is to expose the application's full capabilities, currently defined in the domain and storage layers, through a comprehensive and secure HTTP API that a client can connect to and use without needing direct access to internal components.

The findings are based on a review of the `src` directory, comparing the internal service definitions (e.g., `storage.port.ts`) with the currently exposed endpoints in the API adapter (`elysia.adapter.ts`).

## 2. Executive Summary

The application has a robust foundation with well-defined internal services. However, the external API is incomplete. To achieve V1 status, the following key areas must be addressed:

1.  **Expose Core Note Lifecycle Endpoints**: The API currently lacks endpoints for creating, listing, reading, updating, and deleting notes. These are fundamental for any client application.
2.  **Implement Collection Membership Management**: The client has no way to manage the many-to-many relationship between notes and collections outside of the initial publication.
3.  **Formalize the Indexing Pipeline**: The link between publishing an item and it becoming searchable needs to be a robust, transactional, and observable process.
4.  **Provide Real-Time Event Streaming**: A real-time event stream (e.g., via Server-Sent Events) is needed to provide clients with feedback on asynchronous operations like indexing.
5.  **Complete Session and Snapshot APIs**: The current API only provides read access for sessions and snapshots, lacking the endpoints for creation and management.

## 3. Detailed API Requirements

### 3.1. Core Note Lifecycle Management

The most critical gap is the absence of basic CRUD (Create, Read, Update, Delete) operations for notes. The `StoragePort` already defines these capabilities; they simply need to be exposed via HTTP.

**Requirement:** Implement the following RESTful endpoints in `elysia.adapter.ts`.

- **`POST /notes` - Create a new Note**
    - **Action:** Calls `storage.createNote()`.
    - **Rationale:** This is the primary entry point for a user to start authoring. The current workflow has no API method to create a note; it must be done directly in storage.
    - **Request Body:**
        ```json
        {
            "title": "My New Note",
            "initialContent": "# Title\n\nStart writing here...",
            "metadata": {
                "tags": ["new", "draft"]
            }
        }
        ```
    - **Response (201 Created):** The full `Note` object.

- **`GET /notes` - List all Notes**
    - **Action:** Calls `storage.listNotes()` with support for pagination and filtering.
    - **Rationale:** Allows the client to display a list of all notes, which is a fundamental UI requirement.
    - **Query Parameters:** `page`, `page_size`, `collection_id`.
    - **Response (200 OK):** A paginated list of `Note` objects.

- **`GET /notes/:id` - Get a single Note**
    - **Action:** Calls `storage.getNote()`.
    - **Rationale:** Needed to load a note's top-level information.
    - **Response (200 OK):** The full `Note` object.

- **`PATCH /notes/:id` - Update Note Metadata**
    - **Action:** Calls `storage.updateNoteMetadata()`.
    - **Rationale:** Provides a lightweight method to update a note's title or tags without needing to save a full draft.
    - **Request Body:**
        ```json
        {
            "title": "An Updated Note Title",
            "metadata": {
                "tags": ["updated", "final"]
            }
        }
        ```
    - **Response (200 OK):** The updated `Note` object.

- **`DELETE /notes/:id` - Delete a Note**
    - **Action:** Calls `storage.deleteNote()`.
    - **Rationale:** Provides a method for permanent deletion of a note and all its associated versions and drafts.
    - **Response (204 No Content):** An empty response.

### 3.2. Collection Membership Management

Currently, a note is added to collections only upon publication. The client needs a way to manage these associations independently.

**Requirement:** Add endpoints to manage the note-collection many-to-many relationship.

- **`POST /collections/:id/notes` - Add a Note to a Collection**
    - **Action:** Calls `storage.addToCollections()`.
    - **Request Body:**
        ```json
        {
            "note_id": "note_..."
        }
        ```
    - **Response (204 No Content):** An empty response.

- **`DELETE /collections/:id/notes/:noteId` - Remove a Note from a Collection**
    - **Action:** Calls `storage.removeFromCollections()`.
    - **Response (204 No Content):** An empty response.

- **`GET /notes/:id/collections` - List Collections for a Note**
    - **Action:** Calls `storage.getNoteCollections()`.
    - **Response (200 OK):** An array of `Collection` objects.

### 3.3. Search & Indexing Pipeline Integration

The current API handler for `/publish` manually calls the storage and then enqueues a visibility event. This is not transactional and can lead to inconsistencies.

**Requirement:** Formalize the `Store -> Indexer` contract to be more robust.

1.  **Transactional Publication:** The `publishVersion` and `rollbackToVersion` operations in `elysia.adapter.ts` should be wrapped in a higher-level "effect" or transaction that ensures the `VisibilityEvent` is only enqueued if the storage operation succeeds. This prevents a scenario where a version is created but the indexing event fails to be sent.

2.  **Complete the Orama Adapter**: The `orama.adapter.stub.ts` should be removed, and the full `orama.adapter.ts` must be completed to handle the entire indexing lifecycle, including chunking content received from the visibility pipeline and inserting it into the search index.

3.  **Implement the Visibility Pipeline**: The `VisibilityPipeline` in `src/pipelines/indexing/visibility.ts` needs to be fully integrated. It should consume events from a queue, process them by calling the `IndexingPort`, and handle the two-phase commit (build index, then atomic swap) to make new content searchable.

### 3.4. Real-Time Event Streaming

To provide a responsive user experience for asynchronous operations, a real-time event stream is essential.

**Requirement:** Implement an SSE (Server-Sent Events) endpoint.

- **`GET /events` - Subscribe to Server Events**
    - **Action:** This endpoint should keep a connection open and stream events to the client.
    - **Rationale:** Allows the client to receive real-time notifications about system events, most critically for when a published version becomes searchable.
    - **Events to Stream:**
        - `IndexUpdateCommitted`: Sent when a version is successfully indexed and is now searchable.
        - `IndexUpdateFailed`: Sent if the indexing process fails.
        - `VisibilityTimeout`: Sent if indexing is taking longer than the expected SLO.
    - **Event Format:**
        ```
        event: IndexUpdateCommitted
        id: <event_id>
        data: {"version_id": "ver_...", "timestamp": "..."}
        ```

### 3.5. Session and Snapshot Management APIs

The `FRONTEND-SPEC.md` outlines session history, replay, and workspace snapshots. The current API is read-only for these features.

**Requirement:** Implement the missing write endpoints for sessions and snapshots.

- **`POST /sessions`**: Create a new session.
- **`POST /sessions/:id/steps`**: Log a new step (e.g., a query or citation click) to an existing session.
- **`PATCH /sessions/:id`**: Update a session (e.g., to pin it).
- **`POST /snapshots`**: Create a new workspace snapshot.
- **`POST /snapshots/:id/restore`**: Restore the workspace to a specific snapshot.
- **`DELETE /snapshots/:id`**: Delete a snapshot.

## 4. Conclusion

By implementing these requirements, the Knowledge Repository API will become a complete and robust service that is fully aligned with its design specifications. It will provide a turnkey solution for a client application to deliver the intended user experience, from authoring and publication to real-time feedback and advanced features like session replay.
