import * as Schema from "effect/Schema";

export const TurnId = Schema.String.pipe(Schema.brand("TurnId"));
export type TurnId = typeof TurnId.Type;

export const CallId = Schema.String.pipe(Schema.brand("CallId"));
export type CallId = typeof CallId.Type;

export const BoundaryName = Schema.Literals(["preflight", "admit", "observe", "verdict"]);
export type BoundaryName = typeof BoundaryName.Type;
