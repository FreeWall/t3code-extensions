import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import type { ServerClient } from "../connection.ts";
import { applyServerConfigItem, getUsage, setLimitsRefresher } from "./limits.ts";
import { usageSettings } from "./settings.ts";

/** Lets the config snapshot name the instances that report limits before the first refresh. */
const LIMITS_FIRST_REFRESH_DELAY = "5 seconds";
/** How often the loop checks whether the interval set in the usage settings is up. */
const LIMITS_TICK = "30 seconds";

/**
 * The server probes usage limits only when asked (the Usage page does it on open), so
 * without this the header would show whatever the last probe saw. Only shown instances
 * that report limits are refreshed, and only while the window is visible. The default
 * 6 minutes is a bit over the server's 5 minute Claude probe cache, so each refresh
 * reads a fresh `get_usage` instead of the cached one.
 */
function refreshLimits(client: ServerClient) {
  let last = 0;
  const tick = Effect.suspend(() => {
    const { refreshMinutes, hiddenProviders } = usageSettings.get();
    const due = refreshMinutes > 0 && Date.now() - last >= refreshMinutes * 60_000;
    if (!due || document.visibilityState !== "visible") return Effect.void;
    last = Date.now();
    return Effect.forEach(
      getUsage().filter((provider) => !hiddenProviders.includes(provider.instanceId)),
      (provider) => client["server.refreshProviders"]({ instanceId: provider.instanceId }),
      { concurrency: "unbounded", discard: true },
    );
  }).pipe(
    Effect.catchCause((cause) => Effect.sync(() => console.warn("[t3ext] limits refresh failed", cause))),
  );
  return Effect.sleep(LIMITS_FIRST_REFRESH_DELAY).pipe(
    Effect.andThen(Effect.forever(tick.pipe(Effect.andThen(Effect.sleep(LIMITS_TICK))))),
  );
}

export function usageSession(client: ServerClient): Effect.Effect<void> {
  // A click is an explicit request, so it bypasses the probe cache like the app's
  // own "refresh models"; the background loop doesn't, to keep it cheap.
  const refresher = Effect.sync(() =>
    setLimitsRefresher((instanceId) =>
      Effect.runPromise(
        Effect.asVoid(client["server.refreshProviders"]({ instanceId, refreshModels: true })),
      ),
    ),
  );
  const config = client["subscribeServerConfig"]({}).pipe(
    Stream.runForEach((item) => Effect.sync(() => applyServerConfigItem(item))),
    Effect.catchCause((cause) =>
      Effect.sync(() => console.warn("[t3ext] server config stream ended", cause)),
    ),
  );
  return refresher.pipe(
    Effect.andThen(Effect.all([config, refreshLimits(client)], { concurrency: "unbounded", discard: true })),
    Effect.ensuring(Effect.sync(() => setLimitsRefresher(null))),
  );
}
