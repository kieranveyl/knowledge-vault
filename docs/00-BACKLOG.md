# Development Backlog - Current Issues

_Last Updated: September 22, 2025_
_Phase: 1, Week 1 Complete_

## Critical Issues (Blocking)

_None - Core functionality operational_

## High Priority Issues

### 1. Collection Conflict Test Intermittent Failure

**File:** `src/tests/integration.api.test.ts:111`
**Expected:** HTTP 409 (Conflict)
**Actual:** HTTP 500 (Internal Server Error)
**Status:** Intermittent - works in isolation but fails in test suite

**Error Details:**

```
expect(duplicateResponse.status).toBe(409); // Conflict
Expected: 409
Received: 500
```

**Root Cause:** Test isolation issue - collections from previous tests may not be cleaned up, causing the "first" collection creation to actually be a duplicate.

**Solution:** Add proper test cleanup/setup to ensure clean database state between tests.

---

### 2. Draft Not Found Returns Wrong Status Code

**File:** `src/tests/integration.api.test.ts:184`
**Expected:** HTTP 404 (Not Found)
**Actual:** HTTP 500 (Internal Server Error)
**Status:** Consistent failure

**Error Details:**

```
expect(response.status).toBe(404);
Expected: 404
Received: 500
```

**Root Cause:** The `getDraft` method in PostgreSQL adapter is not properly mapping "NotFound" storage errors to 404 HTTP responses. The error mapping chain is failing for this specific case.

**Solution:** Debug the `getDraft` error handling path and ensure NotFound storage errors are properly caught and mapped in the API layer.

---

### 3. Validation Error Returns Success Instead of Error

**File:** `src/tests/integration.api.test.ts:201`
**Expected:** HTTP 400 (Bad Request)
**Actual:** HTTP 200 (OK)
**Status:** Consistent failure

**Error Details:**

```
expect(response.status).toBe(400);
Expected: 400
Received: 200
```

**Root Cause:** The validation test is sending invalid data but getting a 200 response, suggesting:

1. The validation is not being triggered
2. Invalid data is being accepted as valid
3. The endpoint is not properly validating the request body schema

**Solution:** Review the test to understand what validation should fail, then check if:

- Elysia body validation is properly configured
- The request is actually malformed
- The validation error is being caught and mapped correctly

## Medium Priority Issues

### 4. Test Suite Isolation Problems

**Impact:** Tests pass individually but fail when run together
**Root Cause:** Database state bleeding between tests
**Solution:** Implement proper test database cleanup between test cases

### 5. Error Message Consistency

**Impact:** Some errors return raw database messages instead of user-friendly messages
**Solution:** Improve error message mapping to provide consistent, actionable error messages

## Low Priority Issues

### 6. Missing Transaction Support

**Status:** Partially implemented but not tested
**Impact:** Complex operations may leave database in inconsistent state on failure
**Solution:** Add comprehensive transaction testing and error recovery

### 7. Performance Baseline Missing

**Impact:** No measurement of current performance against SPEC requirements
**Solution:** Add performance benchmarking for basic operations

## Completed in Phase 1, Week 1

- ✅ Database migration system working
- ✅ PostgreSQL adapter integrated and operational
- ✅ Core CRUD operations (collections, notes, drafts)
- ✅ API error mapping for conflict errors (409 status codes)
- ✅ Draft save operations working correctly
- ✅ End-to-end workflow (create note → save draft)
- ✅ Effect error handling for FiberFailure cases
- ✅ Schema validation imports resolved

## Test Status Summary

- **Total Tests:** 12
- **Passing:** 9 (75%)
- **Failing:** 3 (25%)
- **Improvement:** +2 tests passing since Phase 1 start

## Next Phase Priorities

1. Fix remaining 3 test failures
2. Implement search infrastructure (Orama adapter)
3. Build indexing pipeline
4. Complete publication workflow

---

## Development Notes

### Database State

- PostgreSQL running on port 54321
- Schema migrations applied successfully
- All tables created with proper constraints
- Connection pooling working

### API Endpoints Status

- `GET /healthz` ✅ Working
- `POST /collections` ✅ Working (with conflict detection)
- `GET /collections` ✅ Working
- `POST /drafts` ✅ Working
- `GET /drafts/:note_id` 🟡 Working but 404 errors need fixing

### Architecture Status

- Clean architecture pattern maintained
- Effect-based error handling operational
- PostgreSQL adapter replacing memory adapter
- Type safety preserved throughout
