import * as Context from "../Context.js"
import type * as Effect from "../Effect.js"
import type { LazyArg } from "../Function.js"
import { dual, pipe } from "../Function.js"
import { pipeArguments } from "../Pipeable.js"
import type * as Scope from "../Scope.js"
import type * as ScopedRef from "../ScopedRef.js"
import * as core from "./core.js"
import * as circular from "./effect/circular.js"
import * as fiberRuntime from "./fiberRuntime.js"
import * as ref from "./ref.js"
import * as synchronized from "./synchronizedRef.js"

/** @internal */
const ScopedRefSymbolKey = "effect/ScopedRef"

/** @internal */
export const ScopedRefTypeId: ScopedRef.ScopedRefTypeId = Symbol.for(
  ScopedRefSymbolKey
) as ScopedRef.ScopedRefTypeId

/** @internal */
const scopedRefVariance = {
  /* c8 ignore next */
  _A: (_: any) => _
}

/** @internal  */
const close = <A>(self: ScopedRef.ScopedRef<A>): Effect.Effect<never, never, void> =>
  core.flatMap(ref.get(self.ref), (tuple) => tuple[0].close(core.exitUnit))

/** @internal */
export const fromAcquire = <R, E, A>(
  acquire: Effect.Effect<R, E, A>
): Effect.Effect<R | Scope.Scope, E, ScopedRef.ScopedRef<A>> =>
  core.uninterruptible(
    fiberRuntime.scopeMake().pipe(core.flatMap((newScope) =>
      acquire.pipe(
        core.mapInputContext<R, Scope.Scope | R>(Context.add(fiberRuntime.scopeTag, newScope)),
        core.onError((cause) => newScope.close(core.exitFail(cause))),
        core.flatMap((value) =>
          circular.makeSynchronized([newScope, value] as const).pipe(
            core.flatMap((ref) => {
              const scopedRef: ScopedRef.ScopedRef<A> = {
                [ScopedRefTypeId]: scopedRefVariance,
                pipe() {
                  return pipeArguments(this, arguments)
                },
                ref
              }
              return pipe(
                fiberRuntime.addFinalizer<R | Scope.Scope, void>(() => close(scopedRef)),
                core.as(scopedRef)
              )
            })
          )
        )
      )
    ))
  )

/** @internal */
export const get = <A>(self: ScopedRef.ScopedRef<A>): Effect.Effect<never, never, A> =>
  core.map(ref.get(self.ref), (tuple) => tuple[1])

/** @internal */
export const make = <A>(evaluate: LazyArg<A>): Effect.Effect<Scope.Scope, never, ScopedRef.ScopedRef<A>> =>
  fromAcquire(core.sync(evaluate))

/** @internal */
export const set = dual<
  <A, R, E>(
    acquire: Effect.Effect<R, E, A>
  ) => (self: ScopedRef.ScopedRef<A>) => Effect.Effect<Exclude<R, Scope.Scope>, E, void>,
  <A, R, E>(
    self: ScopedRef.ScopedRef<A>,
    acquire: Effect.Effect<R, E, A>
  ) => Effect.Effect<Exclude<R, Scope.Scope>, E, void>
>(2, <A, R, E>(
  self: ScopedRef.ScopedRef<A>,
  acquire: Effect.Effect<R, E, A>
) =>
  core.flatten(
    synchronized.modifyEffect(self.ref, ([oldScope, value]) =>
      core.uninterruptible(
        core.scopeClose(oldScope, core.exitUnit).pipe(
          core.zipRight(fiberRuntime.scopeMake()),
          core.flatMap((newScope) =>
            core.exit(fiberRuntime.scopeExtend(acquire, newScope)).pipe(
              core.flatMap((exit) =>
                core.exitMatch(exit, {
                  onFailure: (cause) =>
                    core.scopeClose(newScope, core.exitUnit).pipe(
                      core.as(
                        [
                          core.failCause(cause) as Effect.Effect<never, E, void>,
                          [oldScope, value] as const
                        ] as const
                      )
                    ),
                  onSuccess: (value) =>
                    core.succeed(
                      [
                        core.unit as Effect.Effect<never, E, void>,
                        [newScope, value] as const
                      ] as const
                    )
                })
              )
            )
          )
        )
      ))
  ))
