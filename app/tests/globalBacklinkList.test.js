const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const {test} = require("node:test");
const {runInNewContext} = require("node:vm");
const {ModuleKind, ScriptTarget, transpileModule} = require("typescript");

const compiled = transpileModule(readFileSync("src/layout/dock/GlobalBacklinkList.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

const setup = () => {
    const exports = {};
    const requests = [];
    let finishTransaction;
    const transaction = new Promise(resolve => { finishTransaction = resolve; });
    runInNewContext(compiled, {
        exports, console, AbortController,
        require: () => ({
            fetchSyncPost: (url, data) => new Promise(resolve => requests.push({url, data, resolve})),
            hasAVEditorSession: () => false,
            waitForPendingTransactions: () => transaction,
            unregisterViewFoldContext: () => {},
        }),
        document: {activeElement: null},
        window: {siyuan: {languages: {loading: "loading", retry: "retry"}}},
    });
    const list = Object.create(exports.GlobalBacklinkList.prototype);
    const applied = [];
    Object.assign(list, {
        generation: 1, query: {id: "target", sort: 1, containChildren: false}, snapshot: "snapshot",
        controller: new AbortController(), loading: false, destroyed: false,
        message: {classList: {toggle() {}, remove() {}}}, records: new Map(),
        options: {count: total => applied.push(total), editorRemoved: editor => applied.push(editor)},
        addPage: (...args) => applied.push(args), updateSpacers() {}, captureAnchor() {}, restoreAnchor() {}, onScroll() {},
    });
    return {list, requests, applied, finishTransaction};
};

test("late pages cannot replace a newer query", async () => {
    const {list, requests, applied} = setup();
    const pending = list.loadPage(50);
    list.generation++;
    requests[0].resolve({code: 0, data: {snapshot: "old", offset: 50, total: 100, items: []}});
    await pending;
    assert.equal(list.snapshot, "snapshot");
    assert.equal(applied.length, 0);
});

test("page requests retain the snapshot and page position", async () => {
    const {list, requests, applied} = setup();
    const pending = list.loadPage(100);
    assert.equal(requests[0].data.snapshot, "snapshot");
    assert.equal(requests[0].data.offset, 100);
    requests[0].resolve({code: 0, data: {snapshot: "snapshot", offset: 100, total: 121, items: []}});
    await pending;
    assert.equal(list.total, 121);
    assert.equal(applied[0], 121);
    assert.equal(list.loading, false);
});

test("editor recycling waits for transactions and preserves the measured height", async () => {
    const {list, finishTransaction} = setup();
    let destroyed = 0;
    const editor = {protyle: {}, destroy: () => destroyed++};
    const record = {editor, element: {contains: () => false, getBoundingClientRect: () => ({height: 280})}, body: {
        style: {}, getBoundingClientRect: () => ({height: 280}), replaceChildren() {},
    }, source: {classList: {remove() {}}, getBoundingClientRect: () => ({height: 28})}, item: {anchor: "A1"}};
    const pending = list.release(record);
    assert.equal(destroyed, 0);
    finishTransaction();
    await pending;
    assert.equal(destroyed, 1);
    assert.equal(record.body.style.minHeight, "252px");
    assert.equal(parseFloat(record.body.style.minHeight) + record.source.getBoundingClientRect().height, 280);
    assert.equal(record.editor, undefined);
});

test("returning focus while saving prevents editor recycling", async () => {
    const {list, finishTransaction} = setup();
    let focused = false;
    let destroyed = 0;
    const editor = {protyle: {}, destroy: () => destroyed++};
    const record = {editor, element: {contains: () => focused}};
    const pending = list.release(record);
    focused = true;
    finishTransaction();
    await pending;
    assert.equal(destroyed, 0);
    assert.equal(record.editor, editor);
});

test("composition starting while saving prevents editor recycling", async () => {
    const {list, finishTransaction} = setup();
    let destroyed = 0;
    const editor = {protyle: {}, destroy: () => destroyed++};
    const record = {editor, element: {contains: () => false}};
    const pending = list.release(record);
    list.composing = true;
    finishTransaction();
    await pending;
    assert.equal(destroyed, 0);
    assert.equal(record.editor, editor);
});

test("clearing the list while saving destroys each editor once", async () => {
    const {list, finishTransaction} = setup();
    let destroyed = 0;
    const editor = {protyle: {}, destroy: () => destroyed++};
    const record = {editor, element: {contains: () => false}};
    list.records.set("block", record);
    list.pages = new Map();
    list.element = {querySelectorAll: () => []};
    const pending = list.release(record);
    list.clearPages();
    finishTransaction();
    await pending;
    assert.equal(destroyed, 1);
    assert.equal(list.records.size, 0);
});

test("denied access clears content and invalidates other in-flight responses", async () => {
    const {list, requests, applied} = setup();
    let cleared = false;
    list.clearPages = () => { cleared = true; };
    list.top = {style: {}};
    list.bottom = {style: {}};
    const pending = list.loadPage(50);
    const signal = list.controller.signal;
    requests[0].resolve({code: 1, msg: "denied", data: null});
    await pending;
    assert.equal(cleared, true);
    assert.equal(signal.aborted, true);
    assert.equal(list.generation, 2);
    assert.equal(list.snapshot, "");
    assert.equal(list.loading, false);
    assert.deepEqual(applied, [0]);
    assert.equal(list.hasError, true);
});
