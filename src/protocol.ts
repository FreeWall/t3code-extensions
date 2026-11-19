import * as Schema from "effect/Schema";
import { Rpc, RpcGroup } from "effect/unstable/rpc";

/**
 * The server RPCs the extensions use, mirrored from `packages/contracts/src/rpc.ts`.
 * Only the tags and payload shapes have to match the wire. Results stay `Unknown`
 * so new shell fields in a nightly don't break decoding.
 */
const SubscribeShellRpc = Rpc.make("orchestration.subscribeShell", {
  payload: Schema.Struct({
    afterSequence: Schema.optional(Schema.Number),
    requestCompletionMarker: Schema.optional(Schema.Boolean),
  }),
  success: Schema.Unknown,
  error: Schema.Unknown,
  stream: true,
});

/** Server config and provider status stream; the usage bar reads `providers[].usageLimits`. */
const SubscribeServerConfigRpc = Rpc.make("subscribeServerConfig", {
  payload: Schema.Struct({}),
  success: Schema.Unknown,
  error: Schema.Unknown,
  stream: true,
});

/**
 * Re-probes one provider instance, usage limits included; results arrive as
 * `providerStatuses`. `refreshModels` is the app's explicit-refresh flag: it also
 * drops the instance's probe cache (Claude keeps `get_usage` for 5 minutes).
 */
const ServerRefreshProvidersRpc = Rpc.make("server.refreshProviders", {
  payload: Schema.Struct({
    instanceId: Schema.optional(Schema.String),
    refreshModels: Schema.optional(Schema.Boolean),
  }),
  success: Schema.Unknown,
  error: Schema.Unknown,
});

const AssetsCreateUrlRpc = Rpc.make("assets.createUrl", {
  payload: Schema.Struct({ resource: Schema.Unknown }),
  success: Schema.Unknown,
  error: Schema.Unknown,
});

/** `~` expands here, so it tells us where the server's home directory is. */
const FilesystemBrowseRpc = Rpc.make("filesystem.browse", {
  payload: Schema.Struct({ partialPath: Schema.String }),
  success: Schema.Unknown,
  error: Schema.Unknown,
});

/** An absolute `relativePath` reads any host file; `cwd` need not be a project. */
const ProjectsReadFileRpc = Rpc.make("projects.readFile", {
  payload: Schema.Struct({ cwd: Schema.String, relativePath: Schema.String }),
  success: Schema.Unknown,
  error: Schema.Unknown,
});

/** Writes under `cwd`, creating missing directories. */
const ProjectsWriteFileRpc = Rpc.make("projects.writeFile", {
  payload: Schema.Struct({ cwd: Schema.String, relativePath: Schema.String, contents: Schema.String }),
  success: Schema.Unknown,
  error: Schema.Unknown,
});

/**
 * Orchestration commands, mirrored from `OrchestrationV2Command` in the contracts;
 * only the ones extensions send. `thread.tag.set` leaves `updatedAt` alone.
 */
const ThreadTagSetCommand = Schema.Struct({
  type: Schema.Literal("thread.tag.set"),
  commandId: Schema.String,
  threadId: Schema.String,
  tag: Schema.String,
  tagged: Schema.Boolean,
});

const ThreadDeleteCommand = Schema.Struct({
  type: Schema.Literal("thread.delete"),
  commandId: Schema.String,
  threadId: Schema.String,
});

const OrchestrationCommand = Schema.Union([ThreadTagSetCommand, ThreadDeleteCommand]);
export type OrchestrationCommand = typeof OrchestrationCommand.Type;

const DispatchCommandRpc = Rpc.make("orchestration.dispatchCommand", {
  payload: OrchestrationCommand,
  success: Schema.Unknown,
  error: Schema.Unknown,
});

/** Creates a thread and sends its first message in one step, like the app's composer. */
const LaunchThreadInput = Schema.Struct({
  commandId: Schema.String,
  projectId: Schema.String,
  title: Schema.String,
  generateTitle: Schema.Boolean,
  modelSelection: Schema.Struct({ instanceId: Schema.String, model: Schema.String }),
  runtimeMode: Schema.Literals(["approval-required", "auto-accept-edits", "auto", "full-access"]),
  interactionMode: Schema.Literals(["default", "plan"]),
  workspaceStrategy: Schema.Struct({ type: Schema.Literal("root") }),
  initialMessage: Schema.Struct({ text: Schema.String, attachments: Schema.Array(Schema.Unknown) }),
});
export type LaunchThreadInput = typeof LaunchThreadInput.Type;

const LaunchThreadRpc = Rpc.make("orchestration.launchThread", {
  payload: LaunchThreadInput,
  success: Schema.Unknown,
  error: Schema.Unknown,
});

/** One thread's full state, messages included. */
const GetThreadProjectionRpc = Rpc.make("orchestration.getThreadProjection", {
  payload: Schema.Struct({ threadId: Schema.String }),
  success: Schema.Unknown,
  error: Schema.Unknown,
});

export const ServerRpcGroup = RpcGroup.make(
  SubscribeShellRpc,
  SubscribeServerConfigRpc,
  ServerRefreshProvidersRpc,
  AssetsCreateUrlRpc,
  FilesystemBrowseRpc,
  ProjectsReadFileRpc,
  ProjectsWriteFileRpc,
  DispatchCommandRpc,
  LaunchThreadRpc,
  GetThreadProjectionRpc,
);

/** Must match the server; the /ws upgrade is rejected with 426 otherwise. */
export const ORCHESTRATION_PROTOCOL_VERSION = 2;
