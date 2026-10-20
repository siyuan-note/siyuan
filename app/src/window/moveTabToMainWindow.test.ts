import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const compiled = transpileModule(readFileSync("src/window/moveTabToMainWindow.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

const setup = (detached = false) => {
    const sent: Array<[string, any]> = [];
    const loaded: Array<() => void> = [];
    const restored: any[] = [];
    const calls: string[] = [];
    class Editor {
        editor = {flushPendingTransactions: async () => { calls.push("flush"); }};
    }
    class Tab {
        id = "target";
        title = "Title";
        model: any;
        parent: any;
        classes = new Set<string>();
        headElement = {
            classList: {remove: (name: string) => this.classes.delete(name), add: (name: string) => this.classes.add(name)},
            getAttribute: () => "",
            querySelector: () => ({classList: {add: (name: string) => this.classes.add(`text:${name}`)}}),
        };
        constructor(options?: {title?: string}) { this.title = options?.title || this.title; }
        addModel(model: any) { this.model = model; }
    }
    const first = new Tab();
    const second = new Tab();
    const wnd = {
        children: [first, second],
        active: first,
        addTab(tab: Tab) {
            this.children.splice(this.children.indexOf(this.active) + 1, 0, tab);
            tab.parent = this;
            calls.push("add");
        },
        switchTab(head: unknown) { assert.ok(head); calls.push("switch"); },
        removeTab(id: string) { this.children = this.children.filter((tab: Tab) => tab.id !== id); },
    };
    const data = {id: "source", title: "Title", children: {instance: "Editor", blockId: "block", rootId: "root",
        notebookId: "encrypted", mode: "preview", action: "cb-get-scroll", scrollAttr: {scrollTop: 121}}};
    let response = {code: 0, msg: "", data: {rootTitle: "Title", rootID: "root", box: "encrypted"}};
    const api: any = {};
    const deps = {
        Editor, Tab, isWindow: () => detached,
        Constants: {SIYUAN_SEND_WINDOWS: "windows", SIYUAN_CMD: "command"},
        layoutToJSON: (_tab: Tab, result: any) => { calls.push("serialize"); Object.assign(result, data); },
        getWndByLayout: () => wnd,
        newModelByInitData: (_app: unknown, _tab: Tab, editor: unknown, after: () => void) => {
            restored.push(editor); loaded.push(after); return new Editor();
        },
        fetchSyncPost: async () => response,
        showMessage: () => calls.push("message"),
        ipcRenderer: {send: (channel: string, message: unknown) => sent.push([channel, message])},
    };
    runInNewContext(compiled, {exports: api, require: () => deps,
        window: {siyuan: {layout: {centerLayout: {}}, ws: {app: {}}}}});
    const source = new Tab();
    source.id = "source";
    source.parent = {children: [source]};
    source.model = new Editor();
    return {api, source, data, wnd, first, second, calls, loaded, sent, restored,
        setResponse: (code: number) => { response = {...response, code, msg: "Unavailable"}; }};
};

test("moving a document flushes input before serializing and waits for the target acknowledgment", async () => {
    const f = setup(true);
    let finish: () => void;
    f.source.model.editor.flushPendingTransactions = () => new Promise<void>(resolve => { finish = resolve; });
    const moving = f.api.moveTabToMainWindow(f.source);
    await f.api.moveTabToMainWindow(f.source);
    assert.equal(f.sent.length, 0);
    finish();
    await moving;
    assert.deepEqual(f.calls, ["serialize"]);
    assert.equal(f.sent.length, 1);
    assert.equal(f.sent[0][1].cmd, "moveTabToMainWindow");
    assert.deepEqual(JSON.parse(JSON.stringify(f.sent[0][1].data)), f.data);
    assert.equal(f.source.parent.children.length, 1);
    f.source.model.editor.flushPendingTransactions = async () => { throw new Error("save failed"); };
    await assert.rejects(f.api.moveTabToMainWindow(f.source), /save failed/);
    assert.equal(f.sent.length, 1);
});

test("only detached document tabs expose the move action, including uninitialized tabs", () => {
    const f = setup(true);
    assert.equal(f.api.canMoveTabToMainWindow(f.source), true);
    f.source.model = undefined;
    f.source.headElement.getAttribute = () => '{"instance":"Editor"}';
    assert.equal(f.api.canMoveTabToMainWindow(f.source), true);
    f.source.headElement.getAttribute = () => '{"instance":"Asset"}';
    assert.equal(f.api.canMoveTabToMainWindow(f.source), false);
    assert.equal(setup().api.canMoveTabToMainWindow(f.source), false);
});

test("the main window restores document state beside its active tab and closes the source only after loading", async () => {
    const f = setup();
    await f.api.receiveTabInMainWindow(f.data);
    await f.api.receiveTabInMainWindow(f.data);
    assert.equal(f.wnd.children.length, 3);
    assert.equal(f.wnd.children[0], f.first);
    assert.equal(f.wnd.children[2], f.second);
    assert.deepEqual(JSON.parse(JSON.stringify(f.restored)), [f.data.children]);
    assert.equal(f.sent.length, 0);
    f.loaded[0]();
    assert.deepEqual(f.calls, ["add", "switch"]);
    assert.deepEqual(JSON.parse(JSON.stringify(f.sent)), [
        ["windows", {cmd: "closetab", data: "source"}], ["command", "focus"],
    ]);
});

test("empty main windows accept the document and failed access or detached receivers preserve the source", async () => {
    const empty = setup();
    empty.wnd.children = [];
    await empty.api.receiveTabInMainWindow(empty.data);
    assert.equal(empty.wnd.children.length, 1);
    empty.loaded[0]();
    assert.equal(empty.sent.length, 2);
    for (const code of [-1, 3]) {
        const denied = setup();
        denied.setResponse(code);
        await denied.api.receiveTabInMainWindow(denied.data);
        assert.equal(denied.wnd.children.length, 2);
        assert.equal(denied.sent.length, 0);
    }
    const detached = setup(true);
    await detached.api.receiveTabInMainWindow(detached.data);
    assert.equal(detached.sent.length, 0);
    assert.equal(detached.wnd.children.length, 2);
});

test("closing the destination during loading retains the source and permits retrying the move", async () => {
    const f = setup();
    await f.api.receiveTabInMainWindow(f.data);
    f.wnd.children.splice(1, 1);
    f.loaded[0]();
    assert.equal(f.sent.length, 0);
    await f.api.receiveTabInMainWindow(f.data);
    assert.equal(f.loaded.length, 2);
});

test("moving a pinned document preserves its pin and icon presentation", async () => {
    const f = setup();
    await f.api.receiveTabInMainWindow({...f.data, pin: true, docIcon: "1f4d2"});
    assert.ok(f.wnd.children[1].classes.has("item--pin"));
    assert.ok(f.wnd.children[1].classes.has("text:fn__none"));
});
