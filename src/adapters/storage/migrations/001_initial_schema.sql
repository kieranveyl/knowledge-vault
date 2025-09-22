-- Initial database schema for knowledge repository
-- References SPEC.md Section 3: Logical Data Model

-- Enable UUID extension for ULID-like IDs
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Workspace configuration table
CREATE TABLE workspace_config (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    initialized_at TIMESTAMPTZ DEFAULT NOW(),
    schema_version TEXT NOT NULL DEFAULT '1.0.0',
    settings JSONB DEFAULT '{}'::jsonb
);

-- Collections table
-- SPEC: Collection.name unique per workspace
CREATE TABLE collections (
    id TEXT PRIMARY KEY, -- col_<ulid>
    name TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT collections_name_unique UNIQUE (name),
    CONSTRAINT collections_id_format CHECK (id ~ '^col_[0-9A-HJKMNP-TV-Z]{26}$')
);

-- Notes table
-- SPEC: Note has 0..1 Draft; 0..N Versions
CREATE TABLE notes (
    id TEXT PRIMARY KEY, -- note_<ulid>
    title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    current_version_id TEXT, -- References versions(id)
    
    CONSTRAINT notes_id_format CHECK (id ~ '^note_[0-9A-HJKMNP-TV-Z]{26}$'),
    CONSTRAINT notes_updated_after_created CHECK (updated_at >= created_at)
);

