import * as Cloudflare from "@alchemy.run/cloudflare";
import * as DomainCloudflare from "@alchemy.run/domain/Cloudflare";
import * as Effect from "effect/Effect";
import { HttpServerRequest } from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as Layer from "effect/Layer";
import { TrustHarnessApi } from "../src/Harness.api.ts";
import { HarnessHandlers, TrustHarness } from "../src/Harness.model.ts";
import {
  FailClosedWorkerCritic,
  FailClosedWorkerExecutor,
  FailClosedWorkerJudge,
} from "./WorkerAdapters.ts";

const HarnessLive = TrustHarness.layer(HarnessHandlers).pipe(
  Layer.provide(
    Layer.mergeAll(
      DomainCloudflare.layerDurableObjects(),
      FailClosedWorkerJudge,
      FailClosedWorkerExecutor,
      FailClosedWorkerCritic,
    ),
  ),
);

export default class TrustHarnessWorker extends Cloudflare.Worker<TrustHarnessWorker>()(
  "TrustHarnessWorker",
  { main: import.meta.url },
  Effect.gen(function* () {
    const api = yield* TrustHarnessApi;
    return {
      fetch: Effect.gen(function* () {
        const request = yield* HttpServerRequest;
        const pathname = new URL(request.url, "http://localhost").pathname;
        if (pathname === "/health") {
          return HttpServerResponse.text("ok", { status: 200 });
        }
        if (pathname.startsWith("/api")) {
          return yield* api.fetch;
        }
        return HttpServerResponse.text("Not Found", { status: 404 });
      }),
    };
  }).pipe(Effect.provide(HarnessLive)),
) {}
