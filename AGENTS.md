# Knowledge Repository - Agent Instructions

## Build Commands
- `bun test` - run all tests  
- `bun test path/to/file.test.ts` - run single test file
- `bun run dev` - start development server with hot reload
- `bun run build` - build for production
- `bun run lint` - check code quality with Biome
- `bun run format` - auto-format code with Biome

## Architecture
Clean architecture pattern: domain (pure functions) → effects (orchestration) → adapters (I/O). Entry point: `src/runtime/main.ts`. Key layers: domain logic, Effect-based workflows, ports/adapters, pipelines (indexing/visibility), telemetry. Uses local-first storage (ElectricSQL), Orama search, Elysia API framework.

## Code Style
- **Formatting**: Tabs for indentation, double quotes, organize imports on save (Biome enforced)
- **Imports**: Use relative paths, group by type (domain → effects → adapters)
- **Types**: Strict TypeScript, Effect Schema for validation, explicit return types on public functions
- **Naming**: camelCase for functions/variables, PascalCase for types, SCREAMING_SNAKE_CASE for constants
- **Error handling**: Effect-based error handling, typed errors, no throwing exceptions
- **Files**: `.ts` extension, co-locate tests as `.test.ts`, follow domain/effects/adapters structure
- **Business Rules**: Reference SPEC.md for invariants, use JSDoc for policy explanations

## Key Concepts
Notes exist as Drafts (invisible to search) until Published (creates immutable Versions). Citations must anchor to exact token ranges. All answers must be fully extractive with ≥1 citation. Maintain strict draft/publish isolation.
