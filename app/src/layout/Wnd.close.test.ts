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

const createCloseFixture = () => {
    const calls = {
        titleFlushes: 0, bodyFlushes: 0, windowFlushes: 0, uploadChecks: 0,
        saveScroll: 0, saveBackScroll: 0, recentCloseTime: 0,
        headerRemovals: 0, panelRemovals: 0, modelDestroyed: 0, socketClosed: 0, windowCloseChecks: 0,
    };
    const messages: string[] = [];
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
        config: {readonly: false}, layout: {}, storage: {closedTabs: [] as object[]}, blockPanels: [] as object[],
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
        "./util": {isSensitiveTab: () => false, layoutToJSON() {}},
        "../protyle/util/compatibility": {sanitizeClosedTabs: (tabs: unknown[]) => tabs, setStorageVal() {}},
        "../util/backForward": {saveBackScroll: () => calls.saveBackScroll++},
        "../protyle/scroll/saveScroll": {saveScroll: () => calls.saveScroll++},
        "../util/fetch": {fetchPost: (url: string) => {
            if (url === "/api/storage/updateRecentDocCloseTime") calls.recentCloseTime++;
        }},
        "./tabUtil": {resizeTabs() {}},
    };
    const moduleExports = {} as {Wnd: new (app: object) => {
        children: {id: string}[];
        removeTab: (id: string, batch?: boolean, animate?: boolean, saveLayout?: boolean, sourceRemoved?: boolean) => void;
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
        headElement: {classList: {contains: () => false}, remove: () => calls.headerRemovals++, setAttribute() {}},
        panelElement: {remove: () => calls.panelRemovals++},
    };
    wnd.children = [tab, {id: "other-tab"}];
    const remove = (sourceRemoved = false, animate = false) => wnd.removeTab(tab.id, false, animate, false, sourceRemoved);
    return {wnd, tab, calls, messages, timers, remove,
        resolveTitle: () => resolveTitle(), rejectTitle: () => rejectTitle(new Error("Conflict")),
        setUploading: (value: boolean) => { uploading = value; }};
};

const settleClose = () => new Promise<void>(resolve => setImmediate(resolve));

test("ordinary Wnd close waits for title persistence and retains a failed editor", async () => {
    const fixture = createCloseFixture();
    fixture.remove();
    fixture.remove();
    assert.equal(fixture.calls.titleFlushes, 1);
    assert.equal(fixture.wnd.children.includes(fixture.tab), true);
    assert.equal(fixture.calls.windowFlushes, 0);
    fixture.rejectTitle();
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
    fixture.remove();
    assert.deepEqual(fixture.messages, ["Uploading"]);
    assert.equal(fixture.calls.titleFlushes, 0);
    assert.equal(fixture.wnd.children.includes(fixture.tab), true);
    fixture.setUploading(false);
    fixture.remove();
    fixture.resolveTitle();
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
        fixture.remove(true, true);
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
