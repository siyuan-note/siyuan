import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import * as path from "node:path";
import test from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isVariableStatement, ModuleKind, ScriptTarget, transpileModule} from "typescript";
import * as stateFunctions from "./mobileTabsState";

const constants = {LOCAL_MOBILE_TABS: "mobileTabs", LOCAL_DOCINFO: "docInfo", CB_GET_SCROLL: "scroll", CB_GET_HL: "hl",
    CB_GET_CONTEXT: "context", CB_GET_ROOTSCROLL: "root-scroll", CB_GET_ALL: "all"};
const compile = (source: string) => transpileModule(source, {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;
const tabsSource = compile(readFileSync(path.join(__dirname, "MobileTabs.ts"), "utf8"));
const initSource = createSourceFile("initFramework.ts", readFileSync(path.join(__dirname,
    "../util/initFramework.ts"), "utf8"), ScriptTarget.ES2021, true);
const initDeclaration = initSource.statements.filter(isVariableStatement).find(statement =>
    statement.declarationList.declarations.some(item => item.name.getText(initSource) === "initFramework"));
const initFunction = initDeclaration.declarationList.declarations[0].initializer as import("typescript").ArrowFunction;
const initStatements = (initFunction.body as import("typescript").Block).statements;
const assignTabs = initStatements.find(statement => statement.getText(initSource).startsWith("window.siyuan.mobile.tabs ="));
const startupIndex = initStatements.findIndex(statement => statement.getText(initSource).startsWith("if (isStart &&"));
assert.ok(assignTabs && startupIndex > 0);
const startupSource = compile(`async function startup(app, isStart) {${assignTabs.getText(initSource)}\n` +
    initStatements.slice(startupIndex).map(statement => statement.getText(initSource)).join("\n") + "}");
const clone = <T>(value: T): T => value === undefined ? value : JSON.parse(JSON.stringify(value));
const entry = (id: string, notebookID = "box") =>
    ({id, rootID: id, notebookID, path: `/${id}.sy`, title: id, action: [] as string[]});
const saved = (tabs: any[] = [], activeTabID = tabs[0]?.id) => ({version: 1, tabs, activeTabID});
const tab = (id: string, current: any = entry(id), pin = false) =>
    ({id, current, pin, backStack: [] as ReturnType<typeof entry>[], forwardStack: [] as ReturnType<typeof entry>[], activeAt: 1});
const flush = async () => { for (let index = 0; index < 15; index++) { await Promise.resolve(); } };

const setup = (storage: Record<string, any> = {}, options: {
    mode?: number, missing?: string[], encrypted?: string[], uri?: string, android?: boolean,
    deferFold?: boolean, failOpen?: boolean, notebooks?: number,
} = {}) => {
    const requests: Array<{url: string, data: any, callback?: (response: any) => void}> = [];
    const writes: Array<{key: string, value: any}> = [];
    const opened: string[] = [];
    const loads: string[] = [];
    const folds: Array<(zoomIn: boolean) => void> = [];
    let empty = 0;
    let sequence = 0;
    const window: any = {siyuan: {storage: clone(storage), languages: {untitled: "Untitled"},
        config: {fileTree: {maxOpenTabCount: 32, tabStartupMode: options.mode || 0}},
        mobile: {}, menus: {menu: {remove: () => {}}}}};
    if (options.android) {
        window.JSAndroid = {getBlockURL: () => "external"};
        window.openFileByURL = (id: string) => { opened.push(id); return true; };
    }
    const fetchPost = (url: string, data: any, callback?: (response: any) => void) => {
        if (url === "/api/block/getBlockInfo") {
            callback({code: options.failOpen ? 1 : 0, data: {rootID: data.id, box: "box"}});
        } else {
            requests.push({url, data, callback});
        }
        return Promise.resolve();
    };
    const setEmpty = () => { empty++; };
    const api: any = {};
    const modules: Record<string, unknown> = {
        "../../constants": {Constants: constants},
        "./mobileTabsState": stateFunctions,
        "../../protyle/util/compatibility": {setStorageVal: (key: string, value: unknown) => {
            writes.push({key, value: clone(value)});
            return Promise.resolve();
        }},
        "../../util/pathName": {isEncryptedBox: (id: string) => options.encrypted?.includes(id)},
        "../../util/genID": {genUUID: () => `new-${++sequence}`},
        "../../protyle/scroll/saveScroll": {saveScroll: (): undefined => undefined},
        "../../util/fetch": {fetchPost, fetchSyncPost: async (_url: string, data: {ids: string[]}) =>
            ({code: 0, data: Object.fromEntries(data.ids.map(id => [id, !options.missing?.includes(id)]))})},
        "../util/setEmpty": {setEmpty}, "../util/closePanel": {closeModel: () => {}},
        "../editor": {updateRecentDocSwitchTime: () => {}, loadMobileFileById: (_app: unknown, id: string,
            action: string[], _position: unknown, _box: string, callback: (protyle: unknown) => void) => {
            loads.push(id);
            const protyle = {block: {rootID: id, id, action, showAll: true}, notebookId: "box", path: `/${id}.sy`};
            window.siyuan.mobile.editor = {protyle};
            callback(protyle);
        }},
    };
    const buttons: Record<string, {disabled: boolean}> = {
        mobileBottomBarBack: {disabled: false}, mobileBottomBarForward: {disabled: false},
    };
    const document = {querySelector: (): null => null, getElementById: (id: string) => buttons[id] || null};
    runInNewContext(tabsSource, {exports: api, require: (name: string) => modules[name] || {}, window, document,
        AbortController, DOMException, console});
    api.MobileTabs.prototype.renderOverview = () => {};
    api.MobileTabs.prototype.openOverview = () => {};
    const dependencies = {window, Constants: constants, MobileTabs: api.MobileTabs,
        getOpenNotebookCount: () => options.notebooks ?? 1,
        parseUriInfo: () => options.uri ? {id: options.uri} : {},
        openStandaloneDatabaseItemByURI: () => false, finishMobileStartup: () => {},
        queueAVLocateRequest: () => {}, activateQueuedAVLocate: () => {},
        openMobileOnboarding: () => false,
        openMobileFileById: (_app: unknown, id: string) => {
            opened.push(id);
            void window.siyuan.mobile.tabs.open(id);
        },
        fetchPost, setEmpty,
        checkFold: (_id: string, callback: (zoomIn: boolean) => void) => {
            if (options.deferFold) { folds.push(callback); } else { callback(false); }
        }};
    const startup = new Function(...Object.keys(dependencies), startupSource + "; return startup;")(...Object.values(dependencies));
    const respond = (url: string, response: any) => {
        const request = requests.find(item => item.url === url && item.callback);
        assert.ok(request, url);
        const callback = request.callback;
        request.callback = undefined;
        callback(response);
    };
    return {window, requests, writes, opened, loads, folds, api, respond, buttons,
        start: (isStart = true) => startup({}, isStart), get tabs(): any { return window.siyuan.mobile.tabs; },
        get empty() { return empty; }};
};

test("saved empty tabs suppress both legacy document fallbacks on restart and reload", async () => {
    for (const isStart of [false, true]) {
        const state = setup({mobileTabs: saved(), docInfo: {id: "old"}});
        await state.start(isStart);
        assert.equal(state.empty, 1);
        assert.equal(state.requests.length, 0);
        assert.deepEqual(state.opened, []);
        assert.equal(state.tabs.canRestoreLegacyDocument(), false);
    }
});

test("closing every tab or the final tab persists empty state without clearing unrelated recent history", async () => {
    for (const closeAll of [false, true]) {
        const state = setup({mobileTabs: saved([tab("old")]), docInfo: {id: "old"}});
        await state.start();
        if (closeAll) { state.tabs.closeAll(); } else { await state.tabs.close("old"); }
        assert.deepEqual(clone(state.window.siyuan.storage.mobileTabs.tabs), []);
        assert.equal(state.window.siyuan.storage.docInfo.id, "old");
        const restarted = setup(state.window.siyuan.storage);
        await restarted.start();
        assert.equal(restarted.requests.length, 0);
        assert.deepEqual(restarted.opened, []);
    }
});

test("saved blank, sanitized encrypted, malformed and deleted tabs never resurrect an unrelated old document", async () => {
    for (const [tabs, options] of [
        [[{...tab("blank"), current: undefined}], {}],
        [[tab("encrypted", entry("encrypted", "secret"))], {encrypted: ["secret"]}],
        [[null, {}], {}],
        [[tab("deleted")], {missing: ["deleted"]}],
    ] as [any[], any][]) {
        const state = setup({mobileTabs: saved(tabs), docInfo: {id: "old"}}, options);
        await state.start();
        assert.equal(state.requests.some(item => item.url === "/api/block/checkBlockExist"), false);
        assert.deepEqual(state.opened, []);
    }
});

test("legacy startup keeps its original data until a successful document restoration", async () => {
    for (const value of [undefined, {version: 2, tabs: [] as unknown[]}, {version: 1, tabs: null}]) {
        const state = setup({mobileTabs: value, docInfo: {id: "old"}});
        await state.start();
        assert.deepEqual(state.window.siyuan.storage.mobileTabs, value);
        assert.equal(state.writes.length, 0);
        assert.equal(state.buttons.mobileBottomBarBack.disabled, true);
        assert.equal(state.buttons.mobileBottomBarForward.disabled, true);
        state.respond("/api/block/checkBlockExist", {data: true});
        await flush();
        assert.deepEqual(state.opened, ["old"]);
        assert.equal(state.window.siyuan.storage.mobileTabs.version, 1);
        assert.equal(state.window.siyuan.storage.mobileTabs.tabs[0].current.rootID, "old");
    }
});

test("interrupted and failed legacy restoration does not save a temporary empty session", async () => {
    for (const failOpen of [false, true]) {
        const state = setup({docInfo: {id: "old"}}, {failOpen});
        await state.start();
        if (failOpen) {
            state.respond("/api/block/checkBlockExist", {data: true});
            await flush();
        }
        state.tabs.save();
        assert.equal(state.window.siyuan.storage.mobileTabs, undefined);
        assert.equal(state.writes.length, 0);
        const restart = setup(state.window.siyuan.storage);
        await restart.start();
        assert.ok(restart.requests.some(item => item.url === "/api/block/checkBlockExist"));
    }
    const state = setup({docInfo: {id: "old"}});
    await state.start();
    state.tabs.closeAll();
    state.tabs.save();
    assert.equal(state.window.siyuan.storage.mobileTabs.tabs.length, 0, "an explicit close remains persistent");
});

test("closing tabs or starting another navigation cancels every stage of the legacy fallback", async () => {
    for (const stage of ["exist", "recent", "fold"]) {
        for (const action of ["close", "blank", "navigate", "failed", "replace"]) {
            const state = setup({docInfo: {id: "old"}}, {deferFold: true, failOpen: action === "failed"});
            await state.start();
            if (stage !== "exist") { state.respond("/api/block/checkBlockExist", {data: false}); }
            if (stage === "fold") { state.respond("/api/block/getRecentUpdatedBlocks", {data: [{id: "recent"}]}); }
            if (action === "close") { state.tabs.closeAll(); }
            if (action === "blank") { state.tabs.createBlank(); }
            if (action === "navigate" || action === "failed") { await state.tabs.open("chosen"); }
            if (action === "replace") { state.window.siyuan.mobile.tabs = new state.api.MobileTabs({}); }
            if (stage === "exist") { state.respond("/api/block/checkBlockExist", {data: true}); }
            if (stage === "recent") { state.respond("/api/block/getRecentUpdatedBlocks", {data: [{id: "recent"}]}); }
            if (stage === "fold") { state.folds[0](false); }
            await flush();
            assert.deepEqual(state.opened, [], `${stage}/${action}`);
        }
    }
});

test("startup modes, pinned tabs and external links retain their existing priority", async () => {
    for (const mode of [0, 1, 2]) {
        const state = setup({mobileTabs: saved([tab("pin", entry("pin"), true), tab("old")], "old")}, {mode});
        await state.start();
        await flush();
        const tabs = state.tabs.state.tabs;
        assert.ok(tabs.some((item: any) => item.id === "pin" && item.pin));
        assert.equal(state.requests.some(item => item.url === "/api/block/checkBlockExist"), false);
        if (mode === 0) { assert.equal(state.tabs.state.activeTabID, "old"); }
        if (mode === 1) { assert.equal(state.tabs.activeTab.current, undefined); }
        if (mode === 2) { assert.deepEqual(clone(tabs.map((item: any) => item.id)), ["pin"]); }
        for (const android of [false, true]) {
            const linked = setup({mobileTabs: saved(), docInfo: {id: "old"}}, {mode, android, uri: android ? undefined : "external"});
            await linked.start();
            await flush();
            assert.deepEqual(linked.opened, ["external"]);
            assert.equal(linked.requests.some(item => item.url === "/api/block/checkBlockExist"), false);
        }
    }
});
