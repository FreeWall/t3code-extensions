import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import { Socket } from "effect/unstable/socket";

import { type LaunchThreadInput, type OrchestrationCommand, ORCHESTRATION_PROTOCOL_VERSION, ServerRpcGroup } from "./protocol.ts";
import { attachSettingsFile, SETTINGS_DIRECTORY, type SettingsFile } from "./settings.ts";
import { type Json, record, string, strings } from "./json.ts";
import {
  applyShellItem,
  clearEnvironment,
  setPrimaryEnvironmentId,
  setStatus,
  type ConnectionStatus,
} from "./store.ts";

const RECONNECT_DELAY = "3 seconds";
/** How often the app's saved environments are re-read, so added or removed ones follow. */
const CATALOG_INTERVAL = "30 seconds";
const SETTINGS_FILE = "settings.json";

interface Endpoint {
  readonly httpBaseUrl: string;
  readonly wsBaseUrl: string;
  /** Bearer token for the ticket request; none means same-origin cookie auth. */
  readonly bearer: () => Promise<string | undefined>;
}

/** A backend the rail subscribes to: the window's own, or one saved under Connections. */
interface Environment {
  readonly key: string;
  readonly primary: boolean;
  /** Known up front for a saved environment; the primary's is fetched. */
  readonly environmentId: string | null;
  /** Tried in order; a saved environment can have several (LAN, Tailscale…). */
  readonly routes: ReadonlyArray<Endpoint>;
}

type SavedEnvironment = Environment & { readonly environmentId: string };

interface DesktopBootstrap {
  readonly id: string;
  readonly httpBaseUrl: string | null;
  readonly wsBaseUrl: string | null;
}

declare global {
  interface Window {
    desktopBridge?: {
      getLocalEnvironmentBootstraps?: () => ReadonlyArray<DesktopBootstrap>;
      getLocalEnvironmentBearerToken?: () => Promise<string>;
      getClientSettings?: () => Promise<unknown>;
      getConnectionCatalog?: () => Promise<string | null>;
    };
  }
}

const withSlash = (url: string): string => (url.endsWith("/") ? url : `${url}/`);

/**
 * The desktop window loads from `t3code://`, so the backend's address comes from the
 * same bridge the app uses. A plain browser tab talks to its own origin.
 */
function primaryEnvironment(): Environment {
  const bridge = window.desktopBridge;
  const bootstrap = bridge?.getLocalEnvironmentBootstraps?.().find((entry) => entry.id === "primary");
  const bearer = async () => bridge?.getLocalEnvironmentBearerToken?.();
  const origin = window.location.origin;
  const route =
    bootstrap?.httpBaseUrl && bootstrap.wsBaseUrl
      ? { httpBaseUrl: withSlash(bootstrap.httpBaseUrl), wsBaseUrl: bootstrap.wsBaseUrl, bearer }
      : { httpBaseUrl: `${origin}/`, wsBaseUrl: origin.replace(/^http/, "ws"), bearer };
  return { key: "primary", primary: true, environmentId: null, routes: [route] };
}

/**
 * Environments saved under Connections that authenticate with a plain bearer token
 * (pairing link / URL), from the desktop's connection catalog
 * (`ConnectionCatalogDocument` in client-runtime). Relay (DPoP) and SSH ones are skipped.
 */
