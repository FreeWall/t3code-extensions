import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import { Socket } from "effect/unstable/socket";

import { record, string } from "./json.ts";
import { type LaunchThreadInput, type OrchestrationCommand, ORCHESTRATION_PROTOCOL_VERSION, ServerRpcGroup } from "./protocol.ts";
import { attachSettingsFile, SETTINGS_DIRECTORY, type SettingsFile } from "./settings.ts";
import { applyShellItem, setPrimaryEnvironmentId, setStatus } from "./store.ts";

const RECONNECT_DELAY = "3 seconds";
const SETTINGS_FILE = "settings.json";

interface Endpoint {
  readonly httpBaseUrl: string;
  readonly wsBaseUrl: string;
}

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
    };
  }
}

const withSlash = (url: string): string => (url.endsWith("/") ? url : `${url}/`);

/**
 * The desktop window loads from `t3code://`, so the backend's address comes from the
 * same bridge the app uses. A plain browser tab talks to its own origin.
 */
function resolveEndpoint(): Endpoint {
  const primary = window.desktopBridge
    ?.getLocalEnvironmentBootstraps?.()
    .find((entry) => entry.id === "primary");
  if (primary?.httpBaseUrl && primary.wsBaseUrl) {
    return { httpBaseUrl: withSlash(primary.httpBaseUrl), wsBaseUrl: primary.wsBaseUrl };
  }
  const origin = window.location.origin;
  return { httpBaseUrl: `${origin}/`, wsBaseUrl: origin.replace(/^http/, "ws") };
}

/**
 * The desktop window authenticates to its backend with the bearer token the bridge
 * hands out (the backend's CORS allows no credentials), the same as `httpLayer.ts`.
 * A same-origin browser tab uses its session cookie instead.
 */
async function openSocketUrl(target: Endpoint): Promise<string> {
  const bearer = await window.desktopBridge?.getLocalEnvironmentBearerToken?.();
  const response = await fetch(`${target.httpBaseUrl}api/auth/websocket-ticket`, {
    method: "POST",
    ...(bearer
      ? { headers: { authorization: `Bearer ${bearer}` }, credentials: "omit" as const }
      : { credentials: "include" as const }),
  });
  if (!response.ok) throw new Error(`websocket-ticket: HTTP ${response.status}`);
  const ticket = string(record(await response.json())?.ticket);
  if (!ticket) throw new Error("websocket-ticket: response has no ticket");
  const url = new URL(target.wsBaseUrl);
  url.pathname = "/ws";
  url.searchParams.set("orchestrationProtocol", String(ORCHESTRATION_PROTOCOL_VERSION));
  url.searchParams.set("wsTicket", ticket);
  return url.toString();
}

async function fetchEnvironmentId(target: Endpoint): Promise<string> {
  const response = await fetch(`${target.httpBaseUrl}.well-known/t3/environment`);
  if (!response.ok) throw new Error(`environment descriptor: HTTP ${response.status}`);
  const environmentId = string(record(await response.json())?.environmentId);
  if (!environmentId) throw new Error("environment descriptor has no environmentId");
  return environmentId;
}

export type ServerClient = RpcClient.FromGroup<typeof ServerRpcGroup>;

/**
 * The window's own backend, the only one with a socket. Other environments are read
 * from the app's cache (`appCache.ts`), so commands to them are refused as offline.
 */
let live: { readonly environmentId: string; readonly client: ServerClient; readonly endpoint: Endpoint } | null =
  null;

const clientFor = (environmentId: string): ServerClient => {
  if (live?.environmentId !== environmentId) throw new Error("offline");
  return live.client;
};

/** Resolves a signed `assets.createUrl` result to an absolute URL, or null while offline. */
export async function createAssetUrl(environmentId: string, resource: unknown): Promise<string | null> {
  if (live?.environmentId !== environmentId) return null;
  const { client, endpoint } = live;
  const result = (await Effect.runPromise(client["assets.createUrl"]({ resource }))) as { relativeUrl?: string };
  return result.relativeUrl ? new URL(result.relativeUrl, endpoint.httpBaseUrl).toString() : null;
}

/** Runs for as long as a socket is up; interrupted when it drops. */
export type SessionHandler = (client: ServerClient) => Effect.Effect<void>;
const sessionHandlers = new Set<SessionHandler>();
/** Handlers running on the current socket; empty while offline. */
const running = new Map<SessionHandler, Fiber.Fiber<void>>();

const startHandler = (handler: SessionHandler): void => {
  if (live !== null) running.set(handler, Effect.runFork(handler(live.client)));
};

const stopHandler = (handler: SessionHandler): Effect.Effect<void> => {
  const fiber = running.get(handler);
  running.delete(handler);
  return fiber ? Fiber.interrupt(fiber) : Effect.void;
};

/**
 * Lets an extension use the socket: the handler runs on every session, starting
 * right away when one is up. Returns what stops it, for an extension switched off.
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

let endpoint: Endpoint | null = null;

const session = Effect.gen(function* () {
  const target = endpoint!;
  const socketUrl = yield* Effect.promise(() => openSocketUrl(target));
  const environmentId = yield* Effect.promise(() => fetchEnvironmentId(target));
  setPrimaryEnvironmentId(environmentId);
  const protocol = RpcClient.layerProtocolSocket().pipe(
    Layer.provide(
      Socket.layerWebSocket(socketUrl).pipe(Layer.provide(Socket.layerWebSocketConstructorGlobal)),
    ),
    Layer.provide(RpcSerialization.layerJson),
  );
  yield* Effect.gen(function* () {
    const client = yield* RpcClient.make(ServerRpcGroup);
    yield* settingsFile(client).pipe(
      Effect.tap((file) => Effect.sync(() => attachSettingsFile(file))),
      Effect.catchCause((cause) =>
        Effect.sync(() => console.warn("[t3ext] settings file unavailable", cause)),
      ),
      Effect.forkScoped,
    );
    yield* Effect.acquireRelease(
      Effect.sync(() => {
        live = { environmentId, client, endpoint: target };
        for (const handler of sessionHandlers) startHandler(handler);
      }),
      () =>
        Effect.suspend(() => {
          live = null;
          return Effect.forEach([...running.keys()], stopHandler, { discard: true });
        }),
    );
    yield* client["orchestration.subscribeShell"]({ requestCompletionMarker: true }).pipe(
      Stream.runForEach((item) =>
        Effect.sync(() => {
          setStatus("live");
          applyShellItem(environmentId, item);
        }),
      ),
    );
  }).pipe(Effect.scoped, Effect.provide(protocol));
}).pipe(
  // Every reconnect subscribes without a cursor, so it starts from a fresh snapshot.
  Effect.catchCause((cause) => Effect.sync(() => console.warn("[t3ext] shell stream ended", cause))),
  Effect.ensuring(
    Effect.sync(() => {
      attachSettingsFile(null);
      setStatus("offline");
    }),
  ),
);

export function connect(): void {
  endpoint = resolveEndpoint();
  Effect.runFork(Effect.forever(session.pipe(Effect.andThen(Effect.sleep(RECONNECT_DELAY)))));
}
