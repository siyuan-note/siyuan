import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const core = {} as typeof import("../util/headingNumberCore");
runInNewContext(transpileModule(readFileSync("src/protyle/util/headingNumberCore.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText, {exports: core, require: () => ({Constants: {CUSTOM_SY_HEADING_NUMBER: "custom-sy-heading-number"}})});

const setup = (customValue?: string, globalEnabled = false, code = 0) => {
    let options: {content: string, title: string, destroyCallback: () => void};
    let checked = true;
    const handlers: (() => void)[] = [];
    const calls: unknown[] = [];
    const exports = {} as typeof import("./copyHeadingNumber");
    const dependencies: Record<string, unknown> = {
        "../../constants": {Constants: {CUSTOM_SY_HEADING_NUMBER: "custom-sy-heading-number"}},
        "../util/headingNumberCore": core,
        "../../util/fetch": {fetchSyncPost: async (url: string, body: unknown) => {
            calls.push({url, body});
            return {code, data: {ial: {"custom-sy-heading-number": customValue}}};
        }},
        "../../dialog/mobileDialog": {MobileDialog: class {
            element = {
                querySelector: () => ({checked}),
                querySelectorAll: () => [0, 1].map(index => ({addEventListener: (_name: string, handler: () => void) => {
                    handlers[index] = handler;
                }})),
            };
            constructor(value: typeof options) { options = value; }
            destroy() { options.destroyCallback(); }
        }},
    };
    runInNewContext(transpileModule(readFileSync("src/protyle/export/copyHeadingNumber.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText, {exports, require: (name: string) => dependencies[name], window: {siyuan: {
        config: {editor: {headingNumber: globalEnabled}},
        languages: {headingNumber: "Heading numbering", headingNumberTip: "Number headings", cancel: "Cancel", copy: "Copy"},
    }}});
    return {select: exports.selectCopyHeadingNumber, calls, getOptions: () => options,
        confirm: (value = true) => { checked = value; handlers[1](); }, cancel: () => handlers[0]()};
};

for (const [custom, global] of [["false", true], [undefined, false], ["invalid", false]] as const) {
    test(`copy skips the dialog when numbering is disabled (${custom}, ${global})`, async () => {
        const state = setup(custom, global);
        assert.equal(await state.select("block", "Copy Markdown"), true);
        assert.equal(state.getOptions(), undefined);
        assert.equal(JSON.stringify(state.calls), JSON.stringify([{url: "/api/block/getDocInfo", body: {id: "block"}}]));
    });
}

for (const [custom, global] of [["true", false], [undefined, true], ["invalid", true]] as const) {
    for (const keep of [true, false]) {
        test(`copy uses a one-time numbering choice (${custom}, ${global}, ${keep})`, async () => {
            const state = setup(custom, global);
            const result = state.select("block", "Copy document");
            await new Promise(resolve => setImmediate(resolve));
            assert.equal(state.getOptions().title, "Copy document");
            assert.match(state.getOptions().content, /type="checkbox" checked/);
            state.confirm(keep);
            assert.equal(await result, keep);
        });
    }
}

test("cancel and document lookup failure abort copying", async () => {
    const state = setup("true");
    const result = state.select("block", "Copy Markdown");
    await new Promise(resolve => setImmediate(resolve));
    state.cancel();
    assert.equal(await result, undefined);
    const failed = setup("true", true, -1);
    assert.equal(await failed.select("block", "Copy Markdown"), undefined);
    assert.equal(failed.getOptions(), undefined);
});
