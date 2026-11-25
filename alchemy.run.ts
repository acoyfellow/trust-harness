import * as Cloudflare from "@alchemy.run/cloudflare";
import * as DomainCloudflare from "@alchemy.run/domain/Cloudflare";
import * as Alchemy from "alchemy";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import TrustHarnessWorker from "./server/TrustHarnessWorker.ts";

export default Alchemy.Stack(
  "TrustHarness",
  {
    providers: Layer.mergeAll(Cloudflare.providers(), DomainCloudflare.providers()),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const worker = yield* TrustHarnessWorker;
    return {
      workerUrl: worker.url.as<string>(),
    };
  }),
);
