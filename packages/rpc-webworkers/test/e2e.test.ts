import "@vitest/web-worker"
import { pipe } from "@effect/data/Function"
import * as Effect from "@effect/io/Effect"
import * as Client from "@effect/rpc-webworkers/Client"
import * as Resolver from "@effect/rpc-webworkers/Resolver"
import { describe, expect, it } from "vitest"
import { schema } from "./e2e/schema"
import * as Chunk from "@effect/data/Chunk"

// TODO: test more than one worker
const ResolverLive = Resolver.makeLayer(
  () => new Worker(new URL("./e2e/worker.ts", import.meta.url)),
  { size: Effect.succeed(1), workerPermits: 10 },
)

const client = Client.make(schema)

describe("e2e", () => {
  it("works", () =>
    pipe(
      client.getBinary(new Uint8Array([1, 2, 3])),
      Effect.tap((_) =>
        Effect.sync(() => expect(_).toEqual(new Uint8Array([1, 2, 3]))),
      ),
      Effect.provideLayer(ResolverLive),
      Effect.runPromise,
    ))

  it("100x", () =>
    pipe(
      Effect.allPar(
        Chunk.map(Chunk.range(1, 100), () =>
          client.getBinary(new Uint8Array([1, 2, 3])),
        ),
      ),
      Effect.tap((_) => Effect.sync(() => expect(_.length).toEqual(100))),
      Effect.provideLayer(ResolverLive),
      Effect.runPromise,
    ))
})
