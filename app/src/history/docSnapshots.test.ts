import {it} from "node:test";
import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {ScriptTarget, transpileModule} from "typescript";
import {escapeAttr, escapeHtml} from "../util/escape";

const setup = (notebook = "") => {
    const source = readFileSync(join(__dirname, "docSnapshots.ts"), "utf8");
    const code = source.slice(source.indexOf("const views =")).replace(/export /g, "");
    const panel = {innerHTML: "", textContent: "", classList: {toggle() {}, add() {}}, setAttribute() {}, querySelector: (): HTMLElement | null => null};
    const summary = {innerHTML: "", dataset: {historyTags: "1"}};
    const listeners: Record<string, (event: unknown) => void> = {};
    const element = {
        isConnected: true,
        querySelector: () => ({before() {}}),
        querySelectorAll: () => [summary],
        addEventListener: (name: string, cb: (event: unknown) => void) => { listeners[name] = cb; },
        contains: () => true,
    };
    const pending: ((response: unknown) => void)[] = [];
    const signals: AbortSignal[] = [];
    const opened: unknown[] = [];
    const notebooks: string[] = [];
    const dependencies = {
        document: {createElement: () => panel},
        window: {siyuan: {languages: {loading: "loading", historySnapshots: "snapshots", historySnapshotsError: "failed", retry: "retry"}}},
        fetchSyncPost: (_url: string, _body: unknown, _headers: unknown, _process: boolean, signal: AbortSignal) => {
            signals.push(signal);
            return new Promise(resolve => pending.push(resolve));
        },
        openSnapshotDetail: (_app: unknown, snapshot: unknown, notebook: string) => { opened.push(snapshot); notebooks.push(notebook); },
        escapeAttr, escapeHtml, dayjs: () => ({format: () => "date"}),
    };
    const View = new Function(...Object.keys(dependencies), transpileModule(code, {
        compilerOptions: {target: ScriptTarget.ES2021},
    }).outputText + "\nreturn DocHistorySnapshots;")(...Object.values(dependencies));
    return {view: new View({}, element, "doc", notebook), panel, summary, pending, signals, opened, notebooks, listeners, element};
};

const snapshot = (id: string) => ({id, fileID: "file", tags: ["<tag>"], memo: "<script>alert(1)</script>\nline", created: 1});
const response = (ids: string[]) => ({code: 0, data: {histories: [{created: "1", historyPath: "history/path", snapshots: ids.map(snapshot)}]}});

it("renders repository version associations without querying file history and retains notebook context", () => {
    const {view, panel, summary, pending, opened, notebooks, listeners} = setup("notebook");
    view.setEntries([{created: "1", historyPath: "", snapshots: [snapshot("first"), snapshot("second")]}]);
    view.select("1");
    assert.equal(pending.length, 0);
    assert.match(summary.innerHTML, /\+1/);
    assert.match(panel.innerHTML, /snapshots \(2\)/);
    listeners.click({target: {closest: () => ({hasAttribute: () => false, dataset: {historyCreated: "1", historySnapshot: "second"}})}, stopPropagation() {}});
    assert.deepEqual(opened, [snapshot("second")]);
    assert.deepEqual(notebooks, ["notebook"]);
    view.reset();
    view.setEntries([{created: "1", historyPath: "", snapshots: []}]);
    assert.equal(summary.innerHTML, "");
});

it("keeps all matching snapshots, escapes notes and opens the clicked snapshot", async () => {
    const {view, panel, summary, pending, opened, listeners} = setup();
    const loading = view.load(["1"], "all");
    view.select("1");
    pending[0](response(["first", "second"]));
    await loading;
    assert.match(summary.innerHTML, /\+1/);
    assert.match(panel.innerHTML, /snapshots \(2\)/);
    assert.match(panel.innerHTML, /&lt;script>/);
    assert.ok(!panel.innerHTML.includes("<script>"));
    assert.match(panel.innerHTML, /data-history-snapshot="second"/);
    let stopped = false;
    listeners.click({target: {closest: () => ({hasAttribute: () => false, dataset: {historyCreated: "1", historySnapshot: "second"}})}, stopPropagation: () => { stopped = true; }});
    assert.deepEqual(opened, [snapshot("second")]);
    assert.ok(stopped);
});

it("discards an earlier page response and cancels work when the dialog closes", async () => {
    const {view, pending, signals, summary} = setup();
    const old = view.load(["1"], "all");
    view.reset();
    const current = view.load(["1"], "update");
    pending[1](response(["current"]));
    await current;
    pending[0](response(["stale"]));
    await old;
    assert.match(summary.innerHTML, /current/);
    assert.ok(!summary.innerHTML.includes("stale"));
    assert.ok(signals[0].aborted);
    view.destroy();
    assert.ok(signals[1].aborted);
});

it("distinguishes failed queries from an empty successful match", async () => {
    const {view, pending, panel, summary} = setup();
    view.select("1");
    const failed = view.load(["1"], "all");
    pending[0]({code: -1, msg: "corrupt"});
    await failed;
    assert.match(panel.innerHTML, /failed/);
    assert.match(summary.innerHTML, /data-history-retry/);
    const retried = view.load(["1"], "all");
    pending[1](response([]));
    await retried;
    assert.equal(summary.innerHTML, "");
    assert.ok(!panel.innerHTML.includes("failed"));
});
