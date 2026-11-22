import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import type {IWindowGeometry} from "../window/geometry";

const tick = () => new Promise<void>(resolve => setImmediate(resolve));

const compiled = transpileModule(readFileSync("src/menus/layouts.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;
const compiledUtil = transpileModule(readFileSync("src/layout/util.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;
const compiledIconRefresh = transpileModule(readFileSync("src/layout/documentIcons.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

const fixture = (geometryAvailable = true) => {
    const layouts = [{name: "Reading", time: 1, layout: {hideDock: true} as Config.IUiLayout, filesPaths: ["saved-path"],
        windowGeometry: undefined as IWindowGeometry | undefined}];
    const geometry: IWindowGeometry = {version: 1, x: 80, y: 100, width: 1100, height: 800, maximized: true, fullscreen: false};
    const calls: Array<{action: string, value?: unknown}> = [];
    const util = {} as typeof import("../layout/util");
    class Layout {
        direction = "lr";
        children: unknown[] = [];
    }
    let dialog: any;
    const fetchSyncPost: (url: string, value: {ids: string[]}) => Promise<{
        code: number; data: Record<string, Record<string, string> | null> | null;
    }> = async () => ({code: 0, data: {}});
    const dependencies = {
        syncMarkdownKeymap: () => {},
        clearReloadSnapshot: () => {},
        Layout,
        Constants: {LOCAL_LAYOUTS: "layouts", LOCAL_FILESPATHS: "paths",
            SIYUAN_WINDOW_WORKSPACE_GET_OPEN: "siyuan-window-workspace-get-open"},
        setStorageVal: async (key: string, value: unknown, callback?: () => void) => {
            calls.push({action: key, value: JSON.parse(JSON.stringify(value))});
            callback?.();
        },
        fetchPost: async (url: string, value: unknown, callback?: () => void) => {
            calls.push({action: url, value});
            callback?.();
        },
        fetchSyncPost,
        isSensitiveLayoutData: (data: {notebookId?: string}) => data.notebookId === "encrypted",
        saveUILayout: (layout: unknown, errorExit?: boolean, callback?: () => void) =>
            dependencies.fetchPost("/api/system/setUILayout", {layout, ...(errorExit === undefined ? {} : {errorExit})}, callback),
        getAllLayout: () => ({hideDock: false}),
        suspendLayoutSaving: () => util.suspendLayoutSaving(),
        isWindow: () => false,
        getSettingsWindowHost: (): undefined => undefined,
        getAllEditor: (): unknown[] => [],
        withFetchTimeout: async (callback: () => Promise<void>) => callback(),
        captureWindowGeometry: async () => geometryAvailable ? geometry : undefined,
        restoreWindowGeometry: async (value?: IWindowGeometry) => {
            if (value) {
                calls.push({action: "geometry", value});
            }
        },
        openInputDialog: (options: unknown) => {
            dialog = options;
            return {element: {setAttribute: () => {}}};
        },
        showMessage: (value: string) => calls.push({action: "message", value}),
        escapeHtml: (value: string) => value.replace(/</g, "&lt;").replace(/>/g, "&gt;"),
        editWindowWorkspace: (value: string) => calls.push({action: "rename", value}),
        openWindowWorkspace: (value: string) => calls.push({action: "open", value}),
        removeWindowWorkspace: (value: string) => calls.push({action: "delete", value}),
    };
    const dock = {elements: [{querySelectorAll: (): unknown[] => []}, {querySelectorAll: (): unknown[] => []}]};
    const window = {clearTimeout, setTimeout, siyuan: {
        layout: {layout: new Layout(), bottomDock: dock, leftDock: dock, rightDock: dock},
        config: {readonly: false},
        storage: {layouts, paths: ["current-path"]},
        languages: {openBy: "Open", windowWorkspaceSwitch: "Switch", use: "Use", update: "Update", rename: "Rename",
            delete: "Delete", confirm: "Confirm", mainWindowLayouts: "Main window layouts", _kernel: {142: "Empty"}},
    }, location: {reload: () => calls.push({action: "reload"})}};
    runInNewContext(compiledUtil, {exports: util, require: () => dependencies, window,
        document: {querySelector: () => ({getAttribute: () => "#iconDock"})}});
    const api = {} as typeof import("./layouts");
    const iconRefresh = {};
    runInNewContext(compiledIconRefresh, {exports: iconRefresh, require: () => dependencies});
    runInNewContext(compiled, {exports: api, structuredClone, window,
        require: (name: string) => name === "../layout/documentIcons" ? iconRefresh : dependencies});
    return {api, util, dependencies, window, calls, geometry, dialog: () => dialog};
};

test("主窗口布局更多菜单按使用、更新、重命名、删除排列", () => {
    const {api} = fixture();
    const actions = api.getLayoutActions({type: "main", name: "Reading"});
    assert.deepEqual(Array.from(actions, action => action.id), ["open", "update", "rename", "delete"]);
    assert.equal(actions[0].label, "Use");
    assert.equal(actions[0].icon, "iconReplace");
    assert.equal(actions[1].label, "Update");
});

test("新窗口布局不提供更新，已打开时显示切换", () => {
    const f = fixture();
    for (const opened of [true, false]) {
        const actions = f.api.getLayoutActions({type: "window", id: "workspace", opened});
        assert.equal(actions[0].label, opened ? "Switch" : "Open");
        assert.equal(actions[0].icon, opened ? "iconFocus" : "iconOpen");
        assert.deepEqual(Array.from(actions, action => action.id), ["open", "rename", "delete"]);
    }
    const actions = f.api.getLayoutActions({type: "window", id: "workspace", opened: true});
    [0, 1, 2].forEach(index => actions[index].click(undefined, undefined));
    assert.deepEqual(f.calls, ["open", "rename", "delete"].map(action => ({action, value: "workspace"})));
});

test("重命名仅改变名称，弹窗以主窗口布局为标题并使用确定按钮", () => {
    const f = fixture();
    f.window.siyuan.storage.layouts[0].windowGeometry = {...f.geometry, width: 900};
    f.api.getLayoutActions({type: "main", name: "Reading"})[2].click(undefined, undefined);
    assert.equal(f.dialog().title, "Main window layouts");
    assert.equal(f.dialog().confirmText, "Confirm");
    assert.equal(f.dialog().actions, undefined);
    f.dialog().onConfirm(" Renamed ", {destroy: () => {}});
    assert.equal(f.window.siyuan.storage.layouts[0].name, "Renamed");
    assert.deepEqual(f.window.siyuan.storage.layouts[0].layout, {hideDock: true});
    assert.deepEqual(f.window.siyuan.storage.layouts[0].filesPaths, ["saved-path"]);
    assert.equal(f.window.siyuan.storage.layouts[0].windowGeometry.width, 900);
});

test("更新保存当前布局、文档树状态和窗口边界，打开后先恢复窗口再刷新", async () => {
    const f = fixture();
    const actions = f.api.getLayoutActions({type: "main", name: "Reading"});
    await actions[1].click(undefined, undefined);
    assert.equal(f.window.siyuan.storage.layouts[0].name, "Reading");
    assert.deepEqual(JSON.parse(JSON.stringify(f.window.siyuan.storage.layouts[0].layout)), {hideDock: false});
    assert.deepEqual(f.window.siyuan.storage.layouts[0].filesPaths, ["current-path"]);
    assert.deepEqual(f.window.siyuan.storage.layouts[0].windowGeometry, f.geometry);
    actions[0].click(undefined, undefined);
    await tick();
    assert.equal(f.calls[3].action, "/api/system/setUILayout");
    assert.deepEqual(JSON.parse(JSON.stringify(f.calls[3].value)), {layout: {hideDock: false}});
    assert.equal(f.calls[f.calls.length - 1].action, "reload");
    assert.deepEqual(f.calls.slice(-4).map(call => call.action), ["geometry", "paths", "/api/system/setUILayout", "reload"]);
});

test("删除只移除选中的布局", () => {
    const f = fixture();
    f.window.siyuan.storage.layouts.push({name: "Other", time: 1, layout: {hideDock: true}, filesPaths: [], windowGeometry: undefined});
    f.api.getLayoutActions({type: "main", name: "Reading"})[3].click(undefined, undefined);
    assert.deepEqual(f.window.siyuan.storage.layouts.map(item => item.name), ["Other"]);
    assert.deepEqual(f.window.siyuan.storage.paths, ["current-path"]);
});

test("批量打开先启动所有新窗口布局，再恢复主窗口布局", async () => {
    const f = fixture();
    await f.api.openSelectedLayouts("Reading", ["window-a", "window-b"]);
    await tick();
    assert.deepEqual(f.calls.map(call => call.action), ["open", "open", "paths", "/api/system/setUILayout", "reload"]);
    assert.deepEqual(f.calls.slice(0, 2).map(call => call.value), ["window-a", "window-b"]);
});

test("批量打开可以只选择新窗口布局", async () => {
    const f = fixture();
    await f.api.openSelectedLayouts("", ["window-a", "window-b"]);
    assert.deepEqual(f.calls.map(call => call.action), ["open", "open"]);
});

test("打开主窗口布局使用文档当前图标，包括未激活、钉住和聚焦子块的页签", async () => {
    const f = fixture();
    const doc = (rootId: string, fields: {active?: boolean; pin?: boolean; docIcon?: string} = {}, notebookId = "notebook") => ({
        instance: "Tab" as const, title: rootId, docIcon: "old",
        children: {instance: "Editor" as const, blockId: "child-block", rootId, notebookId}, ...fields,
    });
    const pluginTab = {instance: "Tab", title: "Plugin", docIcon: "plugin", children: {instance: "Custom"}} as const;
    const tabs = [doc("changed", {active: true}), doc("changed"), doc("cleared", {pin: true}),
        doc("added", {docIcon: ""}), doc("missing"), doc("locked", {}, "encrypted"), pluginTab];
    const layout = {layout: {instance: "Layout", children: [{instance: "Layout", children: [
        {instance: "Wnd", children: tabs.slice(0, 2)}, {instance: "Wnd", children: tabs.slice(2)},
    ]}]}} satisfies Config.IUiLayout;
    f.window.siyuan.storage.layouts[0].layout = layout;
    const requests: unknown[] = [];
    f.dependencies.fetchSyncPost = async (url, value) => {
        requests.push({url, value: structuredClone(value)});
        return {code: 0, data: {changed: {icon: "new"}, cleared: {}, added: {icon: "first"}, locked: {icon: "private"}}};
    };

    await f.api.openSelectedLayouts("Reading", []);

    assert.deepEqual(requests, [{url: "/api/attr/batchGetBlockAttrs", value: {ids: ["changed", "cleared", "added", "missing"]}}]);
    const saved = f.calls.find(call => call.action === "/api/system/setUILayout").value as {layout: typeof layout};
    assert.deepEqual(saved.layout.layout.children[0].children.flatMap(wnd => wnd.children.map(tab => tab.docIcon)),
        ["new", "new", "", "first", "old", "old", "plugin"]);
    assert.deepEqual(tabs.map(tab => tab.docIcon), ["old", "old", "old", "", "old", "old", "plugin"]);
    assert.equal(f.calls.at(-1).action, "reload");
});

test("读取文档图标失败时仍使用保存的布局", async () => {
    for (const fail of [false, true]) {
        const f = fixture();
        const layout = {layout: {instance: "Layout", children: [{instance: "Wnd", children: [{
            instance: "Tab", title: "Document", docIcon: "saved",
            children: {instance: "Editor", blockId: "doc", rootId: "doc", notebookId: "notebook"},
        }]}]}} satisfies Config.IUiLayout;
        f.window.siyuan.storage.layouts[0].layout = layout;
        let requests = 0;
        f.dependencies.fetchSyncPost = async () => {
            requests++;
            if (fail) {
                throw new Error("network failure");
            }
            return {code: -1, data: null};
        };

        await f.api.openSelectedLayouts("Reading", []);

        assert.equal(requests, 1);
        const applied = f.calls.find(call => call.action === "/api/system/setUILayout").value as {layout: unknown};
        assert.deepEqual(applied.layout, layout);
        assert.equal(f.calls.at(-1).action, "reload");
    }
});

test("无法获取原生窗口状态时更新布局保留已保存的窗口边界", async () => {
    const f = fixture(false);
    f.window.siyuan.storage.layouts[0].windowGeometry = f.geometry;
    await f.api.getLayoutActions({type: "main", name: "Reading"})[1].click(undefined, undefined);
    assert.deepEqual(f.window.siyuan.storage.layouts[0].windowGeometry, f.geometry);
    assert.deepEqual(JSON.parse(JSON.stringify(f.window.siyuan.storage.layouts[0].layout)), {hideDock: false});
});

test("切换等待在途保存，窗口缩放及刷新前的延迟保存不会覆盖目标布局", async () => {
    const f = fixture();
    let completeSave: () => void;
    let completeStorage: () => void;
    const fetchPost = f.dependencies.fetchPost;
    f.dependencies.fetchPost = async (url, value, callback) => {
        await new Promise<void>(resolve => completeSave = resolve);
        await fetchPost(url, value, callback);
    };
    f.util.saveLayout();
    const storage = f.dependencies.setStorageVal;
    f.dependencies.setStorageVal = async (key, value, callback) => {
        await new Promise<void>(resolve => completeStorage = resolve);
        await storage(key, value, callback);
    };
    f.window.siyuan.storage.layouts[0].windowGeometry = f.geometry;
    const opening = f.api.openSelectedLayouts("Reading", []);
    await tick();
    assert.deepEqual(f.calls, []);
    f.dependencies.fetchPost = fetchPost;
    completeSave();
    await tick();
    assert.deepEqual(f.calls.map(call => call.action), ["/api/system/setUILayout", "geometry"]);
    f.util.saveLayout();
    await f.util.exportLayout({cb: () => {}, errorExit: false});
    assert.equal(f.calls.length, 2);
    completeStorage();
    await opening;
    f.util.saveLayout();
    assert.deepEqual(f.calls.map(call => call.action),
        ["/api/system/setUILayout", "geometry", "paths", "/api/system/setUILayout", "reload"]);
    assert.deepEqual(JSON.parse(JSON.stringify(f.calls[3].value)), {layout: {hideDock: true}});
});

test("恢复请求失败后恢复自动保存并允许再次切换", async () => {
    for (const failure of ["storage", "layout"]) {
        const f = fixture();
        const storage = f.dependencies.setStorageVal;
        const fetchPost = f.dependencies.fetchPost;
        if (failure === "storage") {
            f.dependencies.setStorageVal = async () => {};
        } else {
            f.dependencies.fetchPost = async () => {};
        }
        await f.api.openSelectedLayouts("Reading", []);
        assert.equal(f.calls.some(call => call.action === "reload"), false);
        f.dependencies.setStorageVal = storage;
        f.dependencies.fetchPost = fetchPost;
        f.util.saveLayout();
        assert.equal(f.calls.at(-1).action, "/api/system/setUILayout");
        await f.api.openSelectedLayouts("Reading", []);
        assert.equal(f.calls.at(-1).action, "reload");
    }
});
