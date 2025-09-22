/**
 * Domain validation logic for business rules and constraints
 *
 * References SPEC.md Section 3: Publication validation policy
 * Pure functions for validating domain entities and operations
 */

import type {
  Collection,
  CollectionId,
  Draft,
  Note,
  NoteId,
  NoteMetadata,
  Version,
} from "../schema/entities";

import {
  isPublicationReady,
  PUBLICATION_POLICY,
  validatePublication,
  type PublicationValidationRequest,
  type PublicationValidationResult,
} from "../policy/publication";

/**
 * Validation result for domain operations
 */
export interface ValidationResult {
  readonly valid: boolean;
  readonly errors: readonly ValidationError[];
  readonly warnings: readonly ValidationWarning[];
}

/**
 * Domain validation error
 */
export interface ValidationError {
  readonly code: string;
  readonly field: string;
  readonly message: string;
  readonly value?: unknown;
}

/**
 * Domain validation warning
 */
export interface ValidationWarning {
  readonly code: string;
  readonly field: string;
  readonly message: string;
  readonly value?: unknown;
}

/**
 * Content analysis result for validation
 */
export interface ContentAnalysis {
  readonly wordCount: number;
  readonly characterCount: number;
  readonly estimatedReadingTimeMinutes: number;
  readonly hasCodeBlocks: boolean;
  readonly hasImages: boolean;
  readonly hasLinks: boolean;
  readonly headingCount: number;
  readonly maxHeadingLevel: number;
}

/**
 * Collection validation constraints
 */
export interface CollectionConstraints {
  readonly maxNotesPerCollection: number;
  readonly maxCollectionsPerNote: number;
  readonly reservedNames: readonly string[];
}

/**
 * Default collection constraints
 */
export const DEFAULT_COLLECTION_CONSTRAINTS: CollectionConstraints = {
  maxNotesPerCollection: 10000,
  maxCollectionsPerNote: 10,
  reservedNames: ["all", "drafts", "published", "system", "admin"],
} as const;

/**
 * Validates a Note entity
 *
 * @param note - Note to validate
 * @returns Validation result
 */
