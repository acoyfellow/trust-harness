import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { BoundaryName, TurnId } from "../ids.ts";
import { TurnClosed } from "./Turn.rejections.ts";

export class FailClosedBlocked extends Domain.Event("FailClosedBlocked", {
  boundary: BoundaryName,
  reason: Schema.String,
  at: Schema.String,
}) {}

export class BlockTurn extends Domain.Command(
  "BlockTurn",
  {
    target: TurnId,
    input: {
      boundary: BoundaryName,
      reason: Schema.String,
    },
    events: [FailClosedBlocked],
    rejects: [TurnClosed],
  },
  { description: "Block a turn fail-closed when a pinned WASM boundary is missing, tampered, or unavailable." },
) {}
