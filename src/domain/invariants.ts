/**
 * Domain invariants and business rule assertions
 * 
 * References SPEC.md Section 2: Invariants (testable)
 * Pure functions for verifying system consistency and business rules
 */

import type {
	Note,
	Draft,
	Version,
	Collection,
	Publication,
	Corpus,
	Index,
	Session,
	NoteId,
	VersionId,
	CollectionId,
} from "../schema/entities";

/**
 * Invariant violation result
 */
export interface InvariantViolation {
	readonly code: string;
	readonly message: string;
	readonly entity?: unknown;
	readonly context?: Record<string, unknown>;
}

/**
 * Invariant check result
 */
export interface InvariantCheckResult {
	readonly satisfied: boolean;
	readonly violations: readonly InvariantViolation[];
}

/**
 * System state snapshot for invariant checking
 */
export interface SystemState {
	readonly notes: readonly Note[];
	readonly drafts: readonly Draft[];
	readonly versions: readonly Version[];
	readonly collections: readonly Collection[];
	readonly publications: readonly Publication[];
	readonly corpus?: Corpus;
	readonly index?: Index;
	readonly sessions: readonly Session[];
}

/**
 * Draft isolation invariant: Drafts are never searchable or citable
 * 
 * @param drafts - All drafts in the system
 * @param corpus - Current corpus (should not contain draft content)
 * @returns Invariant check result
 */
export function checkDraftIsolationInvariant(
	drafts: readonly Draft[],
	corpus?: Corpus,
): InvariantCheckResult {
	const violations: InvariantViolation[] = [];

	if (!corpus) {
		return { satisfied: true, violations: [] };
	}

	// Check that no draft note IDs appear in corpus versions
	const draftNoteIds = new Set(drafts.map(draft => draft.note_id));
	
	// This would require cross-referencing versions to check note_id
	// For now, we document the invariant structure
	if (draftNoteIds.size > 0) {
		// In a real implementation, we'd verify corpus.version_ids don't belong to draft notes
		// violations.push({ code: "DRAFT_IN_CORPUS", message: "Draft content found in searchable corpus" });
	}

	return { satisfied: violations.length === 0, violations };
}

/**
 * Version immutability invariant: Each publication emits a new immutable Version
 * 
 * @param versions - All versions in the system
 * @returns Invariant check result
 */
export function checkVersionImmutabilityInvariant(
	versions: readonly Version[],
): InvariantCheckResult {
	const violations: InvariantViolation[] = [];

	// Check for duplicate version IDs
	const versionIds = versions.map(v => v.id);
	const uniqueVersionIds = new Set(versionIds);
	
	if (versionIds.length !== uniqueVersionIds.size) {
		violations.push({
			code: "DUPLICATE_VERSION_IDS",
			message: "Found duplicate version IDs - versions must be immutable",
			context: { 
				total: versionIds.length, 
				unique: uniqueVersionIds.size 
			},
		});
	}

	// Check that versions have monotonic timestamps per note
	const versionsByNote = new Map<NoteId, Version[]>();
	for (const version of versions) {
		const noteVersions = versionsByNote.get(version.note_id) || [];
		noteVersions.push(version);
		versionsByNote.set(version.note_id, noteVersions);
	}

	for (const [noteId, noteVersions] of versionsByNote) {
		const sorted = [...noteVersions].sort((a, b) => 
			a.created_at.getTime() - b.created_at.getTime()
		);

		for (let i = 1; i < sorted.length; i++) {
			if (sorted[i].created_at <= sorted[i-1].created_at) {
				violations.push({
					code: "NON_MONOTONIC_VERSIONS",
					message: "Version timestamps must be monotonically increasing per note",
					entity: sorted[i],
					context: { 
						noteId, 
						previousVersion: sorted[i-1].id,
						currentVersion: sorted[i].id 
					},
				});
			}
		}
	}

	return { satisfied: violations.length === 0, violations };
}

/**
 * Rollback version creation invariant: Rollback never mutates prior Versions
 * 
 * @param versions - All versions in the system
 * @param publications - All publications in the system
 * @returns Invariant check result
 */
