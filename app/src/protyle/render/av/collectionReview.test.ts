import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const compiled = transpileModule(readFileSync("src/protyle/render/av/collectionReview.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
}).outputText;
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

const setup = (unmatched = 1) => {
    const listeners = new Map<string, (event?: unknown) => void | Promise<void>>();
    const element = (selector: string, dataset: Record<string, string> = {}) => {
        let html = "";
        const label = {textContent: ""};
        return {
            disabled: false, textContent: "", dataset, value: "rule", options: [] as number[],
            get innerHTML() { return html; },
            set innerHTML(value: string) { html = value; this.options = [1]; },
            classList: {toggle() {}}, setAttribute() {}, hasAttribute: () => !!dataset.collectionStatus || !!dataset.collectionView,
            querySelector: () => label,
            addEventListener: (name: string, callback: (event?: unknown) => void | Promise<void>) => listeners.set(`${selector}:${name}`, callback),
        };
    };
    const elements = new Map<string, ReturnType<typeof element>>();
    for (const name of ["prev", "next", "cleanup", "collect", "results", "page", "rule-control", "status-tabs", "review-tip", "collection-rule"]) {
        elements.set(`[data-${name}]`, element(`[data-${name}]`));
    }
    const tabs = ["matched", "unmatched", "unknown"].map(value => element(value, {collectionStatus: value}));
    const views = ["rules", "entries"].map(value => element(value, {collectionView: value}));
    const root = {
        isConnected: true,
        querySelector: (selector: string) => elements.get(selector),
        querySelectorAll: (selector: string) => selector === "[data-collection-status]" ? tabs : [...tabs, ...views],
        addEventListener: (name: string, callback: (event?: unknown) => void) => listeners.set(`root:${name}`, callback),
    };
    const performed: {do: IOperation[], undo: IOperation[]}[] = [];
    const requests: {page: number, status?: string, ruleID?: string}[] = [];
    const confirmations: {confirm: () => Promise<void>, cancel: () => void}[] = [];
    let items = [
        {itemID: "matched", blockID: "block-matched", status: "matched", content: "Keep", hPath: "/Tasks", isDetached: false, reason: ""},
        ...Array.from({length: unmatched}, (_, i) => ({itemID: `unmatched-${i}`, blockID: `block-${i}`, status: "unmatched", content: "<unsafe>", hPath: "/Tasks", isDetached: false, reason: ""})),
        {itemID: "unknown", blockID: "", status: "unknown", content: "Detached", hPath: "", isDetached: true, reason: "detached"},
    ];
    const methods = {} as typeof import("./collectionReview");
    const languages = JSON.parse(readFileSync("appearance/langs/en.json", "utf8"));
    runInNewContext(compiled, {
        exports: methods, window: {siyuan: {languages}},
        require: (name: string) => ({
            "../../../dialog": {Dialog: class {element = root;}},
            "../../../dialog/confirmDialog": {confirmDialog: (_title: string, _text: string, confirm: () => Promise<void>, cancel: () => void) => confirmations.push({confirm, cancel})},
            "../../../util/functions": {isMobile: () => true},
            "../../../util/escape": {escapeAttr: String, escapeHtml: (value: string) => value.replace(/</g, "&lt;")},
            "../../util/transactionQueue": {waitForPendingTransactions: async () => {}},
            "../../../util/fetch": {fetchSyncPost: async (path: string, request: {page: number, status?: string, ruleID?: string}) => {
                if (path === "/api/av/getAttributeView") {
                    return {code: 0, data: {av: {automations: {rules: [{id: "rule", name: "Tasks", enabled: true, trigger: "block"}]}}}};
                }
                requests.push(request);
                if (path === "/api/av/previewAttributeViewCollection") {
                    return {code: 0, data: {hasMore: false, blocks: [
                        {id: "bound", content: "Bound", hPath: "/Tasks", collected: true},
                        {id: "new", content: "New", hPath: "/Tasks", collected: performed.length > 0},
                    ]}};
                }
                assert.equal(path, "/api/av/reviewAttributeViewCollection");
                const selected = items.filter(item => item.status === request.status);
                return {code: 0, data: {items: selected.slice((request.page - 1) * 100, request.page * 100), ruleVersion: "reviewed-rules",
                    hasMore: selected.length > request.page * 100, matched: 1, unknown: items.some(item => item.status === "unknown") ? 1 : 0,
                    unmatched: items.filter(item => item.status === "unmatched").length}};
            }},
            "../../wysiwyg/transaction": {transaction: (_protyle: IProtyle, operations: IOperation[], undo: IOperation[]) => {
                performed.push({do: operations, undo});
                const operation = operations[0];
                if (operation.action === "cleanupAttrViewBlocks") {
                    const ids = new Set(operation.data.items.map(item => item.itemID));
                    items = items.filter(item => !ids.has(item.itemID));
                } else if (operation.action === "removeAttrViewBlock") {
                    items = items.filter(item => !operation.srcIDs.includes(item.itemID));
                }
            }},
        })[name] || {},
    });
    const click = async (dataset: Record<string, string>) => {
        listeners.get("root:click")({target: {closest: () => ({dataset})}});
        await tick();
    };
    return {open: () => methods.openCollectionManager({} as IProtyle, "database", "carrier"), root, elements, listeners,
        performed, confirmations, requests, click, languages};
};