export function validateNote(note: Note): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  // Validate title length
  if (note.title.trim().length === 0) {
    errors.push({
      code: "TITLE_EMPTY",
      field: "title",
      message: "Note title cannot be empty",
      value: note.title,
    });
  }

  if (note.title.length > PUBLICATION_POLICY.TITLE_MAX_LENGTH) {
    errors.push({
      code: "TITLE_TOO_LONG",
      field: "title",
      message: `Title exceeds maximum length of ${PUBLICATION_POLICY.TITLE_MAX_LENGTH} characters`,
      value: note.title.length,
    });
  }

  // Validate metadata
  const metadataValidation = validateNoteMetadata(note.metadata);
  errors.push(...metadataValidation.errors);
  warnings.push(...metadataValidation.warnings);

  // Validate timestamps
  if (note.updated_at < note.created_at) {
    errors.push({
      code: "INVALID_TIMESTAMPS",
      field: "updated_at",
      message: "Updated timestamp cannot be before created timestamp",
      value: { created_at: note.created_at, updated_at: note.updated_at },
    });
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validates Note metadata
 *
 * @param metadata - Note metadata to validate
 * @returns Validation result
 */
export function validateNoteMetadata(metadata: NoteMetadata): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  if (metadata.tags) {
    // Validate tag count
    if (metadata.tags.length > PUBLICATION_POLICY.MAX_TAGS) {
      errors.push({
        code: "TOO_MANY_TAGS",
        field: "metadata.tags",
        message: `Cannot exceed ${PUBLICATION_POLICY.MAX_TAGS} tags`,
        value: metadata.tags.length,
      });
    }

    // Validate individual tags
    for (const [index, tag] of metadata.tags.entries()) {
      if (tag.length < PUBLICATION_POLICY.TAG_MIN_LENGTH) {
        errors.push({
          code: "TAG_TOO_SHORT",
          field: `metadata.tags[${index}]`,
          message: `Tag must be at least ${PUBLICATION_POLICY.TAG_MIN_LENGTH} character`,
          value: tag,
        });
      }

      if (tag.length > PUBLICATION_POLICY.TAG_MAX_LENGTH) {
        errors.push({
          code: "TAG_TOO_LONG",
          field: `metadata.tags[${index}]`,
          message: `Tag cannot exceed ${PUBLICATION_POLICY.TAG_MAX_LENGTH} characters`,
          value: tag,
        });
      }

      // Check for duplicate tags (case-insensitive)
      const duplicateIndex = metadata.tags.findIndex(
        (otherTag, otherIndex) =>
          otherIndex > index && otherTag.toLowerCase() === tag.toLowerCase(),
      );
      if (duplicateIndex !== -1) {
        warnings.push({
          code: "DUPLICATE_TAG",
          field: `metadata.tags[${index}]`,
          message: "Tag appears multiple times",
          value: tag,
        });
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validates a Draft entity
 *
 * @param draft - Draft to validate
 * @returns Validation result
 */
export function validateDraft(draft: Draft): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  // Validate content length
  if (draft.body_md.length > PUBLICATION_POLICY.MAX_CONTENT_LENGTH) {
    errors.push({
      code: "CONTENT_TOO_LONG",
      field: "body_md",
      message: `Content exceeds maximum length of ${PUBLICATION_POLICY.MAX_CONTENT_LENGTH} characters`,
      value: draft.body_md.length,
    });
  }

  // Validate metadata
  const metadataValidation = validateNoteMetadata(draft.metadata);
  errors.push(...metadataValidation.errors);
  warnings.push(...metadataValidation.warnings);

  // Content quality warnings
  const contentAnalysis = analyzeContent(draft.body_md);
  if (contentAnalysis.wordCount < 10) {
    warnings.push({
      code: "CONTENT_TOO_SHORT",
      field: "body_md",
      message: "Content appears to be very short",
      value: contentAnalysis.wordCount,
    });
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validates a Collection entity
 *
 * @param collection - Collection to validate
 * @param constraints - Collection constraints
 * @returns Validation result
 */
export function validateCollection(
  collection: Collection,
  constraints: CollectionConstraints = DEFAULT_COLLECTION_CONSTRAINTS,
): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  // Validate name
  if (collection.name.trim().length === 0) {
    errors.push({
      code: "COLLECTION_NAME_EMPTY",
      field: "name",
      message: "Collection name cannot be empty",
      value: collection.name,
    });
  }

  if (collection.name.length > 100) {
    errors.push({
      code: "COLLECTION_NAME_TOO_LONG",
      field: "name",
      message: "Collection name cannot exceed 100 characters",
      value: collection.name.length,
    });
  }

  // Check for reserved names
  if (constraints.reservedNames.includes(collection.name.toLowerCase())) {
    errors.push({
      code: "RESERVED_COLLECTION_NAME",
      field: "name",
      message: "Collection name is reserved",
      value: collection.name,
    });
  }

  // Validate name format (alphanumeric, spaces, hyphens, underscores)
  if (!/^[a-zA-Z0-9\s\-_]+$/.test(collection.name)) {
    errors.push({
      code: "INVALID_COLLECTION_NAME",
      field: "name",
      message: "Collection name contains invalid characters",
      value: collection.name,
    });
  }

  // Validate description length if present
  if (collection.description && collection.description.length > 500) {
    errors.push({
      code: "DESCRIPTION_TOO_LONG",
      field: "description",
      message: "Description cannot exceed 500 characters",
      value: collection.description.length,
    });
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validates publication readiness
 *
 * @param noteTitle - Note title
 * @param content - Markdown content
 * @param metadata - Note metadata
 * @param targetCollections - Target collection IDs
 * @returns Publication validation result
 */
export function validatePublicationReadiness(
  noteTitle: string,
  content: string,
  metadata: NoteMetadata,
  targetCollections: CollectionId[],
): PublicationValidationResult {
  const request: PublicationValidationRequest = {
    title: noteTitle,
    content_md: content,
    metadata: {
      tags: metadata.tags,
    },
    target_collections: targetCollections,
  };

  return validatePublication(request);
}

/**
 * Analyzes content for validation and quality metrics
 *
 * @param content - Markdown content to analyze
 * @returns Content analysis result
 */
export function analyzeContent(content: string): ContentAnalysis {
  // Basic word count (rough estimate)
  const words = content
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0);
  const wordCount = words.length;

  // Character count
  const characterCount = content.length;

  // Estimated reading time (200 words per minute average)
  const estimatedReadingTimeMinutes = Math.ceil(wordCount / 200);

  // Feature detection
  const hasCodeBlocks = /```/.test(content) || /`[^`\n]+`/.test(content);
  const hasImages = /!\[.*?\]\(.*?\)/.test(content);
  const hasLinks = /\[.*?\]\(.*?\)/.test(content);

  // Heading analysis
  const headingMatches = content.match(/^#{1,6}\s+.+$/gm) || [];
  const headingCount = headingMatches.length;
  const maxHeadingLevel = headingMatches.reduce((max, heading) => {
    const level = heading.match(/^#{1,6}/)?.[0].length || 0;
    return Math.max(max, level);
  }, 0);

  return {
    wordCount,
    characterCount,
    estimatedReadingTimeMinutes,
    hasCodeBlocks,
    hasImages,
    hasLinks,
    headingCount,
    maxHeadingLevel,
  };
}

/**
 * Validates version transition constraints
 *
 * @param currentVersion - Current version (optional for new notes)
 * @param newVersion - New version being created
 * @returns Validation result
 */
export function validateVersionTransition(
  currentVersion: Version | undefined,
  newVersion: Version,
): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  // Validate version has content
  if (newVersion.content_md.trim().length === 0) {
    errors.push({
      code: "EMPTY_VERSION_CONTENT",
      field: "content_md",
      message: "Version content cannot be empty",
      value: newVersion.content_md,
    });
  }

  // Validate parent version reference for non-initial versions
  if (currentVersion) {
    if (newVersion.parent_version_id !== currentVersion.id) {
      warnings.push({
        code: "MISMATCHED_PARENT_VERSION",
        field: "parent_version_id",
        message: "New version does not reference current version as parent",
        value: {
          expected: currentVersion.id,
          actual: newVersion.parent_version_id,
        },
      });
    }

    // Check for content hash collision
    if (newVersion.content_hash === currentVersion.content_hash) {
      warnings.push({
        code: "DUPLICATE_CONTENT_HASH",
        field: "content_hash",
        message: "New version has identical content to current version",
        value: newVersion.content_hash,
      });
    }
  } else {
    // Initial version should not have parent
    if (newVersion.parent_version_id) {
      warnings.push({
        code: "INITIAL_VERSION_HAS_PARENT",
        field: "parent_version_id",
        message: "Initial version should not reference a parent",
        value: newVersion.parent_version_id,
      });
    }
  }

  // Validate timestamps
  if (currentVersion && newVersion.created_at <= currentVersion.created_at) {
    errors.push({
      code: "INVALID_VERSION_TIMESTAMP",
      field: "created_at",
      message: "New version timestamp must be after current version",
      value: {
        current: currentVersion.created_at,
        new: newVersion.created_at,
      },
    });
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validates business rule constraints for cross-entity operations
 *
 * @param noteId - Note ID
 * @param collectionIds - Collection IDs note will belong to
 * @param constraints - Collection constraints
 * @returns Validation result
 */
export function validateCollectionMembership(
  noteId: NoteId,
  collectionIds: CollectionId[],
  constraints: CollectionConstraints = DEFAULT_COLLECTION_CONSTRAINTS,
): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  // Validate collection count per note
  if (collectionIds.length > constraints.maxCollectionsPerNote) {
    errors.push({
      code: "TOO_MANY_COLLECTIONS_PER_NOTE",
      field: "collections",
      message: `Note cannot belong to more than ${constraints.maxCollectionsPerNote} collections`,
      value: collectionIds.length,
    });
  }

  // Check for duplicate collections
  const uniqueCollections = new Set(collectionIds);
  if (uniqueCollections.size !== collectionIds.length) {
    warnings.push({
      code: "DUPLICATE_COLLECTIONS",
      field: "collections",
      message: "Note is assigned to duplicate collections",
      value: collectionIds.length - uniqueCollections.size,
    });
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Creates a comprehensive validation error summary
 *
 * @param results - Array of validation results
 * @returns Combined validation summary
 */
export function combineValidationResults(
  results: readonly ValidationResult[],
): ValidationResult {
  const allErrors: ValidationError[] = [];
  const allWarnings: ValidationWarning[] = [];

  for (const result of results) {
    allErrors.push(...result.errors);
    allWarnings.push(...result.warnings);
  }

  return {
    valid: allErrors.length === 0,
    errors: allErrors,
    warnings: allWarnings,
  };
}

/**
 * Quick validation helpers for common checks
 */
export const quickValidation = {
  /**
   * Checks if a note is ready for publication
   */
  isPublicationReady: (
    title: string,
    collections: string[],
    metadata?: NoteMetadata,
  ): boolean => {
    return isPublicationReady(title, collections, metadata);
  },

  /**
   * Checks if content length is within limits
   */
  isContentLengthValid: (content: string): boolean => {
    return content.length <= PUBLICATION_POLICY.MAX_CONTENT_LENGTH;
  },

  /**
   * Checks if title is valid
   */
  isTitleValid: (title: string): boolean => {
    const trimmed = title.trim();
    return (
      trimmed.length >= PUBLICATION_POLICY.TITLE_MIN_LENGTH &&
      trimmed.length <= PUBLICATION_POLICY.TITLE_MAX_LENGTH
    );
  },

  /**
   * Checks if collection name is valid
   */
  isCollectionNameValid: (
    name: string,
    constraints: CollectionConstraints = DEFAULT_COLLECTION_CONSTRAINTS,
  ): boolean => {
    return (
      name.trim().length > 0 &&
      name.length <= 100 &&
      !/[^\w\s\-_]/.test(name) &&
      !constraints.reservedNames.includes(name.toLowerCase())
    );
  },
} as const;
