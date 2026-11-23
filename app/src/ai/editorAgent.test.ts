import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import type {AgentQuote} from "../layout/dock/agent/agentQuote";

const {parse} = require("ifdef-loader/preprocessor");

test("editor quotes reveal a floating agent once and report later hidden insertions", async () => {
    const methods = {} as typeof import("./editorAgent");
    const events: unknown[] = [];
    let active = true;
    let panelVisible = true;
    let count = 0;
    const dock = {
        data: {agentChat: {
            insertBlockMentions() {},
            async insertQuote(quote: AgentQuote, inBackground: boolean) {
                events.push([quote.text, inBackground]);
                return ++count;
            },
        }},
        isFloating: () => true,
        isPanelVisible: () => panelVisible,
        layout: {element: {style: {opacity: "0"}}},
        showDock() {
            events.push("reveal");
            this.layout.element.style.opacity = "1";
        },
        toggleModel() {
            active = true;
            panelVisible = true;
            this.showDock();
        },
    };
    const source = parse(readFileSync("src/ai/editorAgent.ts", "utf8"), {MOBILE: false}, false, true);
    runInNewContext(transpileModule(source, {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
    }).outputText, {
        exports: methods,
        document: {querySelector: () => active},
        window: {siyuan: {config: {}, languages: {agentQuoteAdded: "Quotes: ${count}"}}},
        require: (name: string) => ({
            "../layout/tabUtil": {getDockByType: () => dock},
            "../dialog/message": {showMessage: (message: string) => events.push(message)},
            "../protyle/util/compatibility": {isDisabledFeature: () => false},
            "../util/pathName": {isEncryptedBox: () => false},
            "../protyle/util/selection": {getBlockRanges: (_element: unknown, range: Range) => [{
                range, blockElement: {dataset: {nodeId: "source"}},
                editableElement: {matches: () => false}, start: 0, end: range.toString().length,
            }]},
        })[name] || {},
    });
    const editor = {app: {}, block: {rootID: "source"}, wysiwyg: {element: {}}} as IProtyle;
    const quote = (text: string, target = editor) =>
        methods.quoteEditorSelection(target, {toString: () => text} as Range);

    await quote("first");
    await quote("visible");
    dock.layout.element.style.opacity = "0";
    await quote("hover-hidden");
    active = false;
    panelVisible = false;
    await quote("closed");
    await quote("first in another editor", {...editor});
    assert.deepEqual(events, [
        "reveal", ["first", false], ["visible", false],
        ["hover-hidden", true], "Quotes: 3", ["closed", true], "Quotes: 4",
        "reveal", ["first in another editor", false],
    ]);
});
