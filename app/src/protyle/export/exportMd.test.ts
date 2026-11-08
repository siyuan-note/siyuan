import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

test("Markdown export uses persisted numbering without adding a heading number control", () => {
    let content = "";
    let payload: {headingNumber: boolean};
    const handlers: (() => void)[] = [];
    const config: {addTitle: boolean; includeSubDocs: boolean; headingNumber?: boolean} = {addTitle: true, includeSubDocs: true};
    const exports = {} as typeof import("./exportMd");
    const dependencies: Record<string, unknown> = {
        "../../constants": {Constants: {}},
        "../../util/functions": {isMobile: () => false},
        "../../dialog/mobileDialog": {MobileDialog: class {
            element = {
                setAttribute: () => {},
                querySelector: () => ({checked: false, value: ""}),
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
    assert.ok(content.includes('id="addTitle"'));
    assert.ok(content.includes('id="includeSubDocs"'));
    assert.equal(content.includes('id="headingNumber"'), false);
    handlers[1]();
    assert.equal(payload.headingNumber, false);
    exports.openExportOptionsDialog(value => { payload = value; });
    config.headingNumber = true;
    handlers[1]();
    assert.equal(payload.headingNumber, true);
    assert.deepEqual(config, {addTitle: true, includeSubDocs: true, headingNumber: true});
    config.headingNumber = false;
    exports.openExportOptionsDialog(value => { payload = value; });
    handlers[1]();
    assert.equal(payload.headingNumber, false);
    assert.deepEqual(config, {addTitle: true, includeSubDocs: true, headingNumber: false});
});
