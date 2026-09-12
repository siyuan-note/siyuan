import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {runInNewContext} from "node:vm";
import * as ts from "typescript";
import * as clipboardData from "./clipboardData";

const source = ts.transpileModule(readFileSync(join(process.cwd(), "src/protyle/util/compatibility.ts"), "utf8"), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
}).outputText;

const createHarness = (richResult: boolean | void, plainResult: boolean | void = true) => {
    let html = "";
    let plain = "";
    let plainWrites = 0;
    const module = {exports: {}};
    runInNewContext(source, {
        module, exports: module.exports, console,
        require: (id: string) => id === "./clipboardData" ? clipboardData : {},
        window: {
            siyuan: {config: {system: {container: "harmony"}}, languages: {clipboardPermissionDenied: "Denied"}},
            JSHarmony: {
                writeHTMLClipboard: (text: string, value: string) => {
                    plain = text;
                    html = value;
                    return richResult;
                },
                writeSiYuanHTMLClipboard: () => { throw new Error("Legacy writer must not be used"); },
                writeClipboard: () => { plainWrites++; return plainResult; },
                readClipboard: () => plain,
                readHTMLClipboard: () => html,
                readSiYuanHTMLClipboard: () => "",
            },
        },
    });
    return {
        api: module.exports as typeof import("./compatibility"),
        getHTML: () => html,
        getPlainWrites: () => plainWrites,
        setHTML: (value: string) => { html = value; },
    };
};

describe("Harmony clipboard bridge", () => {
    const data = {
        textPlain: "剪切实验 😀",
        textHTML: "<p>剪切实验 😀</p>",
        textSiyuan: '<div data-type="NodeParagraph">剪切实验 😀</div>',
    };

    it("writes comment HTML readable through both system paste and the native bridge", async () => {
        const harness = createHarness(true);
        assert.equal((await harness.api.writeClipboardData(data)).status, "rich");
        assert.deepEqual(clipboardData.getTextSiyuanFromTextHTML(harness.getHTML()), {
            textHtml: data.textHTML, textSiyuan: data.textSiyuan,
        });
        const read = await harness.api.readClipboard();
        assert.equal(read.textPlain, data.textPlain);
        assert.equal(read.textHTML, data.textHTML);
        assert.equal(read.siyuanHTML, data.textSiyuan);
    });

    it("accepts void results from older shells", async () => {
        const harness = createHarness(undefined);
        assert.equal((await harness.api.writeClipboardData(data)).status, "rich");
    });

    it("reads legacy clipboard HTML without a visible separator", async () => {
        const harness = createHarness(true);
        harness.setHTML(data.textHTML + "__@text/siyuan@__" + data.textSiyuan);
        const read = await harness.api.readClipboard();
        assert.equal(read.textHTML, data.textHTML);
        assert.equal(read.siyuanHTML, data.textSiyuan);
    });

    it("reports failure without plain text fallback for cut", async () => {
        const harness = createHarness(false);
        assert.equal((await harness.api.writeClipboardData(data, {fallbackToPlainText: false})).status, "failed");
        assert.equal(harness.getPlainWrites(), 0);
    });

    it("reports failed fallback and allows successful plain text fallback for copy", async () => {
        assert.equal((await createHarness(false, false).api.writeClipboardData(data)).status, "failed");
        assert.equal((await createHarness(false, true).api.writeClipboardData(data)).status, "plain");
    });
});