-- Drafts table  
-- SPEC: Note has 0..1 Draft; Drafts are never searchable
CREATE TABLE drafts (
    note_id TEXT PRIMARY KEY REFERENCES notes(id) ON DELETE CASCADE,
    body_md TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    autosave_ts TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Versions table
-- SPEC: Each publication emits a new immutable Version
CREATE TABLE versions (
    id TEXT PRIMARY KEY, -- ver_<ulid>
    note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    content_md TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    content_hash TEXT NOT NULL CHECK (length(content_hash) = 64), -- SHA-256 hex
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    parent_version_id TEXT REFERENCES versions(id),
    label TEXT NOT NULL CHECK (label IN ('minor', 'major')),
    
    CONSTRAINT versions_id_format CHECK (id ~ '^ver_[0-9A-HJKMNP-TV-Z]{26}$'),
    CONSTRAINT versions_immutable_content CHECK (content_hash != ''),
    CONSTRAINT versions_parent_different CHECK (id != parent_version_id)
);

-- Add foreign key for notes.current_version_id
ALTER TABLE notes ADD CONSTRAINT notes_current_version_fk 
    FOREIGN KEY (current_version_id) REFERENCES versions(id);

-- Publications table
-- SPEC: Publication creates exactly one Version
CREATE TABLE publications (
    id TEXT PRIMARY KEY, -- pub_<ulid>
    note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    version_id TEXT NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
    published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    label TEXT CHECK (label IN ('minor', 'major')),
    
    CONSTRAINT publications_id_format CHECK (id ~ '^pub_[0-9A-HJKMNP-TV-Z]{26}$'),
    CONSTRAINT publications_unique_version UNIQUE (version_id)
);

-- Collection memberships bridge table
-- SPEC: Note ↔ Collection is many-to-many
CREATE TABLE collection_memberships (
    note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    PRIMARY KEY (note_id, collection_id)
);

-- Publication collections bridge table
CREATE TABLE publication_collections (
    publication_id TEXT NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
    collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    
    PRIMARY KEY (publication_id, collection_id)
);

-- Passages table for search indexing
-- SPEC: Passage chunking policy (max 180 tokens per passage; 50% overlap)
CREATE TABLE passages (
    id TEXT PRIMARY KEY, -- pas_<ulid>
    version_id TEXT NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
    structure_path TEXT NOT NULL,
    token_offset INTEGER NOT NULL CHECK (token_offset >= 0),
    token_length INTEGER NOT NULL CHECK (token_length > 0 AND token_length <= 180),
    snippet TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT passages_id_format CHECK (id ~ '^pas_[0-9A-HJKMNP-TV-Z]{26}$')
);

-- Corpus table for search index management
-- SPEC: Corpus has Fresh|Updating|Committed state
CREATE TABLE corpus (
    id TEXT PRIMARY KEY, -- cor_<ulid>
    state TEXT NOT NULL CHECK (state IN ('Fresh', 'Updating', 'Committed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT corpus_id_format CHECK (id ~ '^cor_[0-9A-HJKMNP-TV-Z]{26}$')
);

-- Corpus versions bridge table
CREATE TABLE corpus_versions (
    corpus_id TEXT NOT NULL REFERENCES corpus(id) ON DELETE CASCADE,
    version_id TEXT NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
    
    PRIMARY KEY (corpus_id, version_id)
);

-- Index table for search index metadata
-- SPEC: Index has Building|Ready|Swapping state
CREATE TABLE search_index (
    id TEXT PRIMARY KEY, -- idx_<ulid>
    corpus_id TEXT NOT NULL REFERENCES corpus(id) ON DELETE CASCADE,
    state TEXT NOT NULL CHECK (state IN ('Building', 'Ready', 'Swapping')),
    built_at TIMESTAMPTZ,
    index_data BYTEA, -- Serialized Orama index
    
    CONSTRAINT index_id_format CHECK (id ~ '^idx_[0-9A-HJKMNP-TV-Z]{26}$')
);

-- Sessions table
-- SPEC: Session records ordered Queries, Answers, and openings
CREATE TABLE sessions (
    id TEXT PRIMARY KEY, -- ses_<ulid>
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    pinned BOOLEAN DEFAULT FALSE,
    steps JSONB NOT NULL DEFAULT '[]'::jsonb, -- Array of session steps
    
    CONSTRAINT sessions_id_format CHECK (id ~ '^ses_[0-9A-HJKMNP-TV-Z]{26}$'),
    CONSTRAINT sessions_end_after_start CHECK (ended_at IS NULL OR ended_at >= started_at)
);

-- Queries table
CREATE TABLE queries (
    id TEXT PRIMARY KEY, -- qry_<ulid>
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    text TEXT NOT NULL CHECK (length(text) > 0),
    scope JSONB NOT NULL, -- {collection_ids: [], filters: {}}
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT queries_id_format CHECK (id ~ '^qry_[0-9A-HJKMNP-TV-Z]{26}$')
);

-- Answers table
CREATE TABLE answers (
    id TEXT PRIMARY KEY, -- ans_<ulid>
    query_id TEXT NOT NULL REFERENCES queries(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    composed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    coverage JSONB NOT NULL, -- {claims: int, cited: int}
    
    CONSTRAINT answers_id_format CHECK (id ~ '^ans_[0-9A-HJKMNP-TV-Z]{26}$')
);

-- Citations table
-- SPEC: Citation references specific passage with anchor
CREATE TABLE citations (
    id TEXT PRIMARY KEY, -- cit_<ulid>
    answer_id TEXT NOT NULL REFERENCES answers(id) ON DELETE CASCADE,
    version_id TEXT NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
    anchor JSONB NOT NULL, -- Full anchor object with structure_path, token_offset, etc.
    snippet TEXT NOT NULL,
    confidence REAL CHECK (confidence BETWEEN 0 AND 1),
    
    CONSTRAINT citations_id_format CHECK (id ~ '^cit_[0-9A-HJKMNP-TV-Z]{26}$')
);

-- Snapshots table
-- SPEC: Workspace snapshots for backup and restoration
CREATE TABLE snapshots (
    id TEXT PRIMARY KEY, -- snp_<ulid>
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    scope TEXT NOT NULL,
    note TEXT NOT NULL, -- JSON serialized workspace content
    
    CONSTRAINT snapshots_id_format CHECK (id ~ '^snp_[0-9A-HJKMNP-TV-Z]{26}$')
);

-- Events table for event sourcing and audit trail
CREATE TABLE events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_type TEXT NOT NULL,
    event_data JSONB NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    schema_version TEXT NOT NULL DEFAULT '1.0.0'
);

-- Indexes for performance
CREATE INDEX idx_notes_updated_at ON notes(updated_at DESC);
CREATE INDEX idx_versions_note_id_created_at ON versions(note_id, created_at DESC);
CREATE INDEX idx_versions_content_hash ON versions(content_hash);
CREATE INDEX idx_publications_note_id ON publications(note_id);
CREATE INDEX idx_publications_published_at ON publications(published_at DESC);
CREATE INDEX idx_passages_version_id ON passages(version_id);
CREATE INDEX idx_passages_structure_path ON passages(structure_path);
CREATE INDEX idx_sessions_started_at ON sessions(started_at DESC);
CREATE INDEX idx_queries_session_id ON queries(session_id);
CREATE INDEX idx_answers_query_id ON answers(query_id);
CREATE INDEX idx_citations_answer_id ON citations(answer_id);
CREATE INDEX idx_citations_version_id ON citations(version_id);
CREATE INDEX idx_events_timestamp ON events(timestamp DESC);
CREATE INDEX idx_events_type ON events(event_type);

-- Insert initial workspace configuration
INSERT INTO workspace_config (schema_version, settings) 
VALUES ('1.0.0', '{
    "initialized": true,
    "version": "1.0.0",
    "chunking": {
        "maxTokensPerPassage": 180,
        "overlapTokens": 90,
        "maxNoteTokens": 20000
    },
    "retrieval": {
        "topKRetrieve": 128,
        "topKRerank": 64,
        "pageSize": 10
    }
}'::jsonb);
