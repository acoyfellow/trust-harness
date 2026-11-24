import * as Domain from "@alchemy.run/domain";
import * as Effect from "effect/Effect";
import { TurnId } from "../ids.ts";
import { RunTurn } from "./RunTurn.saga.ts";
import { TurnSubmitted } from "./SubmitTurn.command.ts";
import { Turn } from "./Turn.aggregate.ts";

export class TurnLaunch extends Domain.Policy(
  "TurnLaunch",
  { from: Turn, on: [TurnSubmitted] },
  { description: "Whenever a turn is submitted, launch RunTurn across all four WASM boundaries." },
) {}

export const TurnLaunchLive = TurnLaunch.toLayer(
  Effect.gen(function* () {
    const runs = yield* RunTurn;
    return Effect.fn(function* ({ source, event }) {
      yield* runs.start(TurnId.make(source.id), {
        preflight: event.preflight,
        toolCalls: event.toolCalls,
        verdict: event.verdict,
      });
    });
  }),
);
