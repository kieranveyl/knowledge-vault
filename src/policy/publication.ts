/**
 * Publication validation policy and business rules
 *
 * References SPEC.md Section 3: Publication validation policy (required metadata)
 * Defines validation rules for note publication requirements
 */

import { Schema } from "@effect/schema";
import type { NoteMetadata } from "../schema/entities";

/**
 * Publication validation policy constants
 *
 * @see SPEC.md Section 3: "title required (1..200 chars); ≥ 1 target collection required; tags optional (max 15; each 1..40 chars)"
 */
export const PUBLICATION_POLICY = {
  /** Minimum title length in characters */
  TITLE_MIN_LENGTH: 1,

  /** Maximum title length in characters */
  TITLE_MAX_LENGTH: 200,

  /** Minimum number of target collections required */
  MIN_COLLECTIONS: 1,

  /** Maximum number of target collections allowed */
  MAX_COLLECTIONS: 10,

  /** Maximum number of tags allowed per note */
  MAX_TAGS: 15,

  /** Minimum tag length in characters */
  TAG_MIN_LENGTH: 1,

  /** Maximum tag length in characters */
  TAG_MAX_LENGTH: 40,

  /** Maximum note content length in characters for publication */
  MAX_CONTENT_LENGTH: 1_000_000, // 1MB reasonable limit
} as const;

/**
 * Validation error types for publication failures
 */
export const PublicationErrorType = Schema.Literal(
  "title_missing",
  "title_too_short",
  "title_too_long",
  "no_collections",
  "too_many_collections",
  "collection_not_found",
  "too_many_tags",
  "tag_too_short",
  "tag_too_long",
  "tag_invalid_characters",
  "content_too_long",
  "metadata_invalid",
);
export type PublicationErrorType = Schema.Schema.Type<
  typeof PublicationErrorType
>;

/**
 * Individual validation error detail
 */
export const PublicationValidationError = Schema.Struct({
  type: PublicationErrorType,
  field: Schema.String,
  message: Schema.String,
  value: Schema.optional(Schema.Unknown),
});
export type PublicationValidationError = Schema.Schema.Type<
  typeof PublicationValidationError
>;

/**
 * Complete validation result for publication attempt
 */
export const PublicationValidationResult = Schema.Struct({
  valid: Schema.Boolean,
  errors: Schema.Array(PublicationValidationError),
});
export type PublicationValidationResult = Schema.Schema.Type<
  typeof PublicationValidationResult
>;

/**
 * Publication request validation schema
 */
export const PublicationValidationRequest = Schema.Struct({
  title: Schema.String,
  content_md: Schema.String,
  metadata: Schema.Struct({
    tags: Schema.optional(Schema.Array(Schema.String)),
  }),
  target_collections: Schema.Array(Schema.String), // Collection IDs
});
export type PublicationValidationRequest = Schema.Schema.Type<
  typeof PublicationValidationRequest
>;

/**
 * Validates title meets publication requirements
 *
 * @param title - Note title to validate
 * @returns Array of validation errors (empty if valid)
 */
export function validateTitle(title: string): PublicationValidationError[] {
  const errors: PublicationValidationError[] = [];

  if (!title || title.trim().length === 0) {
    errors.push({
      type: "title_missing",
      field: "title",
      message: "Title is required for publication",
      value: title,
    });
    return errors;
  }

  const trimmedTitle = title.trim();

  if (trimmedTitle.length < PUBLICATION_POLICY.TITLE_MIN_LENGTH) {
    errors.push({
      type: "title_too_short",
      field: "title",
      message: `Title must be at least ${PUBLICATION_POLICY.TITLE_MIN_LENGTH} character(s)`,
      value: trimmedTitle,
    });
  }

  if (trimmedTitle.length > PUBLICATION_POLICY.TITLE_MAX_LENGTH) {
    errors.push({
      type: "title_too_long",
      field: "title",
      message: `Title must be no more than ${PUBLICATION_POLICY.TITLE_MAX_LENGTH} characters`,
      value: trimmedTitle,
    });
  }

  return errors;
}

/**
 * Validates target collections meet publication requirements
 *
 * @param collections - Array of collection IDs
 * @returns Array of validation errors (empty if valid)
 */
