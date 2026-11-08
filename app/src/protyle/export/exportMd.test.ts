import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

test("Markdown export offers one-time heading numbering directly after the title option", () => {
    let content = "";
    let payload: {headingNumber: boolean};
    let checked = true;
    const handlers: (() => void)[] = [];
    const config = {addTitle: true, includeSubDocs: true};
    const exports = {} as typeof import("./exportMd");
    const dependencies: Record<string, unknown> = {
        "../../constants": {Constants: {}},
        "../../util/functions": {isMobile: () => false},
        "../../dialog/mobileDialog": {MobileDialog: class {
            element = {
                setAttribute: () => {},
                querySelector: (selector: string) => ({checked: selector === "#headingNumber" ? checked : false, value: ""}),
                querySelectorAll: () => [0, 1].map(index => ({addEventListener: (_name: string, handler: () => void) => {
                    handlers[index] = handler;
                }})),
            };
            constructor(options: {content: string}) { content = options.content; }
            destroy() {}
        }},
    };
    runInNewContext(transpileModule(readFileSync("src/protyle/export/exportMd.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText, {exports, require: (name: string) => dependencies[name] || {}, window: {siyuan: {
        config: {export: config}, languages: {},
    }}});
    exports.openExportOptionsDialog(value => { payload = value; });
    assert.ok(content.indexOf('id="addTitle"') < content.indexOf('id="headingNumber"'));
    assert.ok(content.indexOf('id="headingNumber"') < content.indexOf('id="includeSubDocs"'));
    assert.match(content, /id="headingNumber"[^>]+checked/);
    handlers[1]();
    assert.equal(payload.headingNumber, true);
    exports.openExportOptionsDialog(value => { payload = value; });
    checked = false;
    handlers[1]();
    assert.equal(payload.headingNumber, false);
    assert.deepEqual(config, {addTitle: true, includeSubDocs: true});
});