test("collection manager filters before paging, remembers category pages and confirms only this page's cleanup", async () => {
    const state = setup(101);
    await state.open();
    assert.equal(state.performed.length, 0);
    assert.ok(state.elements.get("[data-results]").innerHTML.includes("&lt;unsafe>"));
    await state.listeners.get("[data-next]:click")();
    await tick();
    assert.equal(state.elements.get("[data-page]").textContent, "2");
    await state.click({collectionStatus: "unknown"});
    assert.equal(state.elements.get("[data-page]").textContent, "1");
    await state.click({collectionStatus: "unmatched"});
    assert.equal(state.elements.get("[data-page]").textContent, "2");
    await state.listeners.get("[data-cleanup]:click")();
    await state.listeners.get("[data-cleanup]:click")();
    assert.equal(state.confirmations.length, 1);
    state.confirmations[0].cancel();
    assert.equal(state.performed.length, 0);
    await state.listeners.get("[data-cleanup]:click")();
    await state.confirmations[1].confirm();
    const operation = state.performed[0].do[0];
    assert.equal(operation.action, "cleanupAttrViewBlocks");
    if (operation.action !== "cleanupAttrViewBlocks") { return; }
    assert.equal(operation.data.items.length, 1);
    assert.equal(operation.data.items[0].itemID, "unmatched-100");
    assert.equal(operation.data.ruleVersion, "reviewed-rules");
    assert.equal(state.elements.get("[data-page]").textContent, "1", "an emptied last page is corrected");
    assert.deepEqual(state.requests.slice(-2).map(request => request.page), [2, 1]);
});

test("unknown entries display reasons and use ordinary undoable removal without rule cleanup", async () => {
    const state = setup();
    await state.open();
    await state.click({collectionStatus: "unknown"});
    assert.ok(state.elements.get("[data-results]").innerHTML.includes(state.languages.automationCollectionReasonDetached));
    await state.click({removeItem: "unknown"});
    await state.confirmations[0].confirm();
    assert.deepEqual(JSON.parse(JSON.stringify(state.performed[0])), {
        do: [{action: "removeAttrViewBlock", avID: "database", blockID: "carrier", srcIDs: ["unknown"]}],
        undo: [{action: "insertAttrViewBlock", avID: "database", blockID: "carrier",
            srcs: [{itemID: "unknown", id: "unknown", isDetached: true, content: "Detached"}]}],
    });
    await state.click({collectionStatus: "matched"});
    assert.doesNotMatch(state.elements.get("[data-results]").innerHTML, /data-remove-item/);
});

test("rule preview collects only displayed unbound matches and ignores repeated clicks", async () => {
    const state = setup();
    await state.open();
    await state.click({collectionView: "rules"});
    assert.equal(state.performed.length, 0);
    const pending = state.listeners.get("[data-collect]:click")();
    await state.listeners.get("[data-collect]:click")();
    await pending;
    assert.equal(state.performed.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(state.performed[0].do)), [{action: "collectAttrViewBlocks", avID: "database", blockID: "carrier",
        data: {ruleID: "rule", blockIDs: ["new"]}}]);
    assert.equal(state.elements.get("[data-collect]").disabled, true);
});

test("collection manager chooses unknown when no entries are unmatched and ignores closed confirmations", async () => {
    const state = setup(0);
    await state.open();
    assert.equal(state.requests.at(-1).status, "unknown");
    await state.click({removeItem: "unknown"});
    state.root.isConnected = false;
    await state.confirmations[0].confirm();
    assert.equal(state.performed.length, 0);
});
