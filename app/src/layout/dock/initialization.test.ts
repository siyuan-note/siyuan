import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {test} from "node:test";
import {transpileModule, ScriptTarget} from "typescript";

test("publishing removes unavailable docks without skipping adjacent titles", () => {
    const source = readFileSync(join(__dirname, "../util.ts"), "utf8");
    const start = source.indexOf("const initInternalDock =");
    const end = source.indexOf("const JSONToDock =", start);
    const compiled = transpileModule(source.slice(start, end), {
        compilerOptions: {target: ScriptTarget.ES2020},
    }).outputText;
    const languages = {graphView: "Graph View", globalGraph: "Global Graph", bookmark: "Bookmarks"};
    for (const isPublish of [true, false]) {
        const init = new Function("window", "isDisabledFeature", compiled + "return initInternalDock;")(
            {siyuan: {isPublish, languages}}, () => !isPublish);
        const docks = [
            {type: "agentChat", hotkeyLangId: "agentChat"},
            ...(isPublish ? [{type: "inbox", hotkeyLangId: "inbox"}] : []),
            {type: "graph", hotkeyLangId: "graphView"},
            {type: "globalGraph", hotkeyLangId: "globalGraph"},
            {type: "bookmark", hotkeyLangId: "bookmark"},
        ];
        init(docks);
        assert.deepEqual(docks.map(item => item.type), ["graph", "globalGraph", "bookmark"]);
        assert.deepEqual(docks.map(item => (item as {title?: string}).title), Object.values(languages));
    }
});
