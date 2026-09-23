import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import * as core from "./workspaceCore";

const compiled = transpileModule(readFileSync("src/window/workspace.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;
const prefix = "local-window-workspace-";
const id = "20260922100000-abcdefg";
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const layout = () => ({instance: "Layout", direction: "lr", children: [{instance: "Wnd", children: [{
    instance: "Tab", title: "Document", active: true, children: {
        instance: "Editor", blockId: "doc", rootId: "doc", notebookId: "box", scrollAttr: {rootId: "doc", scrollTop: 120},
    }}, {
        instance: "Tab", title: "PDF", children: {instance: "Asset", path: "assets/book.pdf", page: 4},
    }]}]});

const fixture = (initialStorage: Record<string, unknown> = {}, workspaceID = "") => {
    const storage = clone(initialStorage);
    const disk = clone(initialStorage);
    const state = {
        layout: layout(),
        fail: false,
        incomplete: false,
        focus: false,
        gate: undefined as Promise<void> | undefined,
    };
    let dialogOptions: any;
    let url = new URL(`http://127.0.0.1:6806/stage/build/app/window.html?windowWorkspace=${workspaceID}`);
    const writes: Array<{key: string, value: any}> = [];
    const messages: string[] = [];
    const opened: string[] = [];
    const associated: string[] = [];
    const dependencies = {
        ...core,
        Constants: {LOCAL_WINDOW_WORKSPACE: prefix, SIYUAN_APPID: "test", SIYUAN_GET: "get",
            WINDOW_WORKSPACE_SET: "setWindowWorkspace",
            WINDOW_WORKSPACE_FOCUS: "focusWindowWorkspace"},
        getSearch: (key: string) => url.searchParams.get(key),
        isBrowser: () => false,
        isWindow: () => true,
        setStorageVal: async (key: string, value: unknown, callback: () => void) => {
            writes.push({key, value: clone(value)});
            if (state.gate) {
                await state.gate;
            }
            if (!state.fail) {
                disk[key] = clone(value);
                callback();
            }
        },
        fetchSyncPost: async (_url: string, data: {keys: string[]}) => {
            data.keys.forEach(key => delete disk[key]);
            return {code: 0};
        },
        layoutToJSON: (_layout: unknown, target: object, incomplete: Record<string, string>) => {
            Object.assign(target, clone(state.layout));
            if (state.incomplete) {
                incomplete.editor = "true";
            }
        },
        setTabPosition: () => {},
        setWindowWorkspaceTitle: () => {},
        openInputDialog: (options: unknown) => dialogOptions = options,
        confirmDialog: (_title: string, _message: string, confirm: () => void) => confirm(),
        showMessage: (message: string) => messages.push(message),
        escapeHtml: (text: string) => text,
        openNewWindowByWorkspace: (workspace: string) => opened.push(workspace),
        ipcRenderer: {invoke: async (_channel: string, data: {cmd: string, id: string}) => {
            if (data.cmd === "setWindowWorkspace") {
                associated.push(data.id);
                return true;
            }
            return state.focus;
        }},
    };
    const api = {} as typeof import("./workspace");
    const window = {
        siyuan: {
            storage,
            config: {readonly: false},
            isPublish: false,
            layout: {layout: {}},
            languages: new Proxy<Record<string, unknown>>({windowWorkspaces: "New window layouts", confirm: "Confirm"}, {
                get: (target, key) => typeof key === "string" && key in target ? target[key] : String(key),
            }),
        },
        location: {href: url.href},
        history: {replaceState: (_state: unknown, _title: string, nextURL: URL) => url = nextURL},
        clearTimeout: () => {},
        dispatchEvent: () => {},
    };
    runInNewContext(compiled, {
        exports: api, require: () => dependencies, window, document: {getElementById: (): HTMLElement | null => null},
        console, URL, Event, Lute: {NewNodeID: () => id},
    });
    return {
        api, state, storage, disk, writes, messages, opened, associated, window,
        dialog: () => dialogOptions,
        boot: () => {
            const restored = api.getWindowWorkspaceLayout();
            api.activateWindowWorkspace();
            return restored;
        },
    };
};

const savedStorage = () => ({
    [prefix + id]: {version: 1, id, name: "Reading"},
    [prefix + id + "-layout"]: {version: 1, time: 1, layout: layout()},
});

test("保存命名窗口，重新加载后恢复文档、PDF 页码和阅读位置", async () => {
    const f = fixture();
    f.boot();
    f.api.editWindowWorkspace();
    await f.dialog().onConfirm(" Reading ", {destroy: () => {}});
    assert.equal((f.disk[prefix + id] as core.IWindowWorkspace).name, "Reading");
    assert.deepEqual(f.associated, [id]);
    const reopened = fixture(f.disk, id);
    assert.equal(reopened.api.getWindowWorkspaces()[0].time,
        (f.disk[prefix + id + "-layout"] as core.IWindowWorkspaceSnapshot).time);
    assert.deepEqual(clone(reopened.boot()), layout());
    await reopened.api.openWindowWorkspace(id);
    assert.deepEqual(reopened.opened, [id]);
    reopened.state.focus = true;
    await reopened.api.openWindowWorkspace(id);
    assert.deepEqual(reopened.opened, [id]);
});

test("自动保存布局不会覆盖其他窗口写入的工作区名称", async () => {
    const f = fixture(savedStorage(), id);
    f.boot();
    f.state.layout.children[0].children[0].children.scrollAttr.scrollTop = 480;
    let release: () => void;
    f.state.gate = new Promise<void>(resolve => release = resolve);
    const saved = f.api.flushWindowWorkspace();
    await tick();
    f.storage[prefix + id] = {version: 1, id, name: "Renamed"};
    f.disk[prefix + id] = clone(f.storage[prefix + id]);
    f.api.onWindowWorkspaceStorageChanged(prefix + id);
    release();
    assert.equal(await saved, true);
    assert.equal((f.disk[prefix + id] as core.IWindowWorkspace).name, "Renamed");
    assert.deepEqual(f.writes.map(item => item.key), [prefix + id + "-layout"]);
    assert.deepEqual(clone(fixture(f.disk, id).boot()), f.state.layout);
});

test("关闭前等待最新保存，状态回退到前一次内容时也不跳过在途请求", async () => {
    const f = fixture(savedStorage(), id);
    f.boot();
    f.state.layout.children[0].children[1].children.page = 8;
    let release: () => void;
    f.state.gate = new Promise<void>(resolve => release = resolve);
    const first = f.api.flushWindowWorkspace();
    await tick();
    f.state.layout = layout();
    const last = f.api.flushWindowWorkspace();
    release();
    assert.equal(await first, true);
    assert.equal(await last, true);
    assert.deepEqual(clone(fixture(f.disk, id).boot()), layout());
    assert.equal(f.writes.length, 2);
});

test("保存失败保留持久化快照并允许重试，加载未完成时不覆盖", async () => {
    const f = fixture(savedStorage(), id);
    f.boot();
    f.state.layout.children[0].children[1].children.page = 8;
    f.state.fail = true;
    assert.equal(await f.api.flushWindowWorkspace(), false);
    assert.deepEqual(f.disk, savedStorage());
    assert.deepEqual(f.storage, savedStorage());
    f.state.fail = false;
    f.state.incomplete = true;
    assert.equal(await f.api.flushWindowWorkspace(), false);
    assert.equal(f.writes.length, 1);
    f.state.incomplete = false;
    assert.equal(await f.api.flushWindowWorkspace(), true);
    assert.deepEqual(clone(fixture(f.disk, id).boot()), f.state.layout);
});

test("尚未发出请求时也以最后一次布局为准", async () => {
    const f = fixture(savedStorage(), id);
    f.boot();
    f.state.layout.children[0].children[1].children.page = 8;
    const first = f.api.flushWindowWorkspace();
    f.state.layout = layout();
    const last = f.api.flushWindowWorkspace();
    assert.equal(await first, true);
    assert.equal(await last, true);
    assert.deepEqual(clone(fixture(f.disk, id).boot()), layout());
});

test("移除工作区不会让在途自动保存重新创建列表项或留下布局", async () => {
    const f = fixture(savedStorage(), id);
    f.boot();
    f.state.layout.children[0].children[1].children.page = 8;
    let release: () => void;
    f.state.gate = new Promise<void>(resolve => release = resolve);
    const pending = f.api.flushWindowWorkspace();
    await tick();
    const tombstone = {version: 1, id, name: "Reading", deleted: true};
    f.storage[prefix + id] = tombstone;
    f.disk[prefix + id] = clone(tombstone);
    f.api.onWindowWorkspaceStorageChanged(prefix + id);
    release();
    await pending;
    await tick();
    assert.equal(f.api.getWindowWorkspaces().length, 0);
    assert.equal(prefix + id + "-layout" in f.disk, false);
    assert.deepEqual(f.associated, [""]);
    assert.equal(await f.api.flushWindowWorkspace(), true);
    assert.equal(f.writes.length, 1);
});

test("未知快照和只读状态不触发写入", async () => {
    const storage = savedStorage();
    storage[prefix + id + "-layout"].version = 2;
    const f = fixture(storage, id);
    assert.equal(f.boot(), undefined);
    assert.equal(await f.api.flushWindowWorkspace(), true);
    assert.deepEqual(f.disk, storage);
    assert.equal(f.writes.length, 0);
    assert.deepEqual(f.messages, ["windowWorkspaceUnavailable"]);
    const readonly = fixture(savedStorage(), id);
    readonly.boot();
    readonly.window.siyuan.config.readonly = true;
    readonly.state.layout.children[0].children[1].children.page = 8;
    assert.equal(await readonly.api.flushWindowWorkspace(), true);
    assert.equal(readonly.writes.length, 0);
});

test("新窗口布局重命名弹窗只提交名称，使用对应标题及确定按钮且无命名标签", async () => {
    const f = fixture(savedStorage(), id);
    f.boot();
    f.api.editWindowWorkspace(id);
    assert.equal(f.dialog().title, "New window layouts");
    assert.equal(f.dialog().label, undefined);
    assert.equal(f.dialog().confirmText, "Confirm");
    assert.equal(f.dialog().actions, undefined);
    assert.equal(f.dialog().description, undefined);
    await f.dialog().onConfirm("Renamed", {destroy: () => {}});
    assert.equal((f.disk[prefix + id] as core.IWindowWorkspace).name, "Renamed");
    assert.deepEqual(f.disk[prefix + id + "-layout"], savedStorage()[prefix + id + "-layout"]);
});
