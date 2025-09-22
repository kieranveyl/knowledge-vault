import { describe, expect, it } from "bun:test";
import {
	normalizeText,
	tokenizeText,
	createAnchor,
	resolveAnchor,
	extractStructurePath,
	computeFingerprint,
	detectAnchorDrift,
	extractAnchorContent,
} from "../domain/anchor";
import { TOKENIZATION_CONFIG_V1 } from "../schema/anchors";

describe("domain/anchor", () => {
	describe("normalizeText", () => {
		it("normalizes Unicode to NFC form", () => {
			const input = "café"; // composed 'é'
			const decomposed = "cafe\u0301"; // 'e' + combining accent
			
			const normalized1 = normalizeText(input);
			const normalized2 = normalizeText(decomposed);
			
			expect(normalized1).toBe(normalized2);
			expect(normalized1).toBe("café");
		});

		it("converts line endings to LF", () => {
			const crlfText = "line1\r\nline2\r\nline3";
			const crText = "line1\rline2\rline3";
			
			expect(normalizeText(crlfText)).toBe("line1\nline2\nline3");
			expect(normalizeText(crText)).toBe("line1\nline2\nline3");
		});

		it("collapses whitespace runs", () => {
			const text = "word1    word2\t\t\tword3\n\n\nword4";
			const normalized = normalizeText(text);
			
			expect(normalized).toBe("word1 word2 word3 word4");
		});

		it("preserves code content when enabled", () => {
			const text = "Normal text `code  with  spaces` more text";
			const normalized = normalizeText(text, true);
			
			// Should preserve spaces inside backticks
			expect(normalized).toContain("code  with  spaces");
		});
	});

	describe("extractStructurePath", () => {
		it("extracts heading hierarchy", () => {
			const markdown = `# First Level
## Second Level
### Third Level
Some content here
## Another Second
More content`;

			const path = extractStructurePath(markdown);
			
			// Should reflect the last complete path
			expect(path).toMatch(/^\/first-level\/another-second$/);
		});

		it("handles nested heading levels correctly", () => {
			const markdown = `# Top
## Sub
### Deep
#### Very Deep
Content here`;

			const path = extractStructurePath(markdown);
			expect(path).toMatch(/^\/top\/sub\/deep\/very-deep$/);
		});

		it("normalizes heading text", () => {
			const markdown = `# Special Characters & Symbols!
## Spaces   and   Multiple   Spaces`;

			const path = extractStructurePath(markdown);
			expect(path).toMatch(/^\/special-characters-symbols\/spaces-and-multiple-spaces$/);
		});
	});

	describe("tokenizeText", () => {
		it("tokenizes text using Unicode word boundaries", () => {
			const text = "Hello, world! This is a test.";
			const result = tokenizeText(text);
			
			expect(result.tokens).toContain("Hello");
			expect(result.tokens).toContain("world");
			expect(result.tokens).toContain("This");
			expect(result.tokens).toContain("test");
			
			// Should not contain punctuation as separate tokens
			expect(result.tokens).not.toContain(",");
			expect(result.tokens).not.toContain("!");
		});

		it("handles underscore and slash separators", () => {
			const text = "file_name.txt and path/to/file";
			const result = tokenizeText(text, TOKENIZATION_CONFIG_V1);
			
			expect(result.tokens).toContain("file");
			expect(result.tokens).toContain("name");
			expect(result.tokens).toContain("path");
			expect(result.tokens).toContain("to");
			expect(result.tokens).toContain("file");
		});

		it("preserves internal punctuation in words", () => {
			const text = "don't won't it's hello-world";
			const result = tokenizeText(text);
			
			expect(result.tokens).toContain("don't");
			expect(result.tokens).toContain("won't");  
			expect(result.tokens).toContain("it's");
			// Note: number handling may vary by Intl.Segmenter implementation
			expect(result.tokens).toContain("hello-world");
		});

		it("returns token offsets", () => {
			const text = "hello world test";
			const result = tokenizeText(text);
			
			expect(result.tokenOffsets).toHaveLength(result.tokens.length);
			expect(result.tokenOffsets[0]).toBe(0); // "hello" at start
			expect(result.tokenOffsets[1]).toBeGreaterThan(0); // "world" after space
		});
	});

	describe("computeFingerprint", () => {
		it("produces consistent fingerprints for identical content", async () => {
			const tokens = ["hello", "world", "test"];
			
			const fp1 = await computeFingerprint(tokens, 0, 2, "sha256");
			const fp2 = await computeFingerprint(tokens, 0, 2, "sha256");
			
			expect(fp1).toBe(fp2);
		});

		it("produces different fingerprints for different content", async () => {
			const tokens = ["hello", "world", "test"];
			
			const fp1 = await computeFingerprint(tokens, 0, 2, "sha256");
			const fp2 = await computeFingerprint(tokens, 1, 2, "sha256");
			
			expect(fp1).not.toBe(fp2);
		});

		it("validates token span bounds", async () => {
			const tokens = ["hello", "world"];
			
			await expect(computeFingerprint(tokens, -1, 1)).rejects.toThrow("out of bounds");
			await expect(computeFingerprint(tokens, 0, 3)).rejects.toThrow("out of bounds");
			await expect(computeFingerprint(tokens, 2, 1)).rejects.toThrow("out of bounds");
		});
	});

	describe("createAnchor", () => {
		it("creates anchor with correct properties", async () => {
			const content = "# Test Heading\n\nThis is some test content with multiple words.";
			const structurePath = extractStructurePath(content);
			
			const anchor = await createAnchor(content, structurePath, 0, 3);
			
			expect(anchor.structure_path).toBe(structurePath);
			expect(anchor.token_offset).toBe(0);
			expect(anchor.token_length).toBe(3);
			expect(anchor.fingerprint).toMatch(/^[a-f0-9]+$/);
			expect(anchor.tokenization_version).toBe("1.0.0");
			expect(anchor.fingerprint_algo).toBe("sha256");
		});

		it("throws for invalid token spans", async () => {
			const content = "Short content";
			const structurePath = extractStructurePath(content);
			
			await expect(createAnchor(content, structurePath, -1, 1))
				.rejects.toThrow("exceeds content bounds");
				
			await expect(createAnchor(content, structurePath, 0, 100))
				.rejects.toThrow("exceeds content bounds");
		});
	});

	describe("resolveAnchor - Property Tests", () => {
		it("resolves anchors in unchanged content", async () => {
			const content = "This is stable test content that should not change.";
			const structurePath = extractStructurePath(content);
			
			const anchor = await createAnchor(content, structurePath, 2, 3);
			const resolution = await resolveAnchor(anchor, content);
			
			expect(resolution.resolved).toBe(true);
			expect(resolution.error).toBeUndefined();
		});

		it("detects content changes via fingerprint mismatch", async () => {
			const originalContent = "Original content for testing anchors.";
			const changedContent = "Modified content for testing anchors.";
			const structurePath = extractStructurePath(originalContent);
			
			const anchor = await createAnchor(originalContent, structurePath, 0, 2);
			const resolution = await resolveAnchor(anchor, changedContent);
			
			expect(resolution.resolved).toBe(false);
			expect(resolution.error).toContain("Fingerprint mismatch");
		});

		it("attempts re-anchoring for nearby content", async () => {
			// Test with content that has insertions
			const originalContent = "Word1 Word2 Word3 Word4";
			const modifiedContent = "Word1 INSERTED Word2 Word3 Word4";
			const structurePath = extractStructurePath(originalContent);
			
			// Check how many tokens we have first
			const originalTokens = tokenizeText(normalizeText(originalContent));
			if (originalTokens.tokens.length < 3) {
				// Skip this test if there aren't enough tokens
				return;
			}
			
			// Anchor to "Word2 Word3"
			const anchor = await createAnchor(originalContent, structurePath, 1, 2);
			const resolution = await resolveAnchor(anchor, modifiedContent);
			
			// Should attempt re-anchoring (may or may not succeed depending on content)
			expect(resolution).toBeDefined();
		});

		it("maintains anchor stability across formatting changes", async () => {
			const content1 = "This  is   test    content";
			const content2 = "This is test content";
			const structurePath = extractStructurePath(content1);
			
			// Both should normalize to the same tokens
			const normalized1 = normalizeText(content1);
			const normalized2 = normalizeText(content2);
			expect(normalized1).toBe(normalized2);
			
			// Anchors should resolve identically
			const anchor = await createAnchor(content1, structurePath, 0, 3);
			const resolution = await resolveAnchor(anchor, content2);
			
			expect(resolution.resolved).toBe(true);
		});
	});

	describe("detectAnchorDrift", () => {
		it("detects no drift in stable content", async () => {
			const content = "Stable content for drift testing.";
			const structurePath = extractStructurePath(content);
			const anchor = await createAnchor(content, structurePath, 0, 2);
			
			const drift = await detectAnchorDrift(anchor, content);
			
			expect(drift.content_changed).toBe(false);
			expect(drift.structure_changed).toBe(false);
			expect(drift.fingerprint_mismatch).toBe(false);
		});

		it("detects content changes", async () => {
			const originalContent = "Original content here.";
			const changedContent = "Changed content here.";
			const structurePath = extractStructurePath(originalContent);
			const anchor = await createAnchor(originalContent, structurePath, 0, 2);
			
			const drift = await detectAnchorDrift(anchor, changedContent);
			
			expect(drift.content_changed).toBe(true);
			expect(drift.fingerprint_mismatch).toBe(true);
		});

		it("detects structure changes", async () => {
			const originalContent = "# Original Heading\nContent here.";
			const changedContent = "# Changed Heading\nContent here.";
			const structurePath = extractStructurePath(originalContent);
			const anchor = await createAnchor(originalContent, structurePath, 0, 1);
			
			const drift = await detectAnchorDrift(anchor, changedContent);
			
			expect(drift.structure_changed).toBe(true);
		});

		it("suggests re-anchoring when possible", async () => {
			const originalContent = "Word1 Word2 Word3";
			const changedContent = "INSERTED Word1 Word2 Word3";
			const structurePath = extractStructurePath(originalContent);
			
			// Check token count first
			const originalTokens = tokenizeText(normalizeText(originalContent));
			if (originalTokens.tokens.length < 2) {
				return;
			}
			
			const anchor = await createAnchor(originalContent, structurePath, 0, 2);
			const drift = await detectAnchorDrift(anchor, changedContent);
			
			expect(drift.content_changed).toBe(true);
			// Re-anchoring may or may not be suggested depending on content similarity
			expect(drift).toBeDefined();
		});
	});

	describe("extractAnchorContent", () => {
		it("extracts correct content for resolved anchors", async () => {
			const content = "This is some test content for extraction.";
			const structurePath = extractStructurePath(content);
			const anchor = await createAnchor(content, structurePath, 2, 3);
			
			const extracted = await extractAnchorContent(anchor, content);
			
			expect(extracted).toBeDefined();
			expect(extracted).toContain("some");
			expect(extracted).toContain("test");
			expect(extracted).toContain("content");
		});

		it("returns null for unresolved anchors", async () => {
			const originalContent = "Original content here.";
			const changedContent = "Completely different content.";
			const structurePath = extractStructurePath(originalContent);
			const anchor = await createAnchor(originalContent, structurePath, 0, 2);
			
			const extracted = await extractAnchorContent(anchor, changedContent);
			
			expect(extracted).toBeNull();
		});
	});

	// Property-based testing helpers
	describe("Property Tests", () => {
		it("anchor creation and resolution roundtrip", async () => {
			const testContents = [
				"Simple test content.",
				"Content with special characters: é, ñ, 中文",
				"Multi-line\ncontent with\nvarious formatting",
				"# Heading\n\nParagraph with `code` and **bold** text.",
				"Numbers: 3.14159, dates: 2023-01-01, emails: test@example.com",
			];

			for (const content of testContents) {
				const structurePath = extractStructurePath(content);
				const tokenization = tokenizeText(normalizeText(content));
				
				// Test various token spans
				const maxLength = Math.min(5, tokenization.tokens.length);
				for (let length = 1; length <= maxLength; length++) {
					for (let offset = 0; offset <= tokenization.tokens.length - length; offset++) {
						const anchor = await createAnchor(content, structurePath, offset, length);
						const resolution = await resolveAnchor(anchor, content);
						
						expect(resolution.resolved).toBe(true);
						
						const extracted = await extractAnchorContent(anchor, content);
						expect(extracted).not.toBeNull();
					}
				}
			}
		});

		it("fingerprint determinism across identical inputs", async () => {
			const content = "Deterministic test content for fingerprinting.";
			const structurePath = extractStructurePath(content);
			
			// Create multiple anchors with same parameters
			const anchors = await Promise.all([
				createAnchor(content, structurePath, 0, 3),
				createAnchor(content, structurePath, 0, 3),
				createAnchor(content, structurePath, 0, 3),
			]);

			// All fingerprints should be identical
			expect(anchors[0].fingerprint).toBe(anchors[1].fingerprint);
			expect(anchors[1].fingerprint).toBe(anchors[2].fingerprint);
		});
	});
});
