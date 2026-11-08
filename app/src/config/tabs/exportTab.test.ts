import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

test("export format settings start with the title option followed by Markdown metadata and numbering", () => {
    const source = require("ifdef-loader/preprocessor").parse(readFileSync("src/config/tabs/exportTab.ts", "utf8"),
        {BROWSER: true}, false, true);
    const exports = {} as typeof import("./exportTab");
    const switches: {key: string; title: string; desc: string}[] = [];
    const formatSwitches: string[] = [];
    let groupName = "";
    const group = new Proxy({}, {get: (_target, key) => key === "switch" ?
        (id: string, options: {title: string; desc: string}) => {
            switches.push({key: id, ...options});
            if (groupName === "format") formatSwitches.push(id);
        } : () => {}});
    runInNewContext(transpileModule(source, {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText, {exports, require: () => ({}), window: {siyuan: {
        languages: new Proxy({}, {get: (_target, key) => key}),
    }}});
    exports.registerExportTab({group: (name: string) => {
        groupName = name;
        return group;
    }} as unknown as Parameters<typeof exports.registerExportTab>[0]);
    const index = switches.findIndex(item => item.key === "export.headingNumber");
    assert.deepEqual(formatSwitches.slice(0, 3), [
        "export.addTitle", "export.markdownYFM", "export.headingNumber",
    ]);
    assert.deepEqual(switches[index], {
        key: "export.headingNumber", title: "exportHeadingNumber", desc: "exportHeadingNumberTip",
    });
    assert.equal(switches.filter(item => item.key === "export.headingNumber").length, 1);
});