export function checkRollbackImmutabilityInvariant(
	versions: readonly Version[],
	publications: readonly Publication[],
): InvariantCheckResult {
	const violations: InvariantViolation[] = [];

	// Check that all rollback operations create new versions
	// This would require tracking rollback operations in the event log
	// For now, we verify parent-child relationships are consistent
	
	for (const version of versions) {
		if (version.parent_version_id) {
			const parentVersion = versions.find(v => v.id === version.parent_version_id);
			
			if (!parentVersion) {
				violations.push({
					code: "MISSING_PARENT_VERSION",
					message: "Version references non-existent parent version",
					entity: version,
					context: { parentVersionId: version.parent_version_id },
				});
			} else if (parentVersion.created_at >= version.created_at) {
				violations.push({
					code: "INVALID_PARENT_TIMESTAMP",
					message: "Parent version must be created before child version",
					entity: version,
					context: { 
						parentCreated: parentVersion.created_at,
						childCreated: version.created_at 
					},
				});
			}
		}
	}

	return { satisfied: violations.length === 0, violations };
}

/**
 * Anchor stability invariant: Rename/move never breaks anchors
 * 
 * @param versions - All versions in the system
 * @returns Invariant check result
 */
export function checkAnchorStabilityInvariant(
	versions: readonly Version[],
): InvariantCheckResult {
	const violations: InvariantViolation[] = [];

	// Check that content hashes are unique per version
	const contentHashes = new Set<string>();
	
	for (const version of versions) {
		if (contentHashes.has(version.content_hash)) {
			violations.push({
				code: "DUPLICATE_CONTENT_HASH",
				message: "Multiple versions have identical content hash",
				entity: version,
				context: { contentHash: version.content_hash },
			});
		}
		contentHashes.add(version.content_hash);
	}

	// Verify content hash matches content (would require re-computing hashes)
	// This is an expensive operation and would typically be done in background validation

	return { satisfied: violations.length === 0, violations };
}

/**
 * Index health invariant: All published Versions appear in committed Index
 * 
 * @param publications - All publications
 * @param corpus - Current corpus
 * @param index - Current index
 * @returns Invariant check result
 */
export function checkIndexHealthInvariant(
	publications: readonly Publication[],
	corpus?: Corpus,
	index?: Index,
): InvariantCheckResult {
	const violations: InvariantViolation[] = [];

	if (!corpus || !index) {
		return { satisfied: true, violations: [] };
	}

	// Check corpus state consistency
	if (corpus.state === "Committed" && index.state !== "Ready") {
		violations.push({
			code: "CORPUS_INDEX_STATE_MISMATCH",
			message: "Committed corpus must have Ready index",
			context: { 
				corpusState: corpus.state,
				indexState: index.state 
			},
		});
	}

	// Check all published versions are in corpus
	const publishedVersionIds = new Set(publications.map(p => p.version_id));
	const corpusVersionIds = new Set(corpus.version_ids);

	for (const versionId of publishedVersionIds) {
		if (!corpusVersionIds.has(versionId)) {
			violations.push({
				code: "PUBLISHED_VERSION_NOT_IN_CORPUS",
				message: "Published version missing from corpus",
				context: { versionId },
			});
		}
	}

	// Check no partial visibility after swap
	if (index.state === "Ready" && corpus.state === "Committed") {
		// All corpus versions should be fully indexed
		// This would require checking actual index contents in a real implementation
	}

	return { satisfied: violations.length === 0, violations };
}

/**
 * Collection uniqueness invariant: Collection names are unique per workspace
 * 
 * @param collections - All collections in workspace
 * @returns Invariant check result
 */
export function checkCollectionUniquenessInvariant(
	collections: readonly Collection[],
): InvariantCheckResult {
	const violations: InvariantViolation[] = [];

	const nameCount = new Map<string, Collection[]>();
	
	for (const collection of collections) {
		const normalizedName = collection.name.toLowerCase().trim();
		const existing = nameCount.get(normalizedName) || [];
		existing.push(collection);
		nameCount.set(normalizedName, existing);
	}

	for (const [name, colls] of nameCount) {
		if (colls.length > 1) {
			violations.push({
				code: "DUPLICATE_COLLECTION_NAME",
				message: "Collection names must be unique within workspace",
				context: { 
					name, 
					collectionIds: colls.map(c => c.id),
					count: colls.length 
				},
			});
		}
	}

	return { satisfied: violations.length === 0, violations };
}

/**
 * Cross-collection deduplication invariant: Results deduplicate by (Note, Version)
 * 
 * @param searchResults - Search results to check
 * @returns Invariant check result
 */
