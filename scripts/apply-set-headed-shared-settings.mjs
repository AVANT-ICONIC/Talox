import fs from "node:fs";

const path = "src/core/controller/TaloxController.ts";
let source = fs.readFileSync(path, "utf8");
const search = `\tasync setHeaded(headed: boolean): Promise<void> {\n\t\tconst frame = this.getAttentionFrame();\n\t\tthis.settings.headed = headed;\n\t\tawait this._session.setHeadedMode(headed);`;
const replacement = `\tasync setHeaded(headed: boolean): Promise<void> {\n\t\tconst frame = this.getAttentionFrame();\n\t\tawait this._session.setHeadedMode(headed);`;
const first = source.indexOf(search);
if (first === -1) throw new Error("setHeaded shared-settings anchor missing");
if (source.indexOf(search, first + search.length) !== -1) throw new Error("setHeaded shared-settings anchor duplicated");
source = source.slice(0, first) + replacement + source.slice(first + search.length);
fs.writeFileSync(path, source);
