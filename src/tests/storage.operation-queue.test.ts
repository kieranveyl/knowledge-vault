import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Duration, Effect, Fiber, Ref } from "effect";
import { ulid } from "ulid";
import {
	DEFAULT_QUEUE_CONFIG,
	OperationScheduler,
	type QueueOperation,
} from "../queue/scheduler";
import type {
	CollectionId,
	NoteId,
	VersionId,
} from "../schema/entities";
import type { VisibilityEvent } from "../schema/events";

const createNoteId = (): NoteId => `note_${ulid()}` as NoteId;
const createVersionId = (): VersionId => `ver_${ulid()}` as VersionId;
const createCollectionId = (): CollectionId => `col_${ulid()}` as CollectionId;

const makeVisibilityOperation = (
	noteId: NoteId,
	versionId: VersionId,
): QueueOperation => ({
	type: "visibility",
	event: {
		event_id: `evt_${ulid()}`,
		timestamp: new Date(),
		schema_version: "1.0.0",
		type: "VisibilityEvent",
		version_id: versionId,
		op: "publish",
		collections: [createCollectionId()],
		note_id: noteId,
	} satisfies VisibilityEvent,
});

const waitFor = async (
	predicate: () => boolean,
	timeoutMs = 2_000,
	pollMs = 25,
) => {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (predicate()) {
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, pollMs));
	}
	throw new Error("waitFor timed out");
};

describe("OperationScheduler", () => {
	let scheduler: OperationScheduler | null;
	let schedulerFiber: Fiber.Runtime<never, never> | null;
	let processedOperations: VersionId[];

	const startScheduler = async () => {
		if (!scheduler) {
			throw new Error("scheduler not initialized");
		}
		schedulerFiber = Effect.runFork(scheduler.start());
	};

	const stopScheduler = async () => {
		if (!scheduler) {
			return;
		}
		await Effect.runPromise(scheduler.stop());
		if (schedulerFiber) {
			await Effect.runPromise(Fiber.interrupt(schedulerFiber));
			schedulerFiber = null;
		}
		scheduler = null;
	};

	beforeEach(() => {
		scheduler = null;
		schedulerFiber = null;
		processedOperations = [];
	});

	afterEach(async () => {
		await stopScheduler();
	});

	it("processes operations FIFO per note", async () => {
		const noteId = createNoteId();
		const versions: readonly VersionId[] = [
			createVersionId(),
			createVersionId(),
			createVersionId(),
		];

		scheduler = new OperationScheduler(DEFAULT_QUEUE_CONFIG, (operation) =>
			Effect.sync(() => {
				if (operation.type === "visibility") {
					processedOperations.push(operation.event.version_id);
				}
			}),
		);

		await startScheduler();

		for (const versionId of versions) {
			await Effect.runPromise(
				scheduler.submitOperation(
					makeVisibilityOperation(noteId, versionId),
					noteId,
				),
			);
		}

		await waitFor(() => processedOperations.length === versions.length);
		expect(processedOperations).toEqual(versions);
	});

	it("limits to one in-flight operation per note", async () => {
		const noteId = createNoteId();
		const versions: readonly VersionId[] = [
			createVersionId(),
			createVersionId(),
			createVersionId(),
		];

		const inFlight = Ref.unsafeMake(0);
		const maxObserved = Ref.unsafeMake(0);

		scheduler = new OperationScheduler(DEFAULT_QUEUE_CONFIG, (operation) =>
			Effect.gen(function* () {
				yield* Ref.update(inFlight, (value) => value + 1);
				const current = yield* Ref.get(inFlight);
				yield* Ref.update(maxObserved, (max) => Math.max(max, current));
				yield* Effect.sleep(Duration.millis(75));
				yield* Ref.update(inFlight, (value) => value - 1);
				if (operation.type === "visibility") {
					processedOperations.push(operation.event.version_id);
				}
			}),
		);

		await startScheduler();

		await Promise.all(
			versions.map((versionId) =>
				Effect.runPromise(
					scheduler!.submitOperation(
						makeVisibilityOperation(noteId, versionId),
						noteId,
					),
				),
			),
		);

		await waitFor(() => processedOperations.length === versions.length);

		const maxConcurrent = await Effect.runPromise(Ref.get(maxObserved));
		expect(maxConcurrent).toBeLessThanOrEqual(1);
	});

	it("limits total in-flight operations per workspace", async () => {
		const notes = Array.from({ length: 5 }, () => createNoteId());
		const versions = notes.map(() => createVersionId());

		const inFlight = Ref.unsafeMake(0);
		const maxObserved = Ref.unsafeMake(0);

		scheduler = new OperationScheduler(DEFAULT_QUEUE_CONFIG, (operation) =>
			Effect.gen(function* () {
				yield* Ref.update(inFlight, (value) => value + 1);
				const current = yield* Ref.get(inFlight);
				yield* Ref.update(maxObserved, (max) => Math.max(max, current));
				yield* Effect.sleep(Duration.millis(75));
				if (operation.type === "visibility") {
					processedOperations.push(operation.event.version_id);
				}
				yield* Ref.update(inFlight, (value) => value - 1);
			}),
		);

		await startScheduler();

		await Promise.all(
			notes.map((noteId, index) =>
				Effect.runPromise(
					scheduler!.submitOperation(
						makeVisibilityOperation(noteId, versions[index]),
						noteId,
					),
				),
			),
		);

		await waitFor(() => processedOperations.length === notes.length);

		const maxConcurrent = await Effect.runPromise(Ref.get(maxObserved));
		expect(maxConcurrent).toBeLessThanOrEqual(
			DEFAULT_QUEUE_CONFIG.maxInFlightPerWorkspace,
		);
	});

	it("applies aging to long-waiting operations", async () => {
		const blockingVersion = createVersionId();
		const oldVersion = createVersionId();
		const newVersion = createVersionId();

		const blockingNote = createNoteId();
		const oldNote = createNoteId();
		const newNote = createNoteId();

		const durations = new Map<VersionId, number>([
			[blockingVersion, 200],
			[oldVersion, 25],
			[newVersion, 25],
		]);

		const quickConfig = {
			...DEFAULT_QUEUE_CONFIG,
			maxInFlightPerWorkspace: 1,
			agingIntervalMs: 50,
			agingBoostAmount: 100,
		};

		scheduler = new OperationScheduler(quickConfig, (operation) =>
			Effect.gen(function* () {
				if (operation.type !== "visibility") {
					return;
				}
				const versionId = operation.event.version_id;
				const duration = durations.get(versionId) ?? 0;
				yield* Effect.sleep(Duration.millis(duration));
				processedOperations.push(versionId);
			}),
		);

		await startScheduler();

		await Effect.runPromise(
			scheduler.submitOperation(
				makeVisibilityOperation(blockingNote, blockingVersion),
				blockingNote,
				500,
			),
		);

		await Effect.runPromise(
			scheduler.submitOperation(
				makeVisibilityOperation(oldNote, oldVersion),
				oldNote,
				10,
			),
		);

		await Effect.runPromise(Effect.sleep(Duration.millis(120)));

		await Effect.runPromise(
			scheduler.submitOperation(
				makeVisibilityOperation(newNote, newVersion),
				newNote,
				150,
			),
		);

		await waitFor(() => processedOperations.length === 3, 3_000);

		expect(processedOperations[0]).toBe(blockingVersion);
		expect(processedOperations[1]).toBe(oldVersion);
		expect(processedOperations[2]).toBe(newVersion);
	});
});
