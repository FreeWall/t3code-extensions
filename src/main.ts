import { connect } from "./connection.ts";
import { extensions, startExtensions } from "./host.ts";
import { mountSettingsPage } from "./settings-page/index.tsx";

mountSettingsPage();
startExtensions();
connect();
console.info(`[t3ext] loaded: ${extensions.map((extension) => extension.name).join(", ")}`);
