import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import { Socket } from "effect/unstable/socket";

import { ORCHESTRATION_PROTOCOL_VERSION, ServerRpcGroup } from "./protocol.ts";
import { attachSettingsFile, type SettingsFile } from "./settings.ts";
import { applyShellItem, setEnvironmentId, setStatus } from "./store.ts";

const RECONNECT_DELAY = "3 seconds";
const SETTINGS_DIRECTORY = ".config/t3code-extensions";
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

let endpoint: Endpoint | null = null;

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
  const { ticket } = (await response.json()) as { ticket?: string };
  if (!ticket) throw new Error("websocket-ticket: response has no ticket");
  const url = new URL(target.wsBaseUrl);
  url.pathname = "/ws";
  url.searchParams.set("orchestrationProtocol", String(ORCHESTRATION_PROTOCOL_VERSION));
  url.searchParams.set("wsTicket", ticket);
  return url.toString();
}

async function loadEnvironmentId(target: Endpoint): Promise<void> {
  const response = await fetch(`${target.httpBaseUrl}.well-known/t3/environment`);
  if (!response.ok) return;
  const { environmentId } = (await response.json()) as { environmentId?: string };
  if (environmentId) setEnvironmentId(environmentId);
}

type CreateUrl = (resource: unknown) => Promise<unknown>;
let createUrl: CreateUrl | null = null;

/** Resolves a signed `assets.createUrl` result to an absolute URL, or null while offline. */
export async function createAssetUrl(resource: unknown): Promise<string | null> {
  if (createUrl === null || endpoint === null) return null;
  const result = (await createUrl(resource)) as { relativeUrl?: string };
  return result.relativeUrl ? new URL(result.relativeUrl, endpoint.httpBaseUrl).toString() : null;
}

export type ServerClient = RpcClient.FromGroup<typeof ServerRpcGroup>;

/** Runs for as long as a socket is up; interrupted when it drops. */
export type SessionHandler = (client: ServerClient) => Effect.Effect<void>;
const sessionHandlers: SessionHandler[] = [];

/** Lets an extension use the socket; call before `connect`. */
export const onSession = (handler: SessionHandler): void => {
  sessionHandlers.push(handler);
};

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

const session = Effect.gen(function* () {
  const target = endpoint!;
  const socketUrl = yield* Effect.promise(() => openSocketUrl(target));
  const protocol = RpcClient.layerProtocolSocket().pipe(
    Layer.provide(
      Socket.layerWebSocket(socketUrl).pipe(Layer.provide(Socket.layerWebSocketConstructorGlobal)),
    ),
    Layer.provide(RpcSerialization.layerJson),
  );
  yield* Effect.gen(function* () {
    const client = yield* RpcClient.make(ServerRpcGroup);
    createUrl = (resource) => Effect.runPromise(client["assets.createUrl"]({ resource }));
    yield* settingsFile(client).pipe(
      Effect.tap((file) => Effect.sync(() => attachSettingsFile(file))),
      Effect.catchCause((cause) =>
        Effect.sync(() => console.warn("[t3ext] settings file unavailable", cause)),
      ),
      Effect.forkScoped,
    );
    for (const handler of sessionHandlers) yield* Effect.forkScoped(handler(client));
    yield* client["orchestration.subscribeShell"]({ requestCompletionMarker: true }).pipe(
      Stream.runForEach((item) =>
        Effect.sync(() => {
          setStatus("live");
          applyShellItem(item);
        }),
      ),
    );
  }).pipe(Effect.scoped, Effect.provide(protocol));
}).pipe(
  // Every reconnect subscribes without a cursor, so it starts from a fresh snapshot.
  Effect.catchCause((cause) => Effect.sync(() => console.warn("[t3ext] shell stream ended", cause))),
  Effect.ensuring(
    Effect.sync(() => {
      createUrl = null;
      attachSettingsFile(null);
      setStatus("offline");
    }),
  ),
);

export function connect(): void {
  endpoint = resolveEndpoint();
  void loadEnvironmentId(endpoint).catch(() => undefined);
  Effect.runFork(Effect.forever(session.pipe(Effect.andThen(Effect.sleep(RECONNECT_DELAY)))));
}
