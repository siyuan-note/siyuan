import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

test("export settings register the persisted Markdown numbering switch beside the title setting", () => {
    const source = require("ifdef-loader/preprocessor").parse(readFileSync("src/config/tabs/exportTab.ts", "utf8"),
        {BROWSER: true}, false, true);
    const exports = {} as typeof import("./exportTab");
    const switches: {key: string; title: string; desc: string}[] = [];
    const group = new Proxy({}, {get: (_target, key) => key === "switch" ?
        (id: string, options: {title: string; desc: string}) => switches.push({key: id, ...options}) : () => {}});
    runInNewContext(transpileModule(source, {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText, {exports, require: () => ({}), window: {siyuan: {
        languages: new Proxy({}, {get: (_target, key) => key}),
    }}});
    exports.registerExportTab({group: () => group} as unknown as Parameters<typeof exports.registerExportTab>[0]);
    const index = switches.findIndex(item => item.key === "export.headingNumber");
    assert.equal(switches[index - 1].key, "export.addTitle");
    assert.deepEqual(switches[index], {
        key: "export.headingNumber", title: "exportHeadingNumber", desc: "exportHeadingNumberTip",
    });
    assert.equal(switches.filter(item => item.key === "export.headingNumber").length, 1);
});
