# Knowledge Repository Runbook

## Prerequisites

- Docker and Docker Compose
- Bun runtime
- Make utility

## Quick Start (Zero to Running)

### 1. Install Dependencies

```bash
bun install
```

### 2. Start Database

```bash
make db-start
```

### 3. Apply Schema

```bash
make db-migrate
```

### 4. Run Complete Demo

```bash
bun scripts/demo-workflow.ts
```

## Individual Component Testing

### Draft Management

```bash
bun scripts/create-draft.ts
```

Creates notes with draft content, demonstrates autosave functionality.

### Collection Management

```bash
bun scripts/manage-collections.ts
```

Creates collections, tests name uniqueness, shows CRUD operations.

### Publication Workflow

```bash
bun scripts/publish-note.ts
```

Demonstrates two-phase publication, version creation, content hashing.

### Version Control

```bash
bun scripts/version-history.ts
```

Shows version evolution, rollback functionality, audit trails.

### Search Architecture

```bash
bun scripts/search-notes.ts
```

Demonstrates expected search workflow (implementation pending).

## Database Management

### View Status

```bash
make db-status
```

### Reset Everything

```bash
make db-reset
```

### Clear Data Only

```bash
make db-wipe
```

### Database Shell

```bash
make db-shell
```

### View Logs

```bash
make db-logs
```

## System Validation

### Check Integration Tests

```bash
bun test src/tests/integration.api.test.ts
```

Should show 9/12 tests passing.

### Verify Database Schema

```bash
make db-info
```

Shows table counts and schema information.

### Test API Endpoints

```bash
# Start the API server
bun run dev

# Test health endpoint
curl http://localhost:3001/healthz
```

## Troubleshooting

### Database Issues

```bash
# Check if database is running
make db-status

# Restart database
make db-stop
make db-start

# Complete reset
make db-reset
```

### Migration Problems

```bash
# Re-apply migrations
make db-wipe
make db-migrate
```

### Script Failures

```bash
# Check database connection
make db-status

# Verify dependencies
bun install

# Check logs
make db-logs
```

## Development Workflow

### Daily Development

```bash
make db-start          # Start database
bun scripts/demo-workflow.ts  # Verify system works
# ... development work ...
bun test               # Run tests
```

### Clean Slate Testing

```bash
make db-reset          # Fresh database
bun scripts/demo-workflow.ts  # Full system test
```

### Data Inspection

```bash
make db-shell          # Open PostgreSQL shell
# \dt                  # List tables
# SELECT * FROM notes; # Query data
# \q                   # Quit
```

## Expected Outcomes

### Successful Demo Run

- Creates 4 collections
- Creates multiple notes with drafts
- Publishes versions to collections
- Demonstrates version history and rollback
- Shows search architecture (workflow defined)

### Database State After Demo

- Collections: 4+ entries
- Notes: 3+ entries
- Drafts: 3+ entries
- Versions: 6+ entries (including rollback versions)
- Publications: 4+ entries

### Integration Test Results

- 9 tests passing
- 3 tests failing (known issues documented in docs/00-BACKLOG.md)
- 75% pass rate indicates stable foundation

## System Capabilities

### Currently Working

- Draft creation and autosave
- Collection management with uniqueness constraints
- Publication workflow with version creation
- Version control with rollback
- Database persistence with proper error handling
- API endpoints with correct HTTP status codes

### Architecture Ready (Implementation Pending)

- Search functionality (Orama adapter interface defined)
- Indexing pipeline (database schema complete)
- Session management (schema implemented)
- Snapshot/export (schema implemented)

### Performance Targets

- Search: P50 ≤ 200ms, P95 ≤ 500ms (defined, not yet measured)
- Publish: P50 ≤ 5s, P95 ≤ 10s (workflow implemented, indexing pending)

## Next Steps

After successful runbook execution:

1. Review output from demo-workflow.ts for system status
2. Examine failing tests in docs/00-BACKLOG.md
3. Proceed with Phase 2 development (search implementation)
4. Use scripts as reference for API usage patterns
