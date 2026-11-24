import * as Domain from "@alchemy.run/domain";
import { TrustHarness } from "./Harness.model.ts";

export class TrustHarnessApi extends Domain.Api(
  "TrustHarnessApi",
  {
    model: TrustHarness,
    commands: ["SubmitTurn", "ApplyPreflight", "ApplyToolAdmit", "ApplyObservation", "ApplyVerdict", "BlockTurn"],
    views: ["TurnReceipt"],
  },
  { description: "Command and receipt read API for the four-boundary WASM trust harness." },
) {}
