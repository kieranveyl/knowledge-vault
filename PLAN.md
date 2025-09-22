# Development Plan

## Current Status

✅ **Phase 0 (Bootstrap)**: Basic project setup complete

- Directory structure created
- Bun + TypeScript configured with strict mode
- Biome formatting/linting configured
- Basic test infrastructure working (`bun test` passes)
- Some policy files started (retrieval, tokenization)

🔄 **Phase 1 (Schemas & Policy)**: In progress - foundational types needed

## Immediate Next Steps (Phase 1 - Schemas & Policy)

### 1. Complete Core Schemas (`schema/` directory)

- **`schema/entities.ts`**: Define all domain entities (Note, Draft, Version, Collection, etc.) with exact ULID identifier patterns
- **`schema/events.ts`**: Define event types (DraftSaved, VersionCreated, VisibilityEvent, etc.)
- **`schema/anchors.ts`**: Implement precise Anchor schema `{ structure_path, token_offset, token_length, fingerprint, tokenization_version, fingerprint_algo }`
- **`schema/api.ts`**: Request/response types for REST endpoints

### 2. Complete Policy Definitions (`policy/` directory)

- **`policy/publication.ts`**: Title validation (1-200 chars), collection requirements, tag limits (max 15, each 1-40 chars)
- **`policy/rate-limits.ts`**: Query limits (5 QPS burst, 60/min sustained), mutation limits (1/5s burst, 12/min sustained)
- Ensure all policy constants reference SPEC.md with JSDoc

### 3. Validation (Phase 1 completion criteria)

- All schema types compile without errors
- Policy files export constants with proper JSDoc documentation
- Basic schema validation tests pass

## Phase 2 - Domain Logic (Next)

- **`domain/anchor.ts`**: Tokenization Standard implementation (Unicode NFC, UAX-29, CJK dictionary fallback)
- **`domain/validation.ts`**: Publication validation rules
- **`domain/retrieval.ts`**: Deterministic deduplication and tie-breaking logic
- **`domain/invariants.ts`**: Testable business rule assertions

## Phase 3 - Ports & Adapters

- Define storage, indexing, parsing, and observability interfaces
- Implement ElectricSQL, Orama, and Elysia adapters
- Ensure loose coupling between layers

## Success Criteria (Short-term)

- [ ] `bun run build` compiles without errors
- [ ] All schema types are properly defined and importable
- [ ] Policy constants are exported with JSDoc references to SPEC.md
- [ ] Basic validation logic works for publication requirements
- [ ] Foundation ready for domain logic implementation

## Key Technical Constraints

- Maintain strict draft/publish isolation (zero bleed-through)
- All anchors must be deterministic and stable across edits
- Every answer must cite ≥1 source passage
- Performance targets: search <200ms P50, publish-to-visible <10s P95
