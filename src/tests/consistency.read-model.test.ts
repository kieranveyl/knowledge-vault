import { beforeEach, describe, expect, it } from "bun:test";
import { Effect } from "effect";
import { ulid } from "ulid";
import { createTestApi } from "./helpers/test-deps";

describe("Consistency read model", () => {
	let ctx = createTestApi();

	beforeEach(async () => {
		ctx = createTestApi();
		await Effect.runPromise(ctx.storage.initializeWorkspace());
	});

	it("provides read-your-writes semantics for drafts", async () => {
		const note = await Effect.runPromise(
			ctx.storage.createNote("Draft visibility", "Initial", { tags: [] }),
		);
		const sessionHeaders = {
			"Content-Type": "application/json",
			"X-Session-ID": "ses_read_your_writes",
		};
		const updatedBody = "## Updated body";

		const saveResponse = await ctx.app.handle(
			new Request("http://localhost/drafts", {
				method: "POST",
				headers: sessionHeaders,
				body: JSON.stringify({
					note_id: note.id,
					body_md: updatedBody,
					metadata: { tags: [] },
				}),
			}),
		);
		expect(saveResponse.status).toBe(200);

		const draftResponse = await ctx.app.handle(
			new Request(`http://localhost/drafts/${note.id}`, {
				headers: sessionHeaders,
			}),
		);
		expect(draftResponse.status).toBe(200);
		const draftPayload = await draftResponse.json();
		expect(draftPayload.body_md).toBe(updatedBody);
	});

	it("maintains monotonic version reads after publish", async () => {
		const note = await Effect.runPromise(
			ctx.storage.createNote("Monotonic", "Initial", { tags: [] }),
		);
		const collection = await Effect.runPromise(
			ctx.storage.createCollection("Monotonic Scope"),
		);
		const makeHeaders = () => ({
			"Content-Type": "application/json",
			"X-Session-ID": `ses_monotonic_${ulid()}`,
		});

		await Effect.runPromise(
			ctx.storage.saveDraft({
				note_id: note.id,
				body_md: "Version one",
				metadata: { tags: [] },
			}),
		);

		const publishV1Response = await ctx.app.handle(
			new Request("http://localhost/publish", {
				method: "POST",
				headers: makeHeaders(),
				body: JSON.stringify({
					note_id: note.id,
					collections: [collection.id],
					client_token: `token-${ulid()}`,
				}),
			}),
		);
		expect(publishV1Response.status).toBe(200);
		const publishV1 = await publishV1Response.json();

		const versionsAfterV1 = await ctx.app.handle(
			new Request(`http://localhost/notes/${note.id}/versions`),
		);
		expect(versionsAfterV1.status).toBe(200);
		const versionsPayloadV1 = await versionsAfterV1.json();
		expect(versionsPayloadV1.versions[0].id).toBe(publishV1.version_id);

		await Effect.runPromise(
			ctx.storage.saveDraft({
				note_id: note.id,
				body_md: "Version two",
				metadata: { tags: [] },
			}),
		);

		const publishV2Response = await ctx.app.handle(
			new Request("http://localhost/publish", {
				method: "POST",
				headers: makeHeaders(),
				body: JSON.stringify({
					note_id: note.id,
					collections: [collection.id],
					client_token: `token-${ulid()}`,
				}),
			}),
		);
		expect(publishV2Response.status).toBe(200);
		const publishV2 = await publishV2Response.json();

		const versionsAfterV2 = await ctx.app.handle(
			new Request(`http://localhost/notes/${note.id}/versions`),
		);
		expect(versionsAfterV2.status).toBe(200);
		const versionsPayloadV2 = await versionsAfterV2.json();
		expect(versionsPayloadV2.versions[0].id).toBe(publishV2.version_id);
		expect(
			versionsPayloadV2.versions.map((version: any) => version.id),
		).toContain(publishV1.version_id);

		const refreshedNote = await Effect.runPromise(ctx.storage.getNote(note.id));
		expect(refreshedNote.current_version_id).toBe(publishV2.version_id);
	});

	it("delays search exposure until indexing commits", async () => {
		const note = await Effect.runPromise(
			ctx.storage.createNote("Index staging", "Initial", { tags: [] }),
		);
		const collection = await Effect.runPromise(
			ctx.storage.createCollection("Staging"),
		);
		const sessionHeaders = {
			"Content-Type": "application/json",
			"X-Session-ID": "ses_staging",
		};

		await Effect.runPromise(
			ctx.storage.saveDraft({
				note_id: note.id,
				body_md: "Visible after commit",
				metadata: { tags: [] },
			}),
		);

		let committed = false;
		let publishedVersion: string | undefined;

		ctx.indexing.setSearchHandler(() => {
			if (!committed || !publishedVersion) {
				return {
					answer: undefined,
					results: [],
					citations: [],
					query_id: `qry_${ulid()}`,
					page: 0,
					page_size: 10,
					total_count: 0,
					has_more: false,
					no_answer_reason: "not_indexed",
				};
			}

			return {
				answer: undefined,
				results: [
					{
						note_id: note.id,
						version_id: publishedVersion,
						title: "Index staging",
						snippet: "Visible after commit",
						score: 0.9,
						collection_ids: [collection.id],
					},
				],
				citations: [],
				query_id: `qry_${ulid()}`,
				page: 0,
				page_size: 10,
				total_count: 1,
				has_more: false,
			};
		});

		const publishResponse = await ctx.app.handle(
			new Request("http://localhost/publish", {
				method: "POST",
				headers: sessionHeaders,
				body: JSON.stringify({
					note_id: note.id,
					collections: [collection.id],
					client_token: `token-${ulid()}`,
				}),
			}),
		);
		expect(publishResponse.status).toBe(200);
		const publishPayload = await publishResponse.json();
		publishedVersion = publishPayload.version_id;
		expect(
			ctx.indexing.events.some(
				(event) => event.version_id === publishPayload.version_id && event.op === "publish",
			),
		).toBe(true);

		const preCommitSearch = await ctx.app.handle(
			new Request("http://localhost/search?q=index"),
		);
		expect(preCommitSearch.status).toBe(200);
		const preCommitPayload = await preCommitSearch.json();
		expect(preCommitPayload.results).toHaveLength(0);
		expect(preCommitPayload.no_answer_reason).toBe("not_indexed");

		committed = true;

		const postCommitSearch = await ctx.app.handle(
			new Request("http://localhost/search?q=index"),
		);
		expect(postCommitSearch.status).toBe(200);
		const postCommitPayload = await postCommitSearch.json();
		expect(postCommitPayload.results).toHaveLength(1);
		expect(postCommitPayload.results[0].version_id).toBe(publishedVersion);
	});

	it("keeps drafts isolated from search", async () => {
		const note = await Effect.runPromise(
			ctx.storage.createNote("Draft isolation", "Initial", { tags: [] }),
		);

		await Effect.runPromise(
			ctx.storage.saveDraft({
				note_id: note.id,
				body_md: "Draft content only",
				metadata: { tags: [] },
			}),
		);

		ctx.indexing.setSearchHandler(() => ({
			answer: undefined,
			results: [],
			citations: [],
			query_id: `qry_${ulid()}`,
			page: 0,
			page_size: 10,
			total_count: 0,
			has_more: false,
			no_answer_reason: "no_published_versions",
		}));

		const response = await ctx.app.handle(
			new Request("http://localhost/search?q=draft"),
		);
		expect(response.status).toBe(200);
		const payload = await response.json();
		expect(payload.results).toHaveLength(0);
		expect(ctx.indexing.events).toHaveLength(0);
	});

	it("enforces collection scope during search", async () => {
		const note = await Effect.runPromise(
			ctx.storage.createNote("Collection scoped", "Initial", { tags: [] }),
		);
		const collectionA = await Effect.runPromise(
			ctx.storage.createCollection("Scope A"),
		);
		const collectionB = await Effect.runPromise(
			ctx.storage.createCollection("Scope B"),
		);
		const sessionHeaders = {
			"Content-Type": "application/json",
			"X-Session-ID": "ses_collection_scope",
		};

		await Effect.runPromise(
			ctx.storage.saveDraft({
				note_id: note.id,
				body_md: "Scoped content",
				metadata: { tags: [] },
			}),
		);

		const publishResponse = await ctx.app.handle(
			new Request("http://localhost/publish", {
				method: "POST",
				headers: sessionHeaders,
				body: JSON.stringify({
					note_id: note.id,
					collections: [collectionA.id, collectionB.id],
					client_token: `token-${ulid()}`,
				}),
			}),
		);
		expect(publishResponse.status).toBe(200);
		const publishPayload = await publishResponse.json();

		const membership = await Effect.runPromise(
			ctx.storage.getNoteCollections(note.id),
		);
		expect(new Set(membership.map((collection) => collection.id))).toEqual(
			new Set([collectionA.id, collectionB.id]),
		);

		let capturedCollections: readonly string[] | undefined;
		ctx.indexing.setSearchHandler((request) => {
			capturedCollections = request.collections;
			const baseCollections = [collectionA.id, collectionB.id] as const;
			const scopedCollections =
				request.collections && request.collections.length > 0
					? baseCollections.filter((collectionId) =>
						request.collections!.includes(collectionId),
					)
					: baseCollections;

			return {
				answer: undefined,
				results: [
					{
						note_id: note.id,
						version_id: publishPayload.version_id,
						title: "Collection scoped",
						snippet: "Scoped content",
						score: 0.85,
						collection_ids: scopedCollections,
					},
				],
				citations: [],
				query_id: `qry_${ulid()}`,
				page: 0,
				page_size: 10,
				total_count: scopedCollections.length,
				has_more: false,
			};
		});

		const scopedResponse = await ctx.app.handle(
			new Request(
				`http://localhost/search?q=scope&collections=${collectionA.id}`,
			),
		);
		expect(scopedResponse.status).toBe(200);
		const scopedPayload = await scopedResponse.json();
		expect(capturedCollections).toEqual([collectionA.id]);
		expect(scopedPayload.results).toHaveLength(1);
		expect(scopedPayload.results[0].collection_ids).toEqual([
			collectionA.id,
		]);
	});
});
