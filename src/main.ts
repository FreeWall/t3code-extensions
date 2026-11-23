import { watchAppState } from "./appState.ts";
import { connect } from "./connection.ts";
import { extensions, startExtensions } from "./host.ts";
import { mountSettingsPage } from "./settings-page/index.tsx";

mountSettingsPage();
startExtensions();
connect();
watchAppState();
console.info(`[t3ext] loaded: ${extensions.map((extension) => extension.name).join(", ")}`);
