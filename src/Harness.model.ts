import * as Domain from "@alchemy.run/domain";
import * as Layer from "effect/Layer";
import { RunTurn, RunTurnLive } from "./Turn/RunTurn.saga.ts";
import { Turn } from "./Turn/Turn.aggregate.ts";
import { TurnLaunch, TurnLaunchLive } from "./Turn/TurnLaunch.policy.ts";
import { TurnReceipt } from "./TurnReceipt.view.ts";

export class TrustHarness extends Domain.Model("TrustHarness", {
  aggregates: [Turn],
  views: [TurnReceipt],
  policies: [TurnLaunch],
  sagas: [RunTurn],
}) {}

export const HarnessHandlers = Layer.mergeAll(TurnLaunchLive, RunTurnLive);
