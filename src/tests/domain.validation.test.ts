import { describe, expect, it } from "bun:test";
import {
	validateNote,
	validateDraft,
	validateCollection,
	validatePublicationReadiness,
	analyzeContent,
	validateVersionTransition,
	validateCollectionMembership,
	quickValidation,
} from "../domain/validation";
import type { Note, Draft, Collection, Version, NoteMetadata } from "../schema/entities";

describe("domain/validation", () => {
	const createTestNote = (overrides: Partial<Note> = {}): Note => ({
		id: "note_01JBXR8G9P7QN1VMPX84KTFHK2" as any,
		title: "Test Note",
		metadata: { tags: ["test"] },
		created_at: new Date("2025-01-01"),
		updated_at: new Date("2025-01-01"),
		...overrides,
	});

	const createTestDraft = (overrides: Partial<Draft> = {}): Draft => ({
		note_id: "note_01JBXR8G9P7QN1VMPX84KTFHK2" as any,
		body_md: "# Test Content\n\nThis is test content.",
		metadata: { tags: ["test"] },
		autosave_ts: new Date(),
		...overrides,
	});

	const createTestCollection = (overrides: Partial<Collection> = {}): Collection => ({
		id: "col_01JBXR8G9P7QN1VMPX84KTFHK2" as any,
		name: "Test Collection",
		created_at: new Date(),
		...overrides,
	});

	describe("validateNote", () => {
		it("validates valid note", () => {
			const note = createTestNote();
			const result = validateNote(note);

			expect(result.valid).toBe(true);
			expect(result.errors).toHaveLength(0);
		});

		it("rejects empty title", () => {
			const note = createTestNote({ title: "" });
			const result = validateNote(note);

			expect(result.valid).toBe(false);
			expect(result.errors).toContainEqual(
				expect.objectContaining({
					code: "TITLE_EMPTY",
					field: "title",
				})
			);
		});

		it("rejects title that is too long", () => {
			const note = createTestNote({ title: "x".repeat(201) });
			const result = validateNote(note);

			expect(result.valid).toBe(false);
			expect(result.errors).toContainEqual(
				expect.objectContaining({
					code: "TITLE_TOO_LONG",
					field: "title",
				})
			);
		});

		it("validates metadata tags", () => {
			const note = createTestNote({
				metadata: { tags: ["a".repeat(41)] }, // Too long
			});
			const result = validateNote(note);

			expect(result.valid).toBe(false);
			expect(result.errors).toContainEqual(
				expect.objectContaining({
					code: "TAG_TOO_LONG",
					field: "metadata.tags[0]",
				})
			);
		});

		it("rejects invalid timestamps", () => {
			const note = createTestNote({
				created_at: new Date("2025-01-02"),
				updated_at: new Date("2025-01-01"), // Before created
			});
			const result = validateNote(note);

			expect(result.valid).toBe(false);
			expect(result.errors).toContainEqual(
				expect.objectContaining({
					code: "INVALID_TIMESTAMPS",
					field: "updated_at",
				})
			);
		});

		it("warns about duplicate tags", () => {
			const note = createTestNote({
				metadata: { tags: ["test", "Test", "other"] }, // Duplicate (case-insensitive)
			});
			const result = validateNote(note);

			expect(result.valid).toBe(true); // Warnings don't make it invalid
			expect(result.warnings).toContainEqual(
				expect.objectContaining({
					code: "DUPLICATE_TAG",
					field: "metadata.tags[0]",
				})
			);
		});
	});

	describe("validateDraft", () => {
		it("validates valid draft", () => {
			const draft = createTestDraft();
			const result = validateDraft(draft);

			expect(result.valid).toBe(true);
			expect(result.errors).toHaveLength(0);
		});

		it("rejects content that is too long", () => {
			const draft = createTestDraft({
				body_md: "x".repeat(1_000_001), // Exceeds limit
			});
			const result = validateDraft(draft);

			expect(result.valid).toBe(false);
			expect(result.errors).toContainEqual(
				expect.objectContaining({
					code: "CONTENT_TOO_LONG",
					field: "body_md",
				})
			);
		});

		it("warns about very short content", () => {
			const draft = createTestDraft({
				body_md: "Short", // Only 1 word
			});
			const result = validateDraft(draft);

			expect(result.valid).toBe(true);
			expect(result.warnings).toContainEqual(
				expect.objectContaining({
					code: "CONTENT_TOO_SHORT",
					field: "body_md",
				})
			);
		});
	});

	describe("validateCollection", () => {
		it("validates valid collection", () => {
			const collection = createTestCollection();
			const result = validateCollection(collection);

			expect(result.valid).toBe(true);
			expect(result.errors).toHaveLength(0);
		});

		it("rejects empty name", () => {
			const collection = createTestCollection({ name: "" });
			const result = validateCollection(collection);

			expect(result.valid).toBe(false);
			expect(result.errors).toContainEqual(
				expect.objectContaining({
					code: "COLLECTION_NAME_EMPTY",
					field: "name",
				})
			);
		});

		it("rejects reserved names", () => {
			const collection = createTestCollection({ name: "all" });
			const result = validateCollection(collection);

			expect(result.valid).toBe(false);
			expect(result.errors).toContainEqual(
				expect.objectContaining({
					code: "RESERVED_COLLECTION_NAME",
					field: "name",
				})
			);
		});

		it("rejects invalid characters in name", () => {
			const collection = createTestCollection({ name: "test@collection!" });
			const result = validateCollection(collection);

			expect(result.valid).toBe(false);
			expect(result.errors).toContainEqual(
				expect.objectContaining({
					code: "INVALID_COLLECTION_NAME",
					field: "name",
				})
			);
		});

		it("rejects description that is too long", () => {
			const collection = createTestCollection({
				description: "x".repeat(501),
			});
			const result = validateCollection(collection);

			expect(result.valid).toBe(false);
			expect(result.errors).toContainEqual(
				expect.objectContaining({
					code: "DESCRIPTION_TOO_LONG",
					field: "description",
				})
			);
		});
	});

	describe("validatePublicationReadiness", () => {
		it("validates ready-to-publish content", () => {
			const result = validatePublicationReadiness(
				"Valid Title",
				"# Heading\n\nContent here.",
				{ tags: ["test"] },
				["col_01JBXR8G9P7QN1VMPX84KTFHK2"] as any[]
			);

			expect(result.valid).toBe(true);
		});

		it("rejects missing title", () => {
			const result = validatePublicationReadiness(
				"",
				"Content here.",
				{},
				["col_01JBXR8G9P7QN1VMPX84KTFHK2"] as any[]
			);

			expect(result.valid).toBe(false);
		});

		it("rejects missing collections", () => {
			const result = validatePublicationReadiness(
				"Valid Title",
				"Content here.",
				{},
				[]
			);

			expect(result.valid).toBe(false);
		});
	});

	describe("analyzeContent", () => {
		it("analyzes content features correctly", () => {
			const content = `# Main Heading

This is a paragraph with **bold** text and some \`inline code\`.

## Subheading

Another paragraph with a [link](https://example.com) and an image:

![Alt text](image.png)

\`\`\`javascript
const code = "block";
\`\`\`

Final paragraph.`;

			const analysis = analyzeContent(content);

			expect(analysis.wordCount).toBeGreaterThan(20);
			expect(analysis.characterCount).toBe(content.length);
			expect(analysis.estimatedReadingTimeMinutes).toBeGreaterThan(0);
			expect(analysis.hasCodeBlocks).toBe(true);
			expect(analysis.hasImages).toBe(true);
			expect(analysis.hasLinks).toBe(true);
			expect(analysis.headingCount).toBe(2);
			expect(analysis.maxHeadingLevel).toBe(2);
		});

		it("handles content without special features", () => {
			const content = "Simple text without any special formatting.";
			const analysis = analyzeContent(content);

			expect(analysis.hasCodeBlocks).toBe(false);
			expect(analysis.hasImages).toBe(false);
			expect(analysis.hasLinks).toBe(false);
			expect(analysis.headingCount).toBe(0);
			expect(analysis.maxHeadingLevel).toBe(0);
		});
	});

	describe("validateVersionTransition", () => {
		const createTestVersion = (overrides: Partial<Version> = {}): Version => ({
			id: "ver_01JBXR8G9P7QN1VMPX84KTFHK2" as any,
			note_id: "note_01JBXR8G9P7QN1VMPX84KTFHK2" as any,
			content_md: "Content here",
			metadata: {},
			content_hash: "abc123def456" as any,
			created_at: new Date("2025-01-01"),
			label: "minor",
			...overrides,
		});

		it("validates valid version transition", () => {
			const currentVersion = createTestVersion({
				created_at: new Date("2025-01-01"),
			});
			const newVersion = createTestVersion({
				id: "ver_01JBXR8G9P7QN1VMPX84KTFHK3" as any,
				parent_version_id: currentVersion.id,
				content_hash: "different123hash" as any,
				created_at: new Date("2025-01-02"),
			});

			const result = validateVersionTransition(currentVersion, newVersion);

			expect(result.valid).toBe(true);
		});

		it("rejects empty version content", () => {
			const newVersion = createTestVersion({ content_md: "" });
			const result = validateVersionTransition(undefined, newVersion);

			expect(result.valid).toBe(false);
			expect(result.errors).toContainEqual(
				expect.objectContaining({
					code: "EMPTY_VERSION_CONTENT",
					field: "content_md",
				})
			);
		});

		it("warns about duplicate content hash", () => {
			const currentVersion = createTestVersion();
			const newVersion = createTestVersion({
				id: "ver_01JBXR8G9P7QN1VMPX84KTFHK3" as any,
				parent_version_id: currentVersion.id,
				content_hash: currentVersion.content_hash, // Same hash
			});

			const result = validateVersionTransition(currentVersion, newVersion);

			expect(result.warnings).toContainEqual(
				expect.objectContaining({
					code: "DUPLICATE_CONTENT_HASH",
					field: "content_hash",
				})
			);
		});

		it("rejects invalid timestamp ordering", () => {
			const currentVersion = createTestVersion({
				created_at: new Date("2025-01-02"),
			});
			const newVersion = createTestVersion({
				id: "ver_01JBXR8G9P7QN1VMPX84KTFHK3" as any,
				created_at: new Date("2025-01-01"), // Earlier than current
			});

			const result = validateVersionTransition(currentVersion, newVersion);

			expect(result.valid).toBe(false);
			expect(result.errors).toContainEqual(
				expect.objectContaining({
					code: "INVALID_VERSION_TIMESTAMP",
					field: "created_at",
				})
			);
		});
	});

	describe("validateCollectionMembership", () => {
		it("validates valid collection membership", () => {
			const result = validateCollectionMembership(
				"note_01JBXR8G9P7QN1VMPX84KTFHK2" as any,
				["col_01JBXR8G9P7QN1VMPX84KTFHK2", "col_01JBXR8G9P7QN1VMPX84KTFHK3"] as any[]
			);

			expect(result.valid).toBe(true);
		});

		it("rejects too many collections per note", () => {
			const manyCollections = Array.from({ length: 11 }, (_, i) => 
				`col_${i.toString().padStart(26, '0')}` as any
			);

			const result = validateCollectionMembership(
				"note_01JBXR8G9P7QN1VMPX84KTFHK2" as any,
				manyCollections
			);

			expect(result.valid).toBe(false);
			expect(result.errors).toContainEqual(
				expect.objectContaining({
					code: "TOO_MANY_COLLECTIONS_PER_NOTE",
					field: "collections",
				})
			);
		});

		it("warns about duplicate collections", () => {
			const result = validateCollectionMembership(
				"note_01JBXR8G9P7QN1VMPX84KTFHK2" as any,
				[
					"col_01JBXR8G9P7QN1VMPX84KTFHK2",
					"col_01JBXR8G9P7QN1VMPX84KTFHK2", // Duplicate
					"col_01JBXR8G9P7QN1VMPX84KTFHK3"
				] as any[]
			);

			expect(result.valid).toBe(true); // Warning doesn't invalidate
			expect(result.warnings).toContainEqual(
				expect.objectContaining({
					code: "DUPLICATE_COLLECTIONS",
					field: "collections",
				})
			);
		});
	});

	describe("quickValidation", () => {
		it("checks publication readiness", () => {
			expect(quickValidation.isPublicationReady("Valid Title", ["col_1"])).toBe(true);
			expect(quickValidation.isPublicationReady("", ["col_1"])).toBe(false);
			expect(quickValidation.isPublicationReady("Valid Title", [])).toBe(false);
		});

		it("checks content length validity", () => {
			expect(quickValidation.isContentLengthValid("Short content")).toBe(true);
			expect(quickValidation.isContentLengthValid("x".repeat(1_000_001))).toBe(false);
		});

		it("checks title validity", () => {
			expect(quickValidation.isTitleValid("Valid Title")).toBe(true);
			expect(quickValidation.isTitleValid("")).toBe(false);
			expect(quickValidation.isTitleValid("x".repeat(201))).toBe(false);
		});

		it("checks collection name validity", () => {
			expect(quickValidation.isCollectionNameValid("Valid Name")).toBe(true);
			expect(quickValidation.isCollectionNameValid("")).toBe(false);
			expect(quickValidation.isCollectionNameValid("all")).toBe(false); // Reserved
			expect(quickValidation.isCollectionNameValid("invalid@name")).toBe(false);
		});
	});

	describe("Edge Cases and Integration", () => {
		it("handles metadata with maximum allowed tags", () => {
			const metadata: NoteMetadata = {
				tags: Array.from({ length: 15 }, (_, i) => `tag${i}`),
			};
			const note = createTestNote({ metadata });
			const result = validateNote(note);

			expect(result.valid).toBe(true);
		});

		it("rejects metadata with too many tags", () => {
			const metadata: NoteMetadata = {
				tags: Array.from({ length: 16 }, (_, i) => `tag${i}`),
			};
			const note = createTestNote({ metadata });
			const result = validateNote(note);

			expect(result.valid).toBe(false);
			expect(result.errors).toContainEqual(
				expect.objectContaining({
					code: "TOO_MANY_TAGS",
				})
			);
		});

		it("validates complex real-world content", () => {
			const complexContent = `# Research Paper: AI in Healthcare

## Abstract

This paper explores the applications of artificial intelligence in modern healthcare systems.

### Key Findings

- AI improves diagnostic accuracy by 23%
- Patient satisfaction increases when AI is used for scheduling
- Cost reduction of approximately $2.1M annually

## Methodology

We analyzed data from 150 hospitals across North America over a 2-year period.

\`\`\`python
# Sample analysis code
def analyze_patient_data(data):
    return data.groupby('hospital').mean()
\`\`\`

## Conclusions

The integration of AI in healthcare shows promising results...

---

**References:**
1. Smith, J. et al. (2024). "AI Applications in Medicine"
2. Johnson, M. (2023). "Healthcare Technology Trends"
`;

			const analysis = analyzeContent(complexContent);

			expect(analysis.wordCount).toBeGreaterThan(50);
			expect(analysis.hasCodeBlocks).toBe(true);
			expect(analysis.headingCount).toBeGreaterThan(3); // At least 4 headings
			expect(analysis.maxHeadingLevel).toBeGreaterThanOrEqual(2);
		});
	});
});