async function savedEnvironments(): Promise<SavedEnvironment[]> {
  const raw = await window.desktopBridge?.getConnectionCatalog?.();
  const catalog = record(raw ? JSON.parse(raw) : undefined);
  if (catalog === undefined) return [];
  const list = (value: unknown): Json[] =>
    Array.isArray(value) ? value.map(record).filter((item) => item !== undefined) : [];
  const disabled = new Set(strings(catalog.disabledEnvironmentIds));
  const profiles = new Map(list(catalog.profiles).map((profile) => [string(profile.connectionId), profile]));
  const tokens = new Map(
    list(catalog.credentials).flatMap((entry) => {
      const credential = record(entry.credential);
      const token = credential?._tag === "BearerConnectionCredential" ? string(credential.token) : undefined;
      return token ? [[string(entry.connectionId), token] as const] : [];
    }),
  );
  const routes = new Map<string, { endpoints: Endpoint[]; key: string }>();
  for (const target of list(catalog.targets)) {
    const environmentId = string(target.environmentId);
    if (target._tag !== "BearerConnectionTarget" || !environmentId || disabled.has(environmentId)) continue;
    const connectionId = string(target.connectionId);
    const profile = profiles.get(connectionId);
    const token = tokens.get(connectionId);
    const httpBaseUrl = string(profile?.httpBaseUrl);
    const wsBaseUrl = string(profile?.wsBaseUrl);
    if (!token || !httpBaseUrl || !wsBaseUrl) continue;
    const route = { httpBaseUrl: withSlash(httpBaseUrl), wsBaseUrl, bearer: async () => token };
    const entry = routes.get(environmentId) ?? { endpoints: [], key: environmentId };
    // The key changes with any route or token, so a re-paired environment reconnects.
    routes.set(environmentId, {
      endpoints: [...entry.endpoints, route],
      key: `${entry.key}|${httpBaseUrl}|${wsBaseUrl}|${token}`,
    });
  }
  return [...routes].map(([environmentId, { endpoints, key }]) => ({
    key,
    primary: false,
    environmentId,
    routes: endpoints,
  }));
}

/**
 * The desktop window authenticates to its backends with a bearer token (their CORS
 * allows no credentials), the same as `httpLayer.ts`. A same-origin browser tab uses
 * its session cookie instead.
 */
async function openSocketUrl(target: Endpoint): Promise<string> {
  const bearer = await target.bearer();
  const response = await fetch(`${target.httpBaseUrl}api/auth/websocket-ticket`, {
    method: "POST",
    ...(bearer
      ? { headers: { authorization: `Bearer ${bearer}` }, credentials: "omit" as const }
      : { credentials: "include" as const }),
  });
  if (!response.ok) throw new Error(`websocket-ticket: HTTP ${response.status}`);
  const { ticket } = (await response.json()) as { ticket?: string };
  if (!ticket) throw new Error("websocket-ticket: response has no ticket");
  const url = new URL(target.wsBaseUrl);
  url.pathname = "/ws";
  url.searchParams.set("orchestrationProtocol", String(ORCHESTRATION_PROTOCOL_VERSION));
  url.searchParams.set("wsTicket", ticket);
  return url.toString();
}

/** The first route that hands out a ticket. */
async function openSocket(routes: ReadonlyArray<Endpoint>): Promise<{ route: Endpoint; socketUrl: string }> {
  let failure: unknown = new Error("no route");
  for (const route of routes) {
    try {
      return { route, socketUrl: await openSocketUrl(route) };
    } catch (error) {
      failure = error;
    }
  }
  throw failure;
}

async function fetchEnvironmentId(target: Endpoint): Promise<string> {
  const response = await fetch(`${target.httpBaseUrl}.well-known/t3/environment`);
  if (!response.ok) throw new Error(`environment descriptor: HTTP ${response.status}`);
  const environmentId = string(record(await response.json())?.environmentId);
  if (!environmentId) throw new Error("environment descriptor has no environmentId");
  return environmentId;
}

export type ServerClient = RpcClient.FromGroup<typeof ServerRpcGroup>;

/** Live sockets by environment id. */
const clients = new Map<string, { readonly client: ServerClient; readonly route: Endpoint }>();

const clientFor = (environmentId: string): ServerClient => {
  const live = clients.get(environmentId)?.client;
  if (live === undefined) throw new Error("offline");
  return live;
};

/** Resolves a signed `assets.createUrl` result to an absolute URL, or null while offline. */
export async function createAssetUrl(environmentId: string, resource: unknown): Promise<string | null> {
  const live = clients.get(environmentId);
  if (live === undefined) return null;
  const result = (await Effect.runPromise(live.client["assets.createUrl"]({ resource }))) as {
    relativeUrl?: string;
  };
  return result.relativeUrl ? new URL(result.relativeUrl, live.route.httpBaseUrl).toString() : null;
}

