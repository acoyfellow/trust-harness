import * as Domain from "@alchemy.run/domain";
import { TrustHarness } from "./Harness.model.ts";

export class TrustHarnessApi extends Domain.Api(
  "TrustHarnessApi",
  {
    model: TrustHarness,
    commands: [
      "SubmitTurn",
      "ApplyPreflight",
      "ApplyToolAdmit",
      "ApplyObservation",
      "ApplyVerdict",
      "ApplyDisproof",
      "BlockTurn",
      "StartBreakerRound",
      "RecordAttack",
      "FinishBreakerRound",
    ],
    views: ["TurnReceipt", "BreakerReport"],
  },
  { description: "Command and receipt read API for the four-boundary WASM trust harness and Breaker rounds." },
) {}
