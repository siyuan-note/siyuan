import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {createSourceFile, isVariableStatement, ScriptTarget, transpileModule} from "typescript";
import type {Node} from "typescript";

const source = readFileSync("src/history/history.ts", "utf8");
const parsed = createSourceFile("history.ts", source, ScriptTarget.Latest, true);
const extract = (name: string) => {
    let result: string;
    const visit = (node: Node) => {
        if (isVariableStatement(node) && node.declarationList.declarations.some(item => item.name.getText(parsed) === name)) {
            result = node.getText(parsed);
            return;
        }
        node.forEachChild(visit);
    };
    visit(parsed);
    assert.ok(result);
    return transpileModule(result, {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;
};

test("file history displays zero histories for an empty search", () => {
    const count = {textContent: "old count", classList: {remove() {}}};
    const node = () => ({value: "0", textContent: "", classList: {add() {}, remove() {}}, setAttribute() {}, removeAttribute() {}, querySelector: node});
    const next = {...node(), nextElementSibling: {nextElementSibling: count}};
    const list = {...node(), innerHTML: "old results"};
    const element = {
        isConnected: true,
        setAttribute() {},
        querySelector: (selector: string) => selector === '[data-type="docnext"]' ? next : selector === ".b3-list" ? list : node(),
    };
    const dependencies = {
        window: {siyuan: {storage: {history: {}}, languages: {pageCountAndHistoryCount: "${x} pages, ${y} histories", emptyContent: "empty"}}},
        Constants: {LOCAL_HISTORY: "history"},
        historyGroups: new WeakMap(), historyRequests: new WeakMap(),
        setStorageVal() {},
        fetchPost: (_url: string, _request: unknown, callback: (response: unknown) => void) =>
            callback({data: {pageCount: 0, totalCount: 0, histories: []}}),
    };
    const render = new Function(...Object.keys(dependencies), extract("renderDoc") + "\nreturn renderDoc;")(...Object.values(dependencies));
    render(element, 1);
    assert.equal(count.textContent, "0 pages, 0 histories");
    assert.match(list.innerHTML, /empty/);
});

test("file history ignores older search results after filters change", () => {
    const node = (): any => ({value: "0", classList: {add() {}, remove() {}}, setAttribute() {}, removeAttribute() {}, querySelector: node});
    const count = {textContent: "", classList: {remove() {}}};
    const next = {...node(), nextElementSibling: {nextElementSibling: count}};
    const list = {...node(), innerHTML: ""};
    const element = {
        isConnected: true, setAttribute() {},
        querySelector: (selector: string) => selector === '[data-type="docnext"]' ? next : selector === ".b3-list" ? list : node(),
    };
    const responses: ((response: unknown) => void)[] = [];
    const dependencies = {
        window: {siyuan: {storage: {history: {}}, languages: {pageCountAndHistoryCount: "${x}/${y}", emptyContent: "empty"}}},
        Constants: {LOCAL_HISTORY: "history"}, historyGroups: new WeakMap(), historyRequests: new WeakMap(),
        setStorageVal() {},
        fetchPost: (_url: string, _request: unknown, callback: (response: unknown) => void) => responses.push(callback),
    };
    const render = new Function(...Object.keys(dependencies), extract("renderDoc") + "\nreturn renderDoc;")(...Object.values(dependencies));
    render(element, 1);
    render(element, 1);
    responses[1]({data: {pageCount: 0, totalCount: 0, histories: []}});
    responses[0]({data: {pageCount: 1, totalCount: 100, histories: ["123"]}});
    assert.equal(count.textContent, "0/0");
    assert.match(list.innerHTML, /empty/);
});

test("notebook recovery renders a native button in a visible history row", () => {
    const element = {innerHTML: "", setAttribute() {}};
    const dependencies = {
        window: {siyuan: {languages: {rollback: "Rollback"}}},
        escapeHtml: (text: string) => text,
        fetchPost: (_url: string, _request: unknown, callback: (response: unknown) => void) =>
            callback({data: {histories: [{hCreated: "now", items: [{path: "history/notebook", title: "Notebook"}]}]}}),
    };
    const render = new Function(...Object.keys(dependencies), extract("renderRmNotebook") + "\nreturn renderRmNotebook;")(...Object.values(dependencies));
    render(element);
    assert.match(element.innerHTML, /<button type="button"[^>]*data-type="rollback"[^>]*aria-label="Rollback">/);
    assert.doesNotMatch(element.innerHTML, /b3-list-item--hide-action/);
});

test("snapshot creation sends full checks, closes completed checks and retains unchanged normal drafts", async () => {
    for (const fullCheck of [false, true]) {
        for (const created of [false, true]) {
            let options: {description?: string, onConfirm: (value: string, dialog: unknown) => Promise<void>};
            const button = {disabled: false};
            const textarea = {readOnly: false};
            let closed = 0;
            const refreshed: number[] = [];
            const requests: {path: string, body: unknown}[] = [];
            const dialog = {
                element: {setAttribute() {}, querySelector: (selector: string) => selector === "textarea" ? textarea : button},
                destroy: () => closed++,
            };
            const dependencies = {
                window: {siyuan: {languages: {snapshotMemo: "Memo", fullCheckSnapshotTip: "Read all local files"}}},
                Constants: {DIALOG_SNAPSHOTMEMO: "snapshot-memo"},
                isMobile: () => false,
                mobileInputDialog: (value: typeof options) => { options = value; return dialog; },
                renderRepo: (_element: unknown, page: number) => refreshed.push(page),
                fetchPost: async (path: string, body: unknown, callback: (response: unknown) => void) => {
                    requests.push({path, body});
                    assert.equal(button.disabled, true);
                    assert.equal(textarea.readOnly, true);
                    callback({data: {created}});
                },
            };
            const open = new Function(...Object.keys(dependencies), extract("openSnapshotMemo") + "\nreturn openSnapshotMemo;")(...Object.values(dependencies));
            open({}, undefined, "", fullCheck);
            assert.equal(options.description, fullCheck ? "Read all local files" : undefined);
            await options.onConfirm("memo", dialog);
            assert.deepEqual(requests, [{path: "/api/repo/createSnapshot", body: {memo: "memo", fullCheck}}]);
            assert.equal(closed, created || fullCheck ? 1 : 0);
            assert.deepEqual(refreshed, created ? [1] : []);
            assert.equal(button.disabled, false);
            assert.equal(textarea.readOnly, false);
        }
    }
});

test("a failed full snapshot check retains the memo and releases the busy controls", async () => {
    let options: {onConfirm: (value: string, dialog: unknown) => Promise<void>};
    const button = {disabled: false};
    const textarea = {readOnly: false};
    const dialog = {
        element: {setAttribute() {}, querySelector: (selector: string) => selector === "textarea" ? textarea : button},
        destroy: () => assert.fail("failed check closed the dialog"),
    };
    const dependencies = {
        window: {siyuan: {languages: {}}}, Constants: {},
        isMobile: () => false,
                mobileInputDialog: (value: typeof options) => { options = value; return dialog; },
        fetchPost: async () => { throw new Error("read failed"); },
    };
    const open = new Function(...Object.keys(dependencies), extract("openSnapshotMemo") + "\nreturn openSnapshotMemo;")(...Object.values(dependencies));
    open({}, undefined, "memo", true);
    await assert.rejects(options.onConfirm("memo", dialog), /read failed/);
    assert.equal(button.disabled, false);
    assert.equal(textarea.readOnly, false);
});

test("mobile snapshot memo only reports success after the API accepts the save", async () => {
    let options: {awaitConfirm: boolean, onConfirm: (value: string, dialog: unknown) => Promise<boolean>};
    const dialog = {element: {setAttribute() {}}, destroy: () => assert.fail("the wrapper owns closing")};
    let code = 1;
    let created = false;
    let refreshed = 0;
    const dependencies = {
        window: {siyuan: {languages: {}}}, Constants: {}, isMobile: () => true,
        mobileInputDialog: (value: typeof options) => { options = value; return dialog; },
        fetchSyncPost: async () => ({code, data: {created}}),
        renderRepo: () => refreshed++,
    };
    const open = new Function(...Object.keys(dependencies), extract("openSnapshotMemo") + "\nreturn openSnapshotMemo;")(...Object.values(dependencies));
    open({}, undefined, "memo", false);
    assert.equal(options.awaitConfirm, true);
    assert.equal(await options.onConfirm("memo", dialog), false);
    code = 0;
    assert.equal(await options.onConfirm("memo", dialog), false);
    created = true;
    assert.equal(await options.onConfirm("memo", dialog), true);
    assert.equal(refreshed, 1);
});
