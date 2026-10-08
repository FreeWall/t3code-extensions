import * as Schema from "effect/Schema";
import { Rpc, RpcGroup } from "effect/unstable/rpc";

/**
 * The server RPCs the rail uses, mirrored from `packages/contracts/src/rpc.ts`.
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

const AssetsCreateUrlRpc = Rpc.make("assets.createUrl", {
  payload: Schema.Struct({ resource: Schema.Unknown }),
  success: Schema.Unknown,
  error: Schema.Unknown,
});

/** `~` expands here, so it tells the rail where the server's home directory is. */
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

export const RailRpcGroup = RpcGroup.make(
  SubscribeShellRpc,
  AssetsCreateUrlRpc,
  FilesystemBrowseRpc,
  ProjectsReadFileRpc,
  ProjectsWriteFileRpc,
);

/** Must match the server; the /ws upgrade is rejected with 426 otherwise. */
export const ORCHESTRATION_PROTOCOL_VERSION = 2;
