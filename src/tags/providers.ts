/**
 * The provider instances and models the app offers, from `subscribeServerConfig`
 * (`ServerProvider` in the contracts). Read only while the settings page shows them.
 */

import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { useEffect, useState } from "preact/compat";

import { onSession } from "../connection.ts";
import { record, string } from "../json.ts";

export interface ProviderModels {
  readonly instanceId: string;
  readonly name: string;
  readonly models: ReadonlyArray<{ readonly slug: string; readonly name: string }>;
}

function toProvider(value: unknown): ProviderModels | undefined {
  const raw = record(value);
  const instanceId = string(raw?.instanceId);
  if (raw === undefined || instanceId === undefined) return undefined;
  if (raw.enabled !== true || raw.installed !== true || raw.availability === "unavailable") return undefined;
  const models = (Array.isArray(raw.models) ? raw.models : []).flatMap((model) => {
    const slug = string(record(model)?.slug);
    return slug ? [{ slug, name: string(record(model)?.name) ?? slug }] : [];
  });
  return models.length ? { instanceId, name: string(raw.displayName) ?? instanceId, models } : undefined;
}

function providersOf(item: unknown): ProviderModels[] | undefined {
  const raw = record(item);
  const list =
    raw?.type === "snapshot"
      ? record(raw.config)?.providers
      : raw?.type === "providerStatuses"
        ? record(raw.payload)?.providers
        : undefined;
  return Array.isArray(list) ? list.flatMap((value) => toProvider(value) ?? []) : undefined;
}

/** Providers with models; empty until the server answers. */
export function useProviders(): ReadonlyArray<ProviderModels> {
  const [providers, setProviders] = useState<ReadonlyArray<ProviderModels>>([]);
  useEffect(
    () =>
      onSession((client) =>
        client["subscribeServerConfig"]({}).pipe(
          Stream.runForEach((item) =>
            Effect.sync(() => {
              const next = providersOf(item);
              if (next) setProviders(next);
            }),
          ),
          Effect.catchCause(() => Effect.void),
        ),
      ),
    [],
  );
  return providers;
}
