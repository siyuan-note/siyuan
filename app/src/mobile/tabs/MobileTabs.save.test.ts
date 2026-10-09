import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import test from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import * as scrollRequest from "../../protyle/scroll/scrollRequest";
import * as stateFunctions from "./mobileTabsState";

const constants = {LOCAL_MOBILE_TABS: "mobileTabs", LOCAL_DOCINFO: "docInfo", LOCAL_FILEPOSITION: "positions",
    CB_GET_SCROLL: "scroll", CB_GET_HL: "hl", CB_GET_CONTEXT: "context", CB_GET_ROOTSCROLL: "root-scroll", CB_GET_ALL: "all"};
const compile = (file: string) => transpileModule(readFileSync(join(__dirname, file), "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;
const tabsSource = compile("MobileTabs.ts");
const scrollSource = compile("../../protyle/scroll/saveScroll.ts");
const layoutSource = compile("../util/saveLayout.ts");
const clone = <T>(value: T): T => value === undefined ? value : JSON.parse(JSON.stringify(value));
const entry = (id = "root", scrollTop = 100, notebookID = "box", rootID = "root") => ({
    id, rootID, notebookID, path: `/${rootID}.sy`, title: id, action: [constants.CB_GET_SCROLL],
    scroll: {rootId: rootID, startId: "start", endId: "end", scrollTop, zoomInId: id},
});
const tab = (id = "tab", current: any = entry()) => ({id, current, backStack: [] as any[], forwardStack: [] as any[], activeAt: 1});
const saved = (tabs: any[] = [tab()], activeTabID = tabs[0]?.id) => ({version: 1, tabs, activeTabID});
const flush = async () => { for (let index = 0; index < 30; index++) { await Promise.resolve(); } };

type Load = {
    id: string;
    action: string[];
    notebookID: string;
    scroll: any;
    success: (protyle: any) => void;
    failure: (invalid?: boolean, editorUnchanged?: boolean) => void;
    isValid: () => boolean;
};

const setup = (options: {
    stored?: any;
    readonly?: boolean;
    publish?: boolean;
    encrypted?: string[];
    roots?: Record<string, string>;
} = {}) => {
    const writes: Array<{key: string, value: any}> = [];
    const loads: Load[] = [];
    const scrollCalls: boolean[] = [];
    const toolbar = {value: ""};
    let deferLoads = false;
    let rejectWrite = false;
    let sequence = 0;
    const window: any = {siyuan: {storage: {mobileTabs: clone(options.stored), positions: {}},
        config: {readonly: options.readonly, fileTree: {maxOpenTabCount: 32}}, isPublish: options.publish,
        languages: {untitled: "Untitled", newTab: "New tab"}, mobile: {}, menus: {menu: {remove: () => {}}}}};
    const document = {querySelector: (): null => null,
        getElementById: (id: string) => id === "toolbarName" ? toolbar : null};
    const rootFor = (id: string) => options.roots?.[id] || "root";
    const makeProtyle = (load: Load) => ({
        block: {rootID: rootFor(load.id), id: load.id, action: [...load.action], showAll: true},
        notebookId: load.notebookID, path: `/${rootFor(load.id)}.sy`, element: {dataset: {}},
        background: {ial: {icon: ""}}, toolbar: {},
        contentElement: {scrollTop: load.scroll?.scrollTop ?? 0, getAttribute: (): null => null},
        wysiwyg: {element: {firstElementChild: {getAttribute: () => "start"},
            lastElementChild: {getAttribute: () => "end"}, contains: () => false}},
    });
    const complete = (load = loads.at(-1), install = true, bypassValidity = false) => {
        if (!bypassValidity && !load.isValid()) {
            return;
        }
        const protyle = makeProtyle(load);
        if (install) {
            window.siyuan.mobile.editor = {protyle};
            toolbar.value = load.id;
        }
        load.success(protyle);
    };
    const setStorageVal = (key: string, value: unknown, callback?: () => void) => {
        writes.push({key, value: clone(value)});
        if (rejectWrite && key === constants.LOCAL_MOBILE_TABS) {
            return Promise.reject(new Error("storage unavailable"));
        }
        callback?.();
        return Promise.resolve();
    };
    const fetchPost = (_url: string, data: any, callback?: (response: any) => void) => {
        callback?.({code: 0, data: {rootID: rootFor(data.id), box: data.notebook || "box"}});
        return Promise.resolve();
    };
    const encrypted = (id: string) => options.encrypted?.includes(id) || false;
    const common = {
        "../../constants": {Constants: constants},
        "../../util/pathName": {isEncryptedBox: encrypted},
        "../../protyle/util/compatibility": {setStorageVal},
        "../../util/fetch": {fetchPost},
    };
    const execute = (source: string, modules: Record<string, unknown>) => {
        const api: any = {};
        runInNewContext(source, {exports: api, require: (name: string) => modules[name] || {}, window, document,
            AbortController, DOMException, getSelection: () => ({rangeCount: 0}), console: {warn: () => {}}});
        return api;
    };
    const scrollApi = execute(scrollSource, {...common, "./scrollRequest": scrollRequest,
        "../util/compatibility": {setStorageVal}});
    const saveScroll = (protyle: any, getObject: boolean) => {
        scrollCalls.push(getObject);
        return scrollApi.saveScroll(protyle, getObject);
    };
    const layoutApi = execute(layoutSource, {...common, "../../protyle/scroll/saveScroll": {saveScroll},
        "../../util/fetchTimeout": {withFetchTimeout: (task: () => Promise<boolean>) => task()}});
    const tabsApi = execute(tabsSource, {...common, "./mobileTabsState": stateFunctions,
        "../../util/genID": {genUUID: () => `new-${++sequence}`},
        "../../protyle/scroll/saveScroll": {saveScroll}, "../util/saveLayout": layoutApi,
        "../util/setEmpty": {setEmpty: () => { window.siyuan.mobile.editor = undefined; }},
        "../util/closePanel": {closeModel: () => {}},
        "../editor": {updateRecentDocSwitchTime: () => {}, loadMobileFileById: (_app: unknown, id: string,
            action: string[], _position: unknown, notebookID: string, success: Load["success"],
            _reload: boolean, isValid: Load["isValid"], _signal: unknown, scroll: any, _recent: boolean,
            failure: Load["failure"]) => {
            const load = {id, action, notebookID, success, isValid, scroll, failure};
            loads.push(load);
            if (!deferLoads) {
                complete(load);
            }
        }},
    });
    tabsApi.MobileTabs.prototype.renderOverview = () => {};
    tabsApi.MobileTabs.prototype.openOverview = () => {};
    const tabs = new tabsApi.MobileTabs({});
    window.siyuan.mobile.tabs = tabs;
    return {tabs, window, writes, loads, scrollCalls, complete,
        saveLayout: layoutApi.saveMobileLayout as () => Promise<boolean>,
        get current(): any { return tabs.state.tabs.find((item: any) => item.id === tabs.state.activeTabID)?.current; },
        get protyle(): any { return window.siyuan.mobile.editor?.protyle; },
        set defer(value: boolean) { deferLoads = value; },
        set reject(value: boolean) { rejectWrite = value; },
        get persisted(): any { return writes.filter(write => write.key === constants.LOCAL_MOBILE_TABS).at(-1)?.value; },
    };
};

test("layout save captures the live 8000 position and restores it after restart instead of stored 100", async () => {
    const state = setup({stored: saved()});
    await state.tabs.restore();
    assert.equal(state.protyle.contentElement.scrollTop, 100);
    state.protyle.contentElement.scrollTop = 8000;
    const save = state.saveLayout();
    state.protyle.contentElement.scrollTop = 9000;
    assert.equal(await save, true);
    assert.equal(state.persisted.tabs[0].current.scroll.scrollTop, 8000);
    assert.ok(state.scrollCalls.every(Boolean), "tab snapshots use saveScroll's object-only path");
    assert.deepEqual(clone(state.window.siyuan.storage.positions), {});
    const restarted = setup({stored: state.persisted});
    await restarted.tabs.restore();
    assert.equal(restarted.loads[0].scroll.scrollTop, 8000);
    assert.equal(restarted.protyle.contentElement.scrollTop, 8000);
});

test("two tabs for the same document keep independent positions across switches and restart", async () => {
    const state = setup({stored: saved([tab("first", entry("first-block", 100)), tab("second", entry("second-block", 200))])});
    await state.tabs.restore();
    state.protyle.contentElement.scrollTop = 8000;
    await state.tabs.switchTo("second");
    assert.equal(state.protyle.contentElement.scrollTop, 200);
    state.protyle.contentElement.scrollTop = 9000;
    await state.tabs.save();
    assert.deepEqual(state.persisted.tabs.map((item: any) => item.current.scroll.scrollTop), [8000, 9000]);
    await state.tabs.switchTo("first");
    assert.equal(state.protyle.contentElement.scrollTop, 8000);
    await state.tabs.save();
    const restarted = setup({stored: state.persisted});
    await restarted.tabs.restore();
    assert.equal(restarted.protyle.contentElement.scrollTop, 8000);
    await restarted.tabs.switchTo("second");
    assert.equal(restarted.protyle.contentElement.scrollTop, 9000);
});

test("same-root back and forward targets are never overwritten by the still-rendered history entry", async () => {
    const state = setup({stored: saved([tab("tab", entry("first-block", 100))])});
    await state.tabs.restore();
    await state.tabs.open("second-block", {tabID: "tab"});
    state.protyle.contentElement.scrollTop = 8000;
    state.defer = true;
    const back = state.tabs.goBack();
    await flush();
    assert.equal(state.loads.at(-1).scroll.scrollTop, 100);
    await state.tabs.save();
    assert.equal(state.persisted.tabs[0].current.scroll.scrollTop, 100);
    assert.equal(state.persisted.tabs[0].forwardStack[0].scroll.scrollTop, 8000);
    state.complete();
    await back;
    const forward = state.tabs.goForward();
    await flush();
    assert.equal(state.loads.at(-1).scroll.scrollTop, 8000);
    await state.tabs.save();
    assert.equal(state.persisted.tabs[0].current.scroll.scrollTop, 8000);
    state.complete();
    await forward;
    assert.equal(state.protyle.contentElement.scrollTop, 8000);
});

test("saving before restore does not treat an unrelated editor with the same root as the active tab", async () => {
    const state = setup({stored: saved()});
    state.window.siyuan.mobile.editor = {protyle: {block: {rootID: "root"}, notebookId: "box"}};
    assert.equal(await state.tabs.save(), true);
    assert.equal(state.persisted.tabs[0].current.scroll.scrollTop, 100);
    assert.equal(state.scrollCalls.length, 0);
});

test("a notebook mismatch cannot overwrite an owned entry even when the root ID matches", async () => {
    const state = setup({stored: saved()});
    await state.tabs.restore();
    state.protyle.notebookId = "other-box";
    state.protyle.contentElement.scrollTop = 8000;
    await state.tabs.save();
    assert.equal(state.persisted.tabs[0].current.notebookID, "box");
    assert.equal(state.persisted.tabs[0].current.scroll.scrollTop, 100);
});

test("partially loaded editor content stays unowned after failure until a successful restoration", async () => {
    const state = setup({stored: saved()});
    await state.tabs.restore();
    state.protyle.contentElement.scrollTop = 200;
    state.defer = true;
    const opening = state.tabs.open("partial", {tabID: "tab"});
    await flush();
    state.protyle.block.id = "partial";
    state.protyle.contentElement.scrollTop = 8000;
    await state.tabs.save();
    assert.equal(state.persisted.tabs[0].current.id, "root");
    assert.equal(state.persisted.tabs[0].current.scroll.scrollTop, 200);
    state.loads.at(-1).failure(false, false);
    assert.equal(await opening, "failed");
    await state.tabs.save();
    assert.equal(state.persisted.tabs[0].current.scroll.scrollTop, 200);
    state.defer = false;
    await state.tabs.restore();
    state.protyle.contentElement.scrollTop = 9000;
    await state.tabs.save();
    assert.equal(state.persisted.tabs[0].current.scroll.scrollTop, 9000);
});

test("an early load failure preserves ownership of the unchanged editor for later saves", async () => {
    const state = setup({stored: saved()});
    await state.tabs.restore();
    state.protyle.contentElement.scrollTop = 200;
    state.defer = true;
    const opening = state.tabs.open("unavailable", {tabID: "tab"});
    await flush();
    state.loads.at(-1).failure(false, true);
    assert.equal(await opening, "failed");
    state.protyle.contentElement.scrollTop = 8000;
    await state.tabs.save();
    assert.equal(state.persisted.tabs[0].current.id, "root");
    assert.equal(state.persisted.tabs[0].current.scroll.scrollTop, 8000);
});

test("a stale early failure cannot reclaim ownership from a successful newer navigation", async () => {
    const state = setup({stored: saved()});
    await state.tabs.restore();
    state.defer = true;
    const stale = state.tabs.open("stale", {tabID: "tab"});
    await flush();
    const staleLoad = state.loads.at(-1);
    const latest = state.tabs.open("latest", {tabID: "tab"});
    await flush();
    assert.equal(await stale, "cancelled");
    state.complete();
    assert.equal(await latest, "success");
    const ownedEntry = state.current;
    staleLoad.failure(false, true);
    assert.equal(state.tabs.renderedEntry, ownedEntry);
    state.protyle.contentElement.scrollTop = 8000;
    await state.tabs.save();
    assert.equal(state.persisted.tabs[0].current.id, "latest");
    assert.equal(state.persisted.tabs[0].current.scroll.scrollTop, 8000);
});

test("an unchanged-editor failure flag cannot claim a replacement editor with the same document", async () => {
    const state = setup({stored: saved()});
    await state.tabs.restore();
    state.protyle.contentElement.scrollTop = 200;
    state.defer = true;
    const opening = state.tabs.open("unavailable", {tabID: "tab"});
    await flush();
    state.window.siyuan.mobile.editor = {protyle: {...state.protyle,
        contentElement: {...state.protyle.contentElement, scrollTop: 8000}}};
    state.loads.at(-1).failure(false, true);
    assert.equal(await opening, "failed");
    await state.tabs.save();
    assert.equal(state.persisted.tabs[0].current.scroll.scrollTop, 200);
});

test("a forced stale success callback cannot reclaim ownership after a newer same-root navigation", async () => {
    const state = setup({stored: saved()});
    await state.tabs.restore();
    state.defer = true;
    const stale = state.tabs.open("stale", {tabID: "tab"});
    await flush();
    const staleLoad = state.loads.at(-1);
    const latest = state.tabs.open("latest", {tabID: "tab"});
    await flush();
    assert.equal(await stale, "cancelled");
    assert.equal(staleLoad.isValid(), false);
    state.complete();
    assert.equal(await latest, "success");
    const ownedEntry = state.current;
    state.complete(staleLoad, false, true);
    assert.equal(state.current, ownedEntry);
    assert.equal(state.tabs.renderedEntry, ownedEntry);
    state.protyle.contentElement.scrollTop = 8000;
    await state.tabs.save();
    assert.equal(state.persisted.tabs[0].current.id, "latest");
    assert.equal(state.persisted.tabs[0].current.scroll.scrollTop, 8000);
});

test("a pending encrypted-to-plain load cannot relabel and persist the encrypted editor", async () => {
    const state = setup({encrypted: ["secret"]});
    await state.tabs.open("secret-block", {notebookId: "secret"});
    state.protyle.contentElement.scrollTop = 8000;
    const activeID = state.tabs.state.activeTabID;
    state.defer = true;
    const opening = state.tabs.open("plain-block", {notebookId: "box", tabID: activeID});
    await flush();
    state.protyle.notebookId = "box";
    await state.tabs.save();
    assert.equal(state.current.notebookID, "secret");
    assert.equal(state.persisted.tabs[0].current, undefined);
    assert.equal(JSON.stringify(state.persisted).includes("secret-block"), false);
    state.complete();
    assert.equal(await opening, "success");
    await state.tabs.save();
    assert.equal(state.persisted.tabs[0].current.id, "plain-block");
    assert.deepEqual(state.persisted.tabs[0].backStack, []);
    assert.deepEqual(clone(state.window.siyuan.storage.positions), {});
});

test("encrypted current and history entries are filtered from every saved tab", async () => {
    const state = setup({stored: saved(), encrypted: ["secret"]});
    await state.tabs.restore();
    const active = state.tabs.state.tabs[0];
    active.backStack = [entry("public-back"), entry("secret-back", 1, "secret")];
    active.forwardStack = [entry("secret-forward", 2, "secret"), entry("public-forward")];
    state.tabs.state.tabs.push(tab("secret-tab", entry("secret-current", 3, "secret")));
    await state.tabs.save();
    assert.deepEqual(state.persisted.tabs[0].backStack.map((item: any) => item.id), ["public-back"]);
    assert.deepEqual(state.persisted.tabs[0].forwardStack.map((item: any) => item.id), ["public-forward"]);
    assert.equal(state.persisted.tabs[1].current, undefined);
    assert.equal(JSON.stringify(state.persisted).includes("secret-current"), false);
});

test("blank or readonly scroll snapshots preserve the last valid saved position", async () => {
    for (const readonly of [false, true]) {
        const state = setup({stored: saved()});
        await state.tabs.restore();
        await flush();
        state.writes.length = 0;
        state.protyle.contentElement.scrollTop = 8000;
        if (readonly) {
            state.window.siyuan.config.readonly = true;
        } else {
            state.protyle.wysiwyg.element.firstElementChild = null;
        }
        assert.equal(await state.tabs.save(), true);
        assert.equal(state.current.scroll.scrollTop, 100);
        if (readonly) {
            assert.equal(state.writes.length, 0);
        } else {
            assert.equal(state.persisted.tabs[0].current.scroll.scrollTop, 100);
        }
    }
});

test("legacy migration saves no temporary empty session and explicit blank sessions remain persistent", async () => {
    for (const stored of [undefined, {version: 2, tabs: [] as unknown[]}, {version: 1, tabs: null}]) {
        const state = setup({stored});
        assert.equal(await state.tabs.save(), true);
        assert.equal(state.writes.length, 0);
        assert.equal(state.tabs.canRestoreLegacyDocument(), true);
        state.tabs.createBlank();
        assert.equal(await state.tabs.save(), true);
        assert.equal(state.persisted.tabs.length, 1);
        assert.equal(state.persisted.tabs[0].current, undefined);
    }
});

test("a failed write is reported and a later save retries with the latest live position", async () => {
    const state = setup({stored: saved()});
    await state.tabs.restore();
    await flush();
    state.reject = true;
    state.protyle.contentElement.scrollTop = 8000;
    assert.equal(await state.tabs.save(), false);
    assert.equal(state.persisted.tabs[0].current.scroll.scrollTop, 8000);
    state.reject = false;
    state.protyle.contentElement.scrollTop = 9000;
    assert.equal(await state.tabs.save(), true);
    assert.equal(state.persisted.tabs[0].current.scroll.scrollTop, 9000);
});

test("saving a closed session cannot revive the last rendered document", async () => {
    const state = setup({stored: saved()});
    await state.tabs.restore();
    state.protyle.contentElement.scrollTop = 8000;
    state.tabs.closeAll();
    assert.equal(await state.tabs.save(), true);
    assert.deepEqual(state.persisted.tabs, []);
    assert.equal(state.persisted.activeTabID, undefined);
});
