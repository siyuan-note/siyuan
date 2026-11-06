import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

test("parent selection waits for its original transaction and invalidates a departing owner", async () => {
    const listeners = new Map<string, (event: unknown) => void>();
    let task: () => Promise<boolean>;
    let complete: () => void;
    let fail: (error: Error) => void;
    let observe: () => void;
    let requests = 0;
    let destroyed = 0;
    let invalidated = 0;
    const field = (selector: string) => ({value: "alpha", innerHTML: "", disabled: false,
        classList: {toggle() {}}, addEventListener: (name: string, callback: (event: unknown) => void) => {
            listeners.set(selector + ":" + name, callback);
        }});
    const controls = new Map(["input", "[data-results]", "[data-more]"].map(name => [name, field(name)]));
    const block = {isConnected: true, dataset: {avId: "database", nodeId: "carrier"},
        getAttribute: () => "view", hasAttribute: () => true};
    class Dialog {
        element = {isConnected: true, querySelector: (name: string) => controls.get(name)};
        runPending(callback: () => Promise<boolean>) { task = callback; return Promise.resolve(false); }
        destroy() { destroyed++; }
        invalidate() { invalidated++; }
    }
    const exports = {} as typeof import("./subItems");
    const dependencies = {
        MobileDialog: Dialog, Constants: {CUSTOM_SY_AV_VIEW: "view"},
        isMobile: () => true, escapeAttr: String, escapeHtml: String,
        getAVData: () => ({subItems: {enabled: true, parentKeyID: "parent-column"}}),
        beginAVEditorSession: () => () => {}, registerSubItemsCleanup: () => () => {},
        getAVFilteredTipContext: () => ({}),
        fetchSyncPost: async () => ({code: 0, data: {rows: [] as unknown[], total: 0}}),
        transaction: (_protyle: unknown, operations: IOperation[], _undo: IOperation[], options: {awaitResponse: boolean}) => {
            assert.equal(options.awaitResponse, true);
            assert.equal(operations[0].action, "reparentAttrViewItems");
            assert.equal(operations[0].parentID, "parent");
            assert.equal(operations[0].srcIDs[0], "child");
            requests++;
            return new Promise<void>((resolve, reject) => { complete = resolve; fail = reject; });
        },
    };
    runInNewContext(transpileModule(readFileSync("src/protyle/render/av/subItems.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
    }).outputText, {exports, require: () => dependencies, AbortController,
        MutationObserver: class {constructor(callback: () => void) { observe = callback; } observe() {} disconnect() {}},
        window: {siyuan: {languages: {}}},
    });
    const items: IMenu[] = [];
    exports.addSubItemsMenu({addItem: (item: IMenu) => items.push(item)} as unknown as import("../../../plugin/Menu").Menu,
        {options: {}, element: {}} as IProtyle, block as unknown as HTMLElement, ["child"], "group");
    items.find(item => item.id === "avChangeParent").click(undefined, undefined);
    await new Promise(resolve => setImmediate(resolve));
    listeners.get("[data-results]:click")({target: {closest: () => ({dataset: {parent: "parent"}})}});
    assert.equal(requests, 0, "selection uses the shared pending lifecycle");
    const saving = task();
    const rejected = assert.rejects(saving, /failed/);
    fail(new Error("failed"));
    await rejected;
    assert.equal(destroyed, 0);
    const retry = task();
    complete();
    assert.equal(await retry, true);
    assert.equal(requests, 2);
    block.isConnected = false;
    observe();
    assert.equal(invalidated, 1);
});
