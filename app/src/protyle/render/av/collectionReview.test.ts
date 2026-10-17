import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const compiled = transpileModule(readFileSync("src/protyle/render/av/collectionReview.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
}).outputText;

const setup = () => {
    const listeners = new Map<string, () => void | Promise<void>>();
    const elements = new Map<string, {disabled: boolean, innerHTML: string, textContent: string, addEventListener: (name: string, callback: () => void | Promise<void>) => void}>();
    ["[data-prev]", "[data-next]", "[data-cleanup]", "[data-counts]", "[data-results]"].forEach(selector => elements.set(selector, {
        disabled: false, innerHTML: "", textContent: "", addEventListener: (_name, callback) => listeners.set(selector, callback),
    }));
    const root = {isConnected: true, querySelector: (selector: string) => elements.get(selector)};
    const performed: {do: IOperation[], undo: IOperation[]}[] = [];
    const requests: number[] = [];
    const confirmations: {confirm: () => Promise<void>, cancel: () => void}[] = [];
    let items = [
        {itemID: "matched", blockID: "block-matched", status: "matched", content: "Keep", hPath: "/Tasks"},
        {itemID: "unmatched", blockID: "block-unmatched", status: "unmatched", content: "<unsafe>", hPath: "/Tasks"},
        {itemID: "unknown", blockID: "", status: "unknown", content: "Detached", hPath: ""},
    ];
    const methods = {} as typeof import("./collectionReview");
    runInNewContext(compiled, {
        exports: methods,
        window: {siyuan: {languages: {automationCollectionReview: "Review", automationCollectionCleanup: "Remove", automationCollectionReviewTip: "Review rules", automationCollectionCleanupConfirm: "Confirm removal", automationCollectionMatched: "Matching", automationCollectionUnmatched: "Not matching", automationCollectionUnknown: "Unknown"}}},
        require: (name: string) => ({
            "../../../dialog": {Dialog: class {element = root;}},
            "../../../dialog/confirmDialog": {confirmDialog: (_title: string, _text: string, confirm: () => Promise<void>, cancel: () => void) => confirmations.push({confirm, cancel})},
            "../../../util/functions": {isMobile: () => true},
            "../../../util/escape": {escapeAttr: String, escapeHtml: (value: string) => value.replace(/</g, "&lt;")},
            "../../util/transactionQueue": {waitForPendingTransactions: async () => {}},
            "../../../util/fetch": {fetchSyncPost: async (path: string, request: {avID: string, page: number}) => {
                assert.equal(path, "/api/av/reviewAttributeViewCollection");
                assert.equal(request.avID, "database");
                requests.push(request.page);
                return {code: 0, data: {items, ruleVersion: "reviewed-rules", hasMore: request.page === 1,
                    matched: 1, unmatched: items.filter(item => item.status === "unmatched").length, unknown: 1}};
            }},
            "../../wysiwyg/transaction": {transaction: (_protyle: IProtyle, operations: IOperation[], undo: IOperation[]) => {
                performed.push({do: operations, undo});
                items = items.filter(item => item.status !== "unmatched");
            }},
        })[name] || {},
    });
    return {open: () => methods.openCollectionReview({} as IProtyle, "database", "carrier"), root, elements, listeners, performed, confirmations, requests};
};

test("collection review requires confirmation and only removes reviewed unmatched bindings with an undo operation", async () => {
    const state = setup();
    await state.open();
    assert.equal(state.performed.length, 0);
    assert.ok(state.elements.get("[data-results]").innerHTML.includes("&lt;unsafe>"));
    assert.ok(state.elements.get("[data-counts]").textContent.includes("Unknown"));
    assert.equal(state.elements.get("[data-cleanup]").disabled, false);
    await state.listeners.get("[data-cleanup]")();
    assert.equal(state.performed.length, 0);
    assert.equal(state.elements.get("[data-cleanup]").disabled, true);
    await state.listeners.get("[data-cleanup]")();
    assert.equal(state.confirmations.length, 1, "repeated clicks cannot open another confirmation");
    state.confirmations[0].cancel();
    assert.equal(state.performed.length, 0);
    await state.listeners.get("[data-cleanup]")();
    await state.confirmations[1].confirm();
    assert.equal(state.performed.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(state.performed[0])), {do: [{action: "cleanupAttrViewBlocks", avID: "database", blockID: "carrier",
        data: {ruleVersion: "reviewed-rules", items: [{itemID: "unmatched", blockID: "block-unmatched"}]}}], undo: [{action: "cleanupAttrViewBlocks", avID: "database", blockID: "carrier",
        data: {ruleVersion: "reviewed-rules", items: [{itemID: "unmatched", blockID: "block-unmatched"}]}}]});
    assert.equal(state.elements.get("[data-cleanup]").disabled, true);
    assert.deepEqual(state.requests, [1, 1], "cleanup refreshes the review after the transaction queue settles");
});

test("collection review paginates without mutation and ignores confirmation after its dialog closes", async () => {
    const state = setup();
    await state.open();
    await state.listeners.get("[data-next]")();
    assert.equal(state.elements.get("[data-next]").disabled, true);
    await state.listeners.get("[data-prev]")();
    assert.deepEqual(state.requests, [1, 2, 1]);
    assert.equal(state.performed.length, 0);
    await state.listeners.get("[data-cleanup]")();
    state.root.isConnected = false;
    await state.confirmations[0].confirm();
    assert.equal(state.performed.length, 0);
});
