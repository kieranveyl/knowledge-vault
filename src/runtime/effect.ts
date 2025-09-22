import { Effect } from "effect";

/**
 * Helper to run Effect programs within the Bun runtime.
 * In production this will be replaced by a layered runtime with services.
 */
export const runEffect = <A>(program: Effect.Effect<A>): Promise<A> =>
  Effect.runPromise(program);

