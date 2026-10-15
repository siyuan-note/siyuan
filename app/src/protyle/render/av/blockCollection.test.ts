import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const compiled = transpileModule(readFileSync("src/protyle/render/av/blockCollection.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
}).outputText;

test("collection scope requires a notebook or document and complete attribute names", () => {
    const methods = {} as typeof import("./blockCollection");
    runInNewContext(compiled, {exports: methods, require: () => ({})});
    assert.equal(methods.collectionSourceIncomplete({}), true);
    assert.equal(methods.collectionSourceIncomplete({documentIDs: ["doc"]}), false);
    assert.equal(methods.collectionSourceIncomplete({notebookIDs: ["notebook"], attributes: [{name: "custom-", operator: "exists"}]}), true);
    assert.equal(methods.collectionSourceIncomplete({documentIDs: ["doc"], attributes: [{name: "custom-state", operator: "equals", value: "open"}]}), false);
});

test("collection preview is read-only and explicit collection uses only unbound previewed IDs", async () => {
    const listeners = new Map<string, () => Promise<void>>();
    const elements = new Map<string, {disabled: boolean, innerHTML: string, addEventListener: (name: string, callback: () => Promise<void>) => void}>();
    ["[data-prev]", "[data-next]", "[data-collect]", "[data-results]"].forEach(selector => elements.set(selector, {
        disabled: false, innerHTML: "", addEventListener: (_name, callback) => listeners.set(selector, callback),
    }));
    const performed: IOperation[] = [];
    let fetches = 0;
    let waits = 0;
    const methods = {} as typeof import("./blockCollection");
    runInNewContext(compiled, {
        exports: methods,
        window: {siyuan: {languages: {automationCollectionCollected: "Collected"}}},
        require: (name: string) => ({
            "../../../dialog": {Dialog: class {element = {isConnected: true, querySelector: (selector: string) => elements.get(selector)};}},
            "../../../util/functions": {isMobile: () => true},
            "../../../util/escape": {escapeAttr: String, escapeHtml: String},
            "../../util/transactionQueue": {waitForPendingTransactions: async () => { waits++; }},
            "../../../util/fetch": {fetchSyncPost: async (path: string, request: {avID: string, ruleID: string, page: number}) => {
                assert.equal(path, "/api/av/previewAttributeViewCollection");
                assert.deepEqual(JSON.parse(JSON.stringify(request)), {avID: "database", ruleID: "rule", page: 1});
                fetches++;
                return {code: 0, data: {hasMore: true, blocks: [
                    {id: "manual", content: "Manual", hPath: "/Notes", collected: true},
                    {id: "new", content: "New", hPath: "/Notes", collected: performed.length > 0},
                ]}};
            }},
            "../../wysiwyg/transaction": {transaction: (_protyle: IProtyle, operations: IOperation[], inverse: IOperation[]) => {
                assert.equal(inverse.length, 1);
                performed.push(...operations);
            }},
        })[name] || {},
    });
    await methods.openBlockCollectionPreview({} as IProtyle, "database", "carrier", "rule");
    assert.equal(performed.length, 0);
    assert.equal(fetches, 1);
    assert.equal(elements.get("[data-prev]").disabled, true);
    assert.equal(elements.get("[data-next]").disabled, false);
    assert.match(elements.get("[data-results]").innerHTML, /Manual/);
    const first = listeners.get("[data-collect]")();
    await listeners.get("[data-collect]")();
    await first;
    assert.equal(performed.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(performed[0])), {action: "collectAttrViewBlocks", avID: "database", blockID: "carrier", data: {ruleID: "rule", blockIDs: ["new"]}});
    assert.equal(fetches, 2);
    assert.equal(waits, 2);
    assert.equal(elements.get("[data-collect]").disabled, true);
});
