import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const wndSource = transpileModule(readFileSync(join(__dirname, "Wnd.ts"), "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;
const closeSource = transpileModule(readFileSync(join(__dirname, "../protyle/header/documentTitleClose.ts"), "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;
const tabUtilSource = transpileModule(readFileSync(join(__dirname, "tabUtil.ts"), "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

const createCloseFixture = () => {
    const calls = {
        titleFlushes: 0, bodyFlushes: 0, windowFlushes: 0, uploadChecks: 0,
        saveScroll: 0, saveBackScroll: 0, recentCloseTime: 0,
        headerRemovals: 0, panelRemovals: 0, modelDestroyed: 0, socketClosed: 0, windowCloseChecks: 0,
    };
    const messages: string[] = [];
    const batchCloseRequests: string[][] = [];
    const timers: (() => void)[] = [];
    let resolveTitle: () => void;
    let rejectTitle: (error: Error) => void;
    const pendingTitle = new Promise<void>((resolve, reject) => {
        resolveTitle = resolve;
        rejectTitle = reject;
    });
    let uploading = false;
    const editor = {
        protyle: {
            block: {rootID: "document"},
            title: {flushPendingInput: () => { calls.titleFlushes++; return pendingTitle; }},
        },
        isUploading: () => { calls.uploadChecks++; return uploading; },
        flushPendingTransactions: async () => { calls.bodyFlushes++; },
    };
    class Editor {
        editor = editor;
        destroy() { calls.modelDestroyed++; }
        send(command: string) { if (command === "closews") calls.socketClosed++; }
    }
    class Custom {}
    const window = {siyuan: {
        config: {readonly: false, fileTree: {maxOpenTabCount: 2}}, layout: {}, storage: {closedTabs: [] as object[]}, blockPanels: [] as object[],
        languages: {newFile: "New", switchTab: "Switch", uploading: "Uploading", settingsPendingSaveError: "Save failed"},
    }};
    const showMessage = (message: string) => messages.push(message);
    const closeExports: Record<string, unknown> = {};
    runInNewContext(closeSource, {
        exports: closeExports, window, Error, console: {error() {}},
        require: () => ({showMessage}),
    });
    const dependencies: Record<string, object> = {
        "../editor": {Editor},
        "./dock/Custom": {Custom},
        "../util/genID": {genUUID: () => "window"},
        "../constants": {Constants: {LOCAL_CLOSED_TABS: "closedTabs", SIZE_UNDO: 10}},
        "../dialog/message": {showMessage},
        "../protyle/header/documentTitleClose": closeExports,
        "../window/closeWin": {
            flushClosingWindowTab: () => calls.windowFlushes++,
            closeWindowAfterLastTab: () => { calls.windowCloseChecks++; return Promise.resolve(false); },
        },
        "../window/setHeader": {setModelsHash() {}},
        "electron": {webFrame: {clearCache() {}}, ipcRenderer: {send() {}}},
        "./util": {isSensitiveTab: () => false, layoutToJSON() {}, saveLayout() {}},
        "../protyle/util/compatibility": {sanitizeClosedTabs: (tabs: unknown[]) => tabs, setStorageVal() {}},
        "../util/backForward": {saveBackScroll: () => calls.saveBackScroll++},
        "../protyle/scroll/saveScroll": {saveScroll: () => calls.saveScroll++},
        "../util/fetch": {fetchPost: (url: string, data: {rootIDs: string[]}) => {
            if (url === "/api/storage/updateRecentDocCloseTime") calls.recentCloseTime++;
            if (url === "/api/storage/batchUpdateRecentDocCloseTime") batchCloseRequests.push(data.rootIDs);
        }},
        "./tabUtil": {resizeTabs() {}, setTabPosition() {}},
    };
    const moduleExports = {} as {Wnd: new (app: object) => {
        children: {id: string, headElement?: unknown}[];
        removeTab: (id: string, batch?: boolean, animate?: boolean, saveLayout?: boolean, sourceRemoved?: boolean) => boolean | Promise<boolean>;
        removeOverCounter: () => Promise<void>;
        switchTab: () => void;
    }};
    runInNewContext(wndSource, {
        exports: moduleExports, window,
        document: {createElement: () => ({classList: {add() {}}, querySelector: (): null => null})},
        setTimeout: (callback: () => void) => { timers.push(callback); return timers.length; },
        require: (name: string) => dependencies[name] || {},
    });
    // Constructor initialization retains the actual private removal action; no close method is stubbed.
    const wnd = new moduleExports.Wnd({});
    const tab = {
        id: "tab", model: new Editor(),
        headElement: {classList: {contains: () => false}, getAttribute: () => "0",
            remove: () => calls.headerRemovals++, setAttribute() {}},
        panelElement: {remove: () => calls.panelRemovals++},
    };
    wnd.children = [tab, {id: "other-tab"}];
    const tabUtilExports = {} as typeof import("./tabUtil");
    runInNewContext(tabUtilSource, {exports: tabUtilExports,
        require: (name: string) => dependencies[name] || {}});
    const batchClose = () => {
        wnd.switchTab = () => {};
        return tabUtilExports.closeTabByType(tab as unknown as import("./Tab").Tab, "closeAll");
    };
    Object.assign(tab, {parent: wnd});
    const remove = (sourceRemoved = false, animate = false) => wnd.removeTab(tab.id, false, animate, false, sourceRemoved);
    return {wnd, tab, calls, messages, timers, remove,
        editor, batchClose, batchCloseRequests,
        resolveTitle: () => resolveTitle(), rejectTitle: () => rejectTitle(new Error("Conflict")),
        setUploading: (value: boolean) => { uploading = value; }};
};

const settleClose = () => new Promise<void>(resolve => setImmediate(resolve));

test("ordinary Wnd close waits for title persistence and retains a failed editor", async () => {
    const fixture = createCloseFixture();
    const closing = fixture.remove();
    assert.equal(fixture.remove(), closing);
    assert.equal(fixture.calls.titleFlushes, 1);
    assert.equal(fixture.wnd.children.includes(fixture.tab), true);
    assert.equal(fixture.calls.windowFlushes, 0);
    fixture.rejectTitle();
    assert.equal(await closing, false);
    await settleClose();
    assert.equal(fixture.wnd.children.includes(fixture.tab), true);
    assert.equal(fixture.calls.modelDestroyed, 0);
    assert.equal(fixture.calls.bodyFlushes, 0);
    assert.equal(fixture.calls.windowFlushes, 0);
    assert.deepEqual(fixture.messages, ["Conflict"]);
});

test("ordinary Wnd close preserves the uploading guard and saves after title acknowledgement", async () => {
    const fixture = createCloseFixture();
    fixture.setUploading(true);
    assert.equal(fixture.remove(), false);
    assert.deepEqual(fixture.messages, ["Uploading"]);
    assert.equal(fixture.calls.titleFlushes, 0);
    assert.equal(fixture.wnd.children.includes(fixture.tab), true);
    fixture.setUploading(false);
    const closing = fixture.remove();
    fixture.resolveTitle();
    assert.equal(await closing, true);
    await settleClose();
    assert.equal(fixture.wnd.children.includes(fixture.tab), false);
    assert.equal(fixture.calls.bodyFlushes, 1);
    assert.equal(fixture.calls.windowFlushes, 1);
    assert.equal(fixture.calls.saveScroll, 1);
    assert.equal(fixture.calls.saveBackScroll, 1);
    assert.equal(fixture.calls.recentCloseTime, 1);
    assert.equal(fixture.calls.modelDestroyed, 1);
});

test("removing a document source closes its Wnd tab immediately despite uploads and dirty titles", () => {
    for (const uploading of [false, true]) {
        const fixture = createCloseFixture();
        fixture.setUploading(uploading);
        assert.equal(fixture.remove(true, true), true);
        assert.equal(fixture.wnd.children.includes(fixture.tab), false);
        assert.equal(fixture.calls.headerRemovals, 1);
        assert.equal(fixture.calls.panelRemovals, 1);
        assert.equal(fixture.calls.modelDestroyed, 1);
        assert.equal(fixture.calls.socketClosed, 1);
        assert.equal(fixture.calls.windowCloseChecks, 1);
        assert.equal(fixture.timers.length, 0, "removed source content must not wait for a close animation");
        assert.equal(fixture.calls.uploadChecks, 0);
        assert.equal(fixture.calls.titleFlushes, 0);
        assert.equal(fixture.calls.bodyFlushes, 0);
        assert.equal(fixture.calls.windowFlushes, 0);
        assert.equal(fixture.calls.saveScroll, 0);
        assert.equal(fixture.calls.saveBackScroll, 0);
        assert.equal(fixture.calls.recentCloseTime, 0);
        assert.deepEqual(fixture.messages, []);
    }
});

for (const outcome of ["success", "failure"]) {
    test(`source removal invalidates a pending Wnd close before its late ${outcome}`, async () => {
        const fixture = createCloseFixture();
        fixture.remove();
        assert.equal(fixture.calls.titleFlushes, 1);
        assert.equal(fixture.calls.modelDestroyed, 0);
        fixture.setUploading(true);
        fixture.remove(true, true);
        assert.equal(fixture.wnd.children.includes(fixture.tab), false);
        assert.equal(fixture.calls.modelDestroyed, 1);
        if (outcome === "success") {
            fixture.resolveTitle();
        } else {
            fixture.rejectTitle();
        }
        await settleClose();
        assert.equal(fixture.wnd.children.length, 1);
        assert.equal(fixture.wnd.children[0].id, "other-tab");
        assert.equal(fixture.calls.headerRemovals, 1);
        assert.equal(fixture.calls.panelRemovals, 1);
        assert.equal(fixture.calls.modelDestroyed, 1);
        assert.equal(fixture.calls.socketClosed, 1);
        assert.equal(fixture.calls.windowCloseChecks, 1);
        assert.equal(fixture.calls.bodyFlushes, 0);
        assert.equal(fixture.calls.windowFlushes, 0);
        assert.equal(fixture.calls.saveScroll, 0);
        assert.equal(fixture.calls.saveBackScroll, 0);
        assert.equal(fixture.calls.recentCloseTime, 0);
        assert.deepEqual(fixture.messages, []);
    });
}

for (const outcome of ["success", "failure", "uploading"] as const) {
    test(`tab limit handles ${outcome} without retrying the same tab or overlapping checks`, async () => {
        const f = createCloseFixture();
        const next = {...f.tab, id: "next", model: undefined as undefined,
            headElement: {...f.tab.headElement, getAttribute: () => "1"}};
        const pinned = {...f.tab, id: "pinned", headElement: {...f.tab.headElement,
            classList: {contains: (name: string) => name === "item--pin"}}};
        f.wnd.children = [f.tab, next, pinned, {id: "without-header"}];
        if (outcome === "uploading") f.setUploading(true);
        const limiting = f.wnd.removeOverCounter();
        await f.wnd.removeOverCounter();
        if (outcome !== "uploading") {
            assert.equal(f.calls.titleFlushes, 1);
            assert.equal(f.wnd.children.includes(next), true, "wait before choosing another eviction candidate");
            if (outcome === "success") f.resolveTitle();
            else f.rejectTitle();
        }
        await limiting;
        assert.equal(f.wnd.children.includes(next), false, "continue past a blocked or failed candidate");
        assert.equal(f.wnd.children.includes(f.tab), outcome !== "success");
        assert.equal(f.wnd.children.includes(pinned), true);
        assert.equal(f.calls.uploadChecks, 1, "attempt each candidate once");
        assert.equal(f.wnd.removeTab("missing"), false);
        if (outcome !== "success") {
            f.setUploading(false);
            f.editor.protyle.title.flushPendingInput = () => undefined;
            await f.wnd.removeOverCounter();
            assert.equal(f.wnd.children.includes(f.tab), false, "a later check may retry after the blocker clears");
        }
    });
}

test("ordinary tabs without pending title work still close synchronously", () => {
    const f = createCloseFixture();
    f.editor.protyle.title.flushPendingInput = () => undefined;
    assert.equal(f.remove(), true);
    assert.equal(f.wnd.children.includes(f.tab), false);
});

for (const outcome of ["success", "failure", "uploading", "source-removed"] as const) {
    test(`batch history uses the actual Wnd close result for ${outcome}`, async () => {
        const f = createCloseFixture();
        if (outcome === "uploading") f.setUploading(true);
        const closing = f.batchClose();
        assert.equal(f.batchCloseRequests.length, 0);
        if (outcome === "source-removed") f.remove(true);
        if (outcome === "failure") f.rejectTitle();
        else f.resolveTitle();
        await closing;
        assert.equal(f.calls.recentCloseTime, 0, "batch closes must not also record individual history");
        assert.deepEqual(f.batchCloseRequests.map(ids => Array.from(ids)), outcome === "success" ? [["document"]] : []);
    });
}
