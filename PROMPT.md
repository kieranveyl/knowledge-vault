You are a Senior QA Engineer and Test Architect.
You have already produced a full traceability matrix comparing TESTS.md requirements (1–100) to the current suite in `src/tests`.
Now your task is to convert that gap analysis into a **test development roadmap**.

**Inputs:**

- TESTS.md (full requirements)
- TESTS-COVERAGE.md - Matrix (with tested, partial, not tested)
- src/tests (current coverage)

**Goal:**
Generate a prioritized test plan that specifies exactly what needs to be built next to close gaps, structured in phases that engineering can immediately implement.

**Instructions:**

1. **Prioritization**
    - Rank missing/partial tests by criticality: CRITICAL (blocking core workflows), HIGH (major reliability/security), MEDIUM (completeness).
    - Factor dependencies (e.g., search functionality must exist before testing latency).

2. **Concrete Test Specifications**
    - For each gap, propose the exact new test case(s):
        - Suggested file and suite name (`src/tests/...`).
        - Test title(s) in `describe/it` format.
        - Assertions needed to prove requirement.
        - Mocking/stubbing required if any.

3. **Roadmap Phases**
    - Phase 1: Immediate critical-path tests (blockers for publish, rollback, visibility, search correctness).
    - Phase 2: Core reliability tests (consistency, error handling, storage guarantees).
    - Phase 3: Performance and security test suites.
    - Phase 4: Nice-to-have or post-MVP validations.

4. **Output Format**
    - **Phase Roadmap Table**: Phase → Test Cases → Priority → Dependencies.
    - **Detailed Test Specs**: For each new test, show proposed structure (describe/it).
    - **Coverage Goals**: Expected % coverage per phase.

**Constraints:**

- Do not restate what is already tested.
- Focus only on missing or partial requirements.
- Ensure test descriptions are specific enough that a developer could start writing code immediately.

**Output:**
A structured, actionable test development roadmap that closes the gaps between TESTS.md and the current test suite, sequenced into phases with concrete test cases.
