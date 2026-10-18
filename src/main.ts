import { connect } from "./connection.ts";
import type { Extension } from "./extension.ts";
import { rail } from "./rail/index.tsx";
import { usage } from "./usage/index.ts";

const extensions: ReadonlyArray<Extension> = [rail, usage];

const style = document.createElement("style");
style.id = "t3ext-styles";
style.textContent = extensions.map((extension) => extension.styles).join("\n");
document.head.append(style);

for (const extension of extensions) extension.mount();
connect();
console.info(`[t3ext] loaded: ${extensions.map((extension) => extension.name).join(", ")}`);