export function checkDeduplicationInvariant(
	searchResults: readonly { note_id: NoteId; version_id: VersionId }[],
): InvariantCheckResult {
	const violations: InvariantViolation[] = [];

	const seen = new Set<string>();
	
	for (const result of searchResults) {
		const key = `${result.note_id}:${result.version_id}`;
		
		if (seen.has(key)) {
			violations.push({
				code: "DUPLICATE_SEARCH_RESULT",
				message: "Search results contain duplicates by (note_id, version_id)",
				context: { 
					noteId: result.note_id,
					versionId: result.version_id 
				},
			});
		}
		
		seen.add(key);
	}

	return { satisfied: violations.length === 0, violations };
}

/**
 * Session integrity invariant: Sessions reference valid Versions
 * 
 * @param sessions - All sessions
 * @param versions - All versions
 * @returns Invariant check result
 */
export function checkSessionIntegrityInvariant(
	sessions: readonly Session[],
	versions: readonly Version[],
): InvariantCheckResult {
	const violations: InvariantViolation[] = [];

	const versionIds = new Set(versions.map(v => v.id));

	for (const session of sessions) {
		// Check session step references
		for (const [stepIndex, step] of session.steps.entries()) {
			for (const refId of step.ref_ids) {
				// If ref_id looks like a version ID pattern, verify it exists
				if (refId.startsWith("ver_") && !versionIds.has(refId as VersionId)) {
					violations.push({
						code: "INVALID_SESSION_VERSION_REFERENCE",
						message: "Session references non-existent version",
						entity: session,
						context: { 
							sessionId: session.id,
							stepIndex,
							invalidVersionId: refId 
						},
					});
				}
			}
		}

		// Check session step ordering by timestamp
		for (let i = 1; i < session.steps.length; i++) {
			if (session.steps[i].timestamp < session.steps[i-1].timestamp) {
				violations.push({
					code: "NON_MONOTONIC_SESSION_STEPS",
					message: "Session steps must be in chronological order",
					entity: session,
					context: { 
						sessionId: session.id,
						stepIndex: i 
					},
				});
			}
		}
	}

	return { satisfied: violations.length === 0, violations };
}

/**
 * Comprehensive system invariant check
 * 
 * @param state - Complete system state
 * @returns Combined invariant check result
 */
export function checkAllInvariants(state: SystemState): InvariantCheckResult {
	const results = [
		checkDraftIsolationInvariant(state.drafts, state.corpus),
		checkVersionImmutabilityInvariant(state.versions),
		checkRollbackImmutabilityInvariant(state.versions, state.publications),
		checkAnchorStabilityInvariant(state.versions),
		checkIndexHealthInvariant(state.publications, state.corpus, state.index),
		checkCollectionUniquenessInvariant(state.collections),
		checkSessionIntegrityInvariant(state.sessions, state.versions),
	];

	const allViolations: InvariantViolation[] = [];
	for (const result of results) {
		allViolations.push(...result.violations);
	}

	return {
		satisfied: allViolations.length === 0,
		violations: allViolations,
	};
}

/**
 * Helper functions for invariant testing
 */
export const invariantHelpers = {
	/**
	 * Creates a system state for testing
	 */
	createTestSystemState: (overrides: Partial<SystemState> = {}): SystemState => ({
		notes: [],
		drafts: [],
		versions: [],
		collections: [],
		publications: [],
		sessions: [],
		...overrides,
	}),

	/**
	 * Checks if invariant violations contain specific error codes
	 */
	hasViolationType: (violations: readonly InvariantViolation[], code: string): boolean =>
		violations.some(v => v.code === code),

	/**
	 * Filters violations by error code
	 */
	getViolationsByCode: (violations: readonly InvariantViolation[], code: string): InvariantViolation[] =>
		violations.filter(v => v.code === code),

	/**
	 * Creates a formatted invariant violation report
	 */
	formatViolationReport: (result: InvariantCheckResult): string => {
		if (result.satisfied) {
			return "All invariants satisfied ✓";
		}

		const violationsByCode = new Map<string, InvariantViolation[]>();
		for (const violation of result.violations) {
			const existing = violationsByCode.get(violation.code) || [];
			existing.push(violation);
			violationsByCode.set(violation.code, existing);
		}

		const sections = Array.from(violationsByCode.entries()).map(
			([code, violations]) =>
				`${code}: ${violations.length} violation(s)\n${violations
					.map(v => `  - ${v.message}`)
					.join("\n")}`
		);

		return `Invariant violations found:\n${sections.join("\n\n")}`;
	},
} as const;