export function validateCollections(
  collections: readonly string[],
): PublicationValidationError[] {
  const errors: PublicationValidationError[] = [];

  if (!collections || collections.length === 0) {
    errors.push({
      type: "no_collections",
      field: "collections",
      message: "At least one target collection is required",
      value: collections,
    });
    return errors;
  }

  if (collections.length > PUBLICATION_POLICY.MAX_COLLECTIONS) {
    errors.push({
      type: "too_many_collections",
      field: "collections",
      message: `No more than ${PUBLICATION_POLICY.MAX_COLLECTIONS} collections allowed`,
      value: collections,
    });
  }

  return errors;
}

/**
 * Validates note tags meet publication requirements
 *
 * @param tags - Optional array of tag strings
 * @returns Array of validation errors (empty if valid)
 */
export function validateTags(
  tags?: readonly string[],
): PublicationValidationError[] {
  const errors: PublicationValidationError[] = [];

  if (!tags) {
    return errors; // Tags are optional
  }

  if (tags.length > PUBLICATION_POLICY.MAX_TAGS) {
    errors.push({
      type: "too_many_tags",
      field: "metadata.tags",
      message: `No more than ${PUBLICATION_POLICY.MAX_TAGS} tags allowed`,
      value: tags.length,
    });
  }

  for (const [index, tag] of tags.entries()) {
    const trimmedTag = tag.trim();

    if (trimmedTag.length < PUBLICATION_POLICY.TAG_MIN_LENGTH) {
      errors.push({
        type: "tag_too_short",
        field: `metadata.tags[${index}]`,
        message: `Tag must be at least ${PUBLICATION_POLICY.TAG_MIN_LENGTH} character(s)`,
        value: tag,
      });
    }

    if (trimmedTag.length > PUBLICATION_POLICY.TAG_MAX_LENGTH) {
      errors.push({
        type: "tag_too_long",
        field: `metadata.tags[${index}]`,
        message: `Tag must be no more than ${PUBLICATION_POLICY.TAG_MAX_LENGTH} characters`,
        value: tag,
      });
    }

    // Check for invalid characters (basic validation)
    if (!/^[a-zA-Z0-9\s\-_.]+$/.test(trimmedTag)) {
      errors.push({
        type: "tag_invalid_characters",
        field: `metadata.tags[${index}]`,
        message:
          "Tag contains invalid characters. Only letters, numbers, spaces, hyphens, underscores, and periods allowed",
        value: tag,
      });
    }
  }

  return errors;
}

/**
 * Validates content length for publication
 *
 * @param content - Markdown content to validate
 * @returns Array of validation errors (empty if valid)
 */
export function validateContent(content: string): PublicationValidationError[] {
  const errors: PublicationValidationError[] = [];

  if (content.length > PUBLICATION_POLICY.MAX_CONTENT_LENGTH) {
    errors.push({
      type: "content_too_long",
      field: "content_md",
      message: `Content must be no more than ${PUBLICATION_POLICY.MAX_CONTENT_LENGTH} characters`,
      value: content.length,
    });
  }

  return errors;
}

/**
 * Comprehensive publication validation
 *
 * @param request - Publication validation request
 * @returns Complete validation result with all errors
 */
export function validatePublication(
  request: PublicationValidationRequest,
): PublicationValidationResult {
  const allErrors: PublicationValidationError[] = [];

  // Validate all aspects of the publication request
  allErrors.push(...validateTitle(request.title));
  allErrors.push(...validateCollections(request.target_collections));
  allErrors.push(...validateTags(request.metadata.tags));
  allErrors.push(...validateContent(request.content_md));

  return {
    valid: allErrors.length === 0,
    errors: allErrors,
  };
}

/**
 * Quick validation check for publication readiness
 *
 * @param title - Note title
 * @param collections - Target collection IDs
 * @param metadata - Note metadata
 * @returns True if basic requirements are met
 */
export function isPublicationReady(
  title: string,
  collections: string[],
  metadata?: NoteMetadata,
): boolean {
  return (
    title.trim().length >= PUBLICATION_POLICY.TITLE_MIN_LENGTH &&
    title.trim().length <= PUBLICATION_POLICY.TITLE_MAX_LENGTH &&
    collections.length >= PUBLICATION_POLICY.MIN_COLLECTIONS &&
    collections.length <= PUBLICATION_POLICY.MAX_COLLECTIONS &&
    (!metadata?.tags || metadata.tags.length <= PUBLICATION_POLICY.MAX_TAGS)
  );
}