/** Runs for as long as the primary socket is up; interrupted when it drops. */
export type SessionHandler = (client: ServerClient) => Effect.Effect<void>;
const sessionHandlers = new Set<SessionHandler>();
/** Handlers running on the current primary socket; empty while offline. */
const running = new Map<SessionHandler, Fiber.Fiber<void>>();
let primaryClient: ServerClient | null = null;

const startHandler = (handler: SessionHandler): void => {
  if (primaryClient !== null) running.set(handler, Effect.runFork(handler(primaryClient)));
};

const stopHandler = (handler: SessionHandler): Effect.Effect<void> => {
  const fiber = running.get(handler);
  running.delete(handler);
  return fiber ? Fiber.interrupt(fiber) : Effect.void;
};

/**
 * Lets an extension use the window's own backend: the handler runs on every session,
 * starting right away when one is up. Returns what stops it, for an extension switched off.
 */
export const onSession = (handler: SessionHandler): (() => void) => {
  sessionHandlers.add(handler);
  startHandler(handler);
  return () => {
    sessionHandlers.delete(handler);
    Effect.runFork(stopHandler(handler));
  };
};

/** Sends one orchestration command; rejects while offline or when the server refuses it. */
export function dispatchCommand(environmentId: string, command: OrchestrationCommand): Promise<void> {
  return Effect.runPromise(
    Effect.suspend(() => Effect.asVoid(clientFor(environmentId)["orchestration.dispatchCommand"](command))),
  );
}

/** Starts a thread with its first message; resolves to the server's launch result. */
export function launchThread(environmentId: string, input: LaunchThreadInput): Promise<unknown> {
  return Effect.runPromise(Effect.suspend(() => clientFor(environmentId)["orchestration.launchThread"](input)));
}

/** One thread's full state, messages included. */
export function getThreadProjection(environmentId: string, threadId: string): Promise<unknown> {
  return Effect.runPromise(
    Effect.suspend(() => clientFor(environmentId)["orchestration.getThreadProjection"]({ threadId })),
  );
}

/**
 * The settings file in the server's home directory. A missing file fails `realpath`
 * before anything is opened; any other read failure is surfaced, so nothing ever
 * overwrites a file it couldn't read.
 */
function settingsFile(client: ServerClient) {
  return Effect.gen(function* () {
    const home = (yield* client["filesystem.browse"]({ partialPath: "~/" })) as { parentPath?: string };
    if (!home.parentPath) return yield* Effect.fail("filesystem.browse returned no home directory");
    const cwd = `${home.parentPath.replace(/\/+$/, "")}/${SETTINGS_DIRECTORY}`;
    const path = `${cwd}/${SETTINGS_FILE}`;
    const file: SettingsFile = {
      path,
      read: () =>
        Effect.runPromise(
          client["projects.readFile"]({ cwd, relativePath: path }).pipe(
            Effect.map((result) => (result as { contents: string }).contents),
            Effect.catch((error) =>
              (error as { operation?: string } | null)?.operation === "realpath-target"
                ? Effect.succeed(null)
                : Effect.fail(error),
            ),
          ),
        ),
      write: (contents) =>
        Effect.runPromise(
          Effect.asVoid(client["projects.writeFile"]({ cwd, relativePath: SETTINGS_FILE, contents })),
        ),
    };
    return file;
  });
}

/* Connection status, aggregated over every environment for the store. */

const statuses = new Map<string, ConnectionStatus>();

function setConnectionStatus(key: string, status: ConnectionStatus | null): void {
  if (status === null) statuses.delete(key);
  else statuses.set(key, status);
  const all = [...statuses.values()];
  setStatus(all.includes("live") ? "live" : all.includes("connecting") ? "connecting" : "offline");
}

