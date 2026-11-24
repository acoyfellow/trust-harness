import * as Domain from "@alchemy.run/domain";
import { expect, it } from "@effect/vitest";
import { TrustHarness } from "../src/Harness.model.ts";

it("TrustHarness model passes Domain.verify with zero issues", () => {
  expect(Domain.verify(TrustHarness)).toEqual([]);
});
