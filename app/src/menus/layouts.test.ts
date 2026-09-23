import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const compiled = transpileModule(readFileSync("src/menus/layouts.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

const fixture = () => {
    const layouts = [{name: "Reading", time: 1, layout: {saved: true}, filesPaths: ["saved-path"]}];
    const calls: Array<{action: string, value?: unknown}> = [];
    let dialog: any;
    const dependencies = {
        Constants: {LOCAL_LAYOUTS: "layouts", LOCAL_FILESPATHS: "paths",
            SIYUAN_WINDOW_WORKSPACE_GET_OPEN: "siyuan-window-workspace-get-open"},
        setStorageVal: (key: string, value: unknown, callback?: () => void) => {
            calls.push({action: key, value: JSON.parse(JSON.stringify(value))});
            callback?.();
        },
        fetchPost: (url: string, value: unknown, callback: () => void) => {
            calls.push({action: url, value});
            callback();
        },
        getAllLayout: () => ({current: true}),
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
    const window = {siyuan: {
        storage: {layouts, paths: ["current-path"]},
        languages: {openBy: "Open", windowWorkspaceSwitch: "Switch", use: "Use", update: "Update", rename: "Rename",
            delete: "Delete", confirm: "Confirm", mainWindowLayouts: "Main window layouts", _kernel: {142: "Empty"}},
    }, location: {reload: () => calls.push({action: "reload"})}};
    const api = {} as typeof import("./layouts");
    runInNewContext(compiled, {exports: api, require: () => dependencies, window});
    return {api, window, calls, dialog: () => dialog};
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
    f.api.getLayoutActions({type: "main", name: "Reading"})[2].click(undefined, undefined);
    assert.equal(f.dialog().title, "Main window layouts");
    assert.equal(f.dialog().confirmText, "Confirm");
    assert.equal(f.dialog().actions, undefined);
    f.dialog().onConfirm(" Renamed ", {destroy: () => {}});
    assert.equal(f.window.siyuan.storage.layouts[0].name, "Renamed");
    assert.deepEqual(f.window.siyuan.storage.layouts[0].layout, {saved: true});
    assert.deepEqual(f.window.siyuan.storage.layouts[0].filesPaths, ["saved-path"]);
});

test("更新保存当前布局和文档树状态，打开恢复已保存布局", () => {
    const f = fixture();
    const actions = f.api.getLayoutActions({type: "main", name: "Reading"});
    actions[1].click(undefined, undefined);
    assert.equal(f.window.siyuan.storage.layouts[0].name, "Reading");
    assert.deepEqual(JSON.parse(JSON.stringify(f.window.siyuan.storage.layouts[0].layout)), {current: true});
    assert.deepEqual(f.window.siyuan.storage.layouts[0].filesPaths, ["current-path"]);
    actions[0].click(undefined, undefined);
    assert.equal(f.calls[1].action, "/api/system/setUILayout");
    assert.deepEqual(JSON.parse(JSON.stringify(f.calls[1].value)), {layout: {current: true}});
    assert.equal(f.calls[f.calls.length - 1].action, "reload");
});

test("删除只移除选中的布局", () => {
    const f = fixture();
    f.window.siyuan.storage.layouts.push({name: "Other", time: 1, layout: {saved: true}, filesPaths: []});
    f.api.getLayoutActions({type: "main", name: "Reading"})[3].click(undefined, undefined);
    assert.deepEqual(f.window.siyuan.storage.layouts.map(item => item.name), ["Other"]);
    assert.deepEqual(f.window.siyuan.storage.paths, ["current-path"]);
});
