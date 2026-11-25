import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { TurnId } from "./ids.ts";
import { DisproofProposal, VerdictInput } from "./schemas.ts";

export class CriticUnavailable extends Domain.Rejection("CriticUnavailable", {
  reason: Schema.String,
}) {}

export class DisproofCritic extends Domain.ExternalSystem(
  "DisproofCritic",
  {
    challenge: {
      args: { turnId: TurnId, verdict: VerdictInput },
      success: DisproofProposal,
      error: CriticUnavailable,
    },
  },
  { description: "Adversarial critic tasked with proposing a falsifying counterexample before a turn may pass." },
) {}