const session = (environment: Environment) =>
  Effect.gen(function* () {
    const { route, socketUrl } = yield* Effect.promise(() => openSocket(environment.routes));
    const environmentId = environment.environmentId ?? (yield* Effect.promise(() => fetchEnvironmentId(route)));
    const protocol = RpcClient.layerProtocolSocket().pipe(
      Layer.provide(
        Socket.layerWebSocket(socketUrl).pipe(Layer.provide(Socket.layerWebSocketConstructorGlobal)),
      ),
      Layer.provide(RpcSerialization.layerJson),
    );
    yield* Effect.gen(function* () {
      const client = yield* RpcClient.make(ServerRpcGroup);
      if (environment.primary) {
        yield* settingsFile(client).pipe(
          Effect.tap((file) => Effect.sync(() => attachSettingsFile(file))),
          Effect.catchCause((cause) =>
            Effect.sync(() => console.warn("[t3ext] settings file unavailable", cause)),
          ),
          Effect.forkScoped,
        );
      }
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          clients.set(environmentId, { client, route });
          if (!environment.primary) return;
          setPrimaryEnvironmentId(environmentId);
          primaryClient = client;
          for (const handler of sessionHandlers) startHandler(handler);
        }),
        () =>
          Effect.suspend(() => {
            clients.delete(environmentId);
            if (!environment.primary) return Effect.void;
            primaryClient = null;
            return Effect.forEach([...running.keys()], stopHandler, { discard: true });
          }),
      );
      yield* client["orchestration.subscribeShell"]({ requestCompletionMarker: true }).pipe(
        Stream.runForEach((item) =>
          Effect.sync(() => {
            setConnectionStatus(environment.key, "live");
            applyShellItem(environmentId, item);
          }),
        ),
      );
    }).pipe(Effect.scoped, Effect.provide(protocol));
  }).pipe(
    // Every reconnect subscribes without a cursor, so it starts from a fresh snapshot.
    Effect.catchCause((cause) =>
      Effect.sync(() => console.warn(`[t3ext] shell stream ended (${environment.environmentId ?? "primary"})`, cause)),
    ),
    Effect.ensuring(
      Effect.sync(() => {
        if (environment.primary) attachSettingsFile(null);
        if (statuses.has(environment.key)) setConnectionStatus(environment.key, "offline");
      }),
    ),
  );

const keepConnected = (environment: Environment) => {
  setConnectionStatus(environment.key, "connecting");
  return Effect.runFork(Effect.forever(session(environment).pipe(Effect.andThen(Effect.sleep(RECONNECT_DELAY)))));
};

/** Saved environments being followed, by their catalog key. */
const saved = new Map<string, { readonly environmentId: string; readonly fiber: Fiber.Fiber<unknown> }>();

/** Connects saved environments added since the last read and drops removed ones. */
const syncSaved = Effect.promise(() => savedEnvironments().catch(() => null)).pipe(
  Effect.flatMap((environments) =>
    Effect.gen(function* () {
      if (environments === null) return;
      const wanted = new Set(environments.map((environment) => environment.key));
      for (const [key, { environmentId, fiber }] of saved) {
        if (wanted.has(key)) continue;
        saved.delete(key);
        yield* Fiber.interrupt(fiber);
        setConnectionStatus(key, null);
        // Another key for the same environment (new route or token) refills it.
        if (!environments.some((environment) => environment.environmentId === environmentId)) {
          clearEnvironment(environmentId);
        }
      }
      for (const environment of environments) {
        if (saved.has(environment.key)) continue;
        saved.set(environment.key, { environmentId: environment.environmentId, fiber: keepConnected(environment) });
      }
    }),
  ),
);

export function connect(): void {
  keepConnected(primaryEnvironment());
  if (window.desktopBridge?.getConnectionCatalog) {
    Effect.runFork(Effect.forever(syncSaved.pipe(Effect.andThen(Effect.sleep(CATALOG_INTERVAL)))));
  }
}
