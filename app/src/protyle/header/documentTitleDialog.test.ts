import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {resolve} from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {runInNewContext} from "node:vm";
import {compile} from "sass";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const deferred = () => {
    let resolve: () => void;
    let reject: (error: Error) => void;
    const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
    return {promise, resolve, reject};
};
const settle = () => new Promise<void>(resolve => setImmediate(resolve));

class ElementMock {
    dataset: Record<string, string> = {};
    content = "private title";
    isConnected = true;
    listeners = new Map<string, () => void>();
    addEventListener(type: string, callback: () => void) { this.listeners.set(type, callback); }
    removeEventListener(type: string) { this.listeners.delete(type); }
    replaceChildren() { this.content = ""; }
}

const setup = (mobile: boolean) => {
    const window = {siyuan: {
        dialogs: [] as any[], mobile: {}, layout: {}, blockPanels: [] as any[], ws: {app: {}},
        languages: {rename: "Rename", confirm: "Confirm", settingsPendingSaveError: "Save failed"},
    }};
    const messages: string[] = [];
    const ready: number[] = [];
    const guards: Array<{dispose: () => void, flush: () => Promise<void>, disposed: boolean}> = [];
    const instances: ProtyleMock[] = [];
    const viewport = {top: 0, bottom: 800};
    const resizeListeners = new Set<() => void>();
    let sheetClose: () => Promise<void>;
    let sheetResize: () => void;
    let sheetDisposals = 0;
    const keyboardToolbar = {hidden: true, top: 752, classList: {contains: () => keyboardToolbar.hidden},
        getBoundingClientRect: () => ({top: keyboardToolbar.top})};
    let toolbarObserver: () => void;
    let toolbarObserved = false;
    class MutationObserverMock {
        constructor(callback: () => void) { toolbarObserver = callback; }
        observe() { toolbarObserved = true; }
        disconnect() { toolbarObserved = false; }
    }
    Object.assign(window, {
        addEventListener: (_type: string, callback: () => void) => resizeListeners.add(callback),
        removeEventListener: (_type: string, callback: () => void) => resizeListeners.delete(callback),
    });
    let flush: (editor: ProtyleMock) => Promise<void> = async () => {};
    let flushGuard: () => Promise<void> = async () => {};
    let flushTitle: (editor: ProtyleMock) => Promise<void> = async () => {};
    class ProtyleMock {
        destroyed = 0;
        titleFlushes = 0;
        protyle: any;
        constructor(_app: unknown, element: ElementMock, options: {blockId: string, notebookId?: string}) {
            this.protyle = {element, notebookId: options.notebookId, block: {rootID: options.blockId}, wysiwyg: {},
                title: {flushPendingInput: () => { this.titleFlushes++; return flushTitle(this); }}};
            instances.push(this);
        }
        flushPendingTransactions() { return flush(this); }
        destroy() {
            this.destroyed++;
            secondary.unregisterMobileSecondaryEditor(this);
        }
    }
    class DialogMock {
        editors: any;
        host = new ElementMock();
        confirm = new ElementMock();
        destroyed = false;
        viewport = {style: {top: "", height: ""}};
        classes = new Set<string>();
        element = {dataset: {}, classList: {add: (name: string) => this.classes.add(name)},
            querySelector: (selector: string) => selector === ".b3-dialog" ? this.viewport :
                selector === ".document-title-dialog" ? this.host : this.confirm};
        constructor(public options: {beforeClose: () => boolean, destroyCallback: () => void,
            width?: string, height?: string, containerClassName?: string}) {
            window.siyuan.dialogs.push(this);
        }
        destroy() {
            if (this.destroyed || !this.options.beforeClose()) return;
            this.destroyed = true;
            this.options.destroyCallback();
            window.siyuan.dialogs.splice(window.siyuan.dialogs.indexOf(this), 1);
        }
    }
    const dependencies: Record<string, unknown> = {
        Dialog: DialogMock, Protyle: ProtyleMock, escapeHtml: (text: string) => text,
        Constants: {}, showMessage: (message: string) => messages.push(message),
        registerEditorSave: () => {
            const guard = {disposed: false, flush: () => flushGuard(), dispose: () => { guard.disposed = true; }};
            guards.push(guard);
            return guard;
        },
        ipcRenderer: {send: (_channel: string, id: number) => ready.push(id)},
        getVisibleViewportBounds: () => viewport,
        bindBottomSheetDialog: (_dialog: DialogMock, close: () => Promise<void>, resize: () => void) => {
            sheetClose = close;
            sheetResize = resize;
            resize();
            return () => { sheetDisposals++; };
        },
    };
    const load = (file: string) => {
        const source = require("ifdef-loader/preprocessor").parse(
            readFileSync(resolve(__dirname, file), "utf8"), {MOBILE: mobile, BROWSER: false});
        const exports: any = {};
        runInNewContext(transpileModule(source, {
            compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
        }).outputText, {exports, require: () => dependencies, window,
            document: {addEventListener: () => {}, getElementById: () => keyboardToolbar},
            MutationObserver: MutationObserverMock, console: {error: () => {}}});
        return exports;
    };
    const secondary = load("../../mobile/util/secondaryEditors.ts");
    Object.assign(dependencies, secondary);
    const registry = load("documentTitleDialogs.ts");
    Object.assign(dependencies, registry);
    const allEditors = load("../../layout/getAll.ts");
    Object.assign(dependencies, allEditors);
    const system = load("../../window/onWindowsMsg.ts");
    const titleDialog = load("documentTitleDialog.ts");
    return {window, messages, guards, instances, ready, secondary, registry, allEditors, system,
        viewport, resizeListeners, closeSheet: () => sheetClose(), resizeSheet: () => sheetResize(),
        sheetDisposals: () => sheetDisposals,
        keyboardToolbar, resizeToolbar: () => toolbarObserver(), toolbarObserved: () => toolbarObserved,
        open: (id = "doc", notebook: string | undefined = "encrypted") =>
            titleDialog.openDocumentTitleDialog({id, notebook}) as DialogMock,
        setFlush: (callback: typeof flush) => { flush = callback; },
        setGuard: (callback: typeof flushGuard) => { flushGuard = callback; },
        setTitle: (callback: typeof flushTitle) => { flushTitle = callback; }};
};

for (const mobile of [false, true]) {
    test(`title dialog participates in ${mobile ? "mobile" : "desktop"} editor saving before system lock`, async () => {
        const state = setup(mobile);
        const pending = deferred();
        let saves = 0;
        state.setFlush(() => { saves++; return pending.promise; });
        state.open();
        assert.equal(state.allEditors.getAllEditor().length, 1);
        state.system.onWindowsMsg({cmd: "prepareNotebookSystemLock", data: 42});
        assert.equal(saves, 1);
        assert.equal(state.ready.length, 0);
        pending.resolve();
        await settle();
        assert.deepEqual(state.ready, [42]);
        state.registry.closeDocumentTitleDialogs({notebookId: "encrypted"});
        assert.equal(state.allEditors.getAllEditor().length, 0);
    });

    test(`invalidated ${mobile ? "mobile" : "desktop"} title dialog clears plaintext despite a pending failed save`, async () => {
        const state = setup(mobile);
        const pending = deferred();
        state.setFlush(() => pending.promise);
        const dialog = state.open();
        dialog.destroy();
        assert.equal(dialog.destroyed, false);
        state.registry.closeDocumentTitleDialogs({notebookId: "other"});
        assert.equal(dialog.destroyed, false);
        state.registry.closeDocumentTitleDialogs({notebookId: "encrypted"});
        assert.equal(dialog.destroyed, true);
        assert.equal(dialog.host.content, "");
        assert.equal(state.instances[0].destroyed, 1);
        assert.equal(state.guards[0].disposed, true);
        assert.equal(state.allEditors.getAllEditor().length, 0);
        pending.reject(new Error("Notebook is locked"));
        await settle();
        assert.equal(state.messages.length, 0);
        assert.equal(state.instances[0].titleFlushes, 0);
        state.registry.closeDocumentTitleDialogs({rootIDs: ["doc"]});
        assert.equal(state.instances[0].destroyed, 1);
    });
}

test("title dialog rechecks title input after the save guard finishes and preserves save failures", async () => {
    const state = setup(false);
    const pending = deferred();
    let draft = "initial";
    let saved = "initial";
    state.setGuard(() => pending.promise);
    state.setTitle(async () => { saved = draft; });
    const dialog = state.open();
    dialog.destroy();
    await settle();
    draft = "typed while waiting";
    pending.resolve();
    await settle();
    assert.equal(saved, draft);
    assert.equal(dialog.destroyed, true);
    assert.equal(state.instances[0].titleFlushes, 1);

    state.setFlush(async () => { throw new Error("Conflict"); });
    const blocked = state.open("other");
    blocked.destroy();
    await settle();
    assert.equal(blocked.destroyed, false);
    assert.equal(blocked.host.content, "private title");
    assert.equal(state.messages.length, 1);
    state.registry.closeDocumentTitleDialogs({rootIDs: ["other"]});
});

test("mobile secondary title editing flushes the whole editor and supports forced removal", async () => {
    const state = setup(true);
    let saves = 0;
    state.setFlush(async () => { saves++; });
    const dialog = state.open();
    await state.secondary.flushMobileSecondaryEditor(state.instances[0]);
    assert.equal(saves, 1);
    assert.equal(state.secondary.removeMobileSecondaryEditor(state.instances[0]), true);
    assert.equal(dialog.destroyed, true);
    assert.equal(dialog.host.content, "");
    assert.equal(state.secondary.getMobileSecondaryEditors().length, 0);
});

test("source removal also closes title dialogs whose notebook identity has not arrived", () => {
    const state = setup(false);
    const dialog = state.open("loading", "");
    state.registry.closeDocumentTitleDialogs({notebookId: "encrypted"});
    assert.equal(dialog.destroyed, true);
    assert.equal(dialog.host.content, "");
});

test("mobile title drawer follows keyboard viewport changes and keeps failed drafts open", async () => {
    const state = setup(true);
    const dialog = state.open();
    assert.equal(dialog.options.width, "100vw");
    assert.equal(dialog.options.height, "auto");
    assert.equal(dialog.options.containerClassName, "mobile-document-title-sheet");
    assert.ok(dialog.classes.has("mobile-document-title-dialog"));
    assert.equal(dialog.viewport.style.height, "800px");
    state.viewport.top = 50;
    state.viewport.bottom = 350;
    state.resizeSheet();
    assert.equal(dialog.viewport.style.top, "50px");
    assert.equal(dialog.viewport.style.height, "300px");
    assert.equal(state.toolbarObserved(), true);
    state.keyboardToolbar.hidden = false;
    state.keyboardToolbar.top = 302;
    state.resizeToolbar();
    assert.equal(dialog.viewport.style.height, "252px");
    state.keyboardToolbar.top = 900;
    state.resizeToolbar();
    assert.equal(dialog.viewport.style.height, "300px", "offscreen toolbars cannot extend the visible viewport");
    state.keyboardToolbar.hidden = true;
    state.resizeToolbar();
    assert.equal(dialog.viewport.style.height, "300px");
    state.setTitle(async () => { throw new Error("Conflict"); });
    await state.closeSheet();
    assert.equal(dialog.destroyed, false);
    assert.equal(dialog.host.content, "private title");
    assert.equal(state.sheetDisposals(), 0);
    assert.equal(state.resizeListeners.size, 1);
    state.setTitle(async () => {});
    await state.closeSheet();
    assert.equal(dialog.destroyed, true);
    assert.equal(state.sheetDisposals(), 1);
    assert.equal(state.resizeListeners.size, 0);
    assert.equal(state.toolbarObserved(), false);
});

test("mobile title drawer releases viewport bindings immediately when its notebook locks", () => {
    const state = setup(true);
    const dialog = state.open();
    state.registry.closeDocumentTitleDialogs({notebookId: "encrypted"});
    assert.equal(dialog.destroyed, true);
    assert.equal(dialog.host.content, "");
    assert.equal(state.sheetDisposals(), 1);
    assert.equal(state.resizeListeners.size, 0);
    assert.equal(state.toolbarObserved(), false);
});

test("desktop title editing retains the centered dialog without mobile viewport bindings", () => {
    const state = setup(false);
    const dialog = state.open();
    assert.equal(dialog.options.width, "560px");
    assert.equal(dialog.options.height, undefined);
    assert.equal(dialog.classes.size, 0);
    assert.equal(state.resizeListeners.size, 0);
});

const checkDrawerLayout = (css: string) => {
    const check: typeof assert = require("node:assert/strict");
    document.head.innerHTML = `<style>${css}</style>`;
    document.body.style.cssText = "--b3-font-size:16px;--b3-font-size-editor:16px;--mobile-top-safe-area:0px";
    document.body.innerHTML = `<div class="mobile-document-title-dialog mobile-bottom-sheet-dialog b3-dialog--open">
<div class="b3-dialog"><div class="b3-dialog__scrim"></div>
<div class="b3-dialog__container mobile-bottom-sheet mobile-document-title-sheet" style="width:100vw;height:auto;transition:none">
<div class="b3-menu__title b3-menu__title--root"></div><div class="b3-dialog__header">Rename</div>
<div class="b3-dialog__body"><div class="document-title-dialog protyle">
<div class="protyle-content"><div class="protyle-top"><div class="protyle-title">
<div class="protyle-title__rich protyle"><div class="protyle-content"><div class="protyle-wysiwyg">
<div data-type="NodeParagraph" class="p"><div class="protyle-title__input" contenteditable="true"></div></div>
</div></div></div></div></div><div class="protyle-wysiwyg">Hidden document body</div></div></div>
<div class="b3-dialog__action"><button class="b3-button b3-button--text">Confirm</button></div></div></div></div></div>`;
    const container = document.querySelector<HTMLElement>(".b3-dialog");
    const sheet = document.querySelector<HTMLElement>(".mobile-document-title-sheet");
    const host = document.querySelector<HTMLElement>(".document-title-dialog");
    const editable = document.querySelector<HTMLElement>("[contenteditable]");
    const action = document.querySelector<HTMLElement>(".b3-dialog__action");
    for (const height of [800, 350, 220]) {
        container.style.top = "30px";
        container.style.height = `${height}px`;
        for (const large of [false, true]) {
            document.body.style.setProperty("--b3-font-size-editor", large ? "32px" : "16px");
            for (const long of [false, true]) {
                editable.innerHTML = long ? "<strong>Rich title </strong><em>with styles </em>".repeat(50) : "Untitled document";
                const rect = sheet.getBoundingClientRect();
                const button = action.getBoundingClientRect();
                const editor = host.getBoundingClientRect();
                const context = JSON.stringify({height, large, long, sheet: rect.toJSON(), button: button.toJSON()});
                check.ok(rect.height > 0 && rect.height <= height + 1, context);
                check.ok(Math.abs(rect.bottom - (30 + height)) < 1, context);
                check.ok(button.top >= rect.top && button.bottom <= rect.bottom + 1 && button.height >= 30, context);
                check.ok(editor.bottom <= button.top + 1 && editor.height > 0, context);
                if (long) {
                    check.ok(host.scrollHeight > host.clientHeight || host.firstElementChild.scrollHeight >
                        host.firstElementChild.clientHeight, "long rich titles remain scrollable: " + context);
                } else if (height === 800 && !large) {
                    check.ok(rect.height < 250, "short title does not reserve a full editor: " + context);
                }
            }
        }
    }
    editable.textContent = "";
    editable.dataset.tip = "Untitled document";
    editable.focus();
    check.equal(document.activeElement, editable);
    check.equal(getComputedStyle(editable, "::after").content, '"Untitled document"');
    check.equal(document.querySelector<HTMLElement>(".document-title-dialog > .protyle-content > .protyle-wysiwyg").offsetHeight, 0);
    return "Title drawer layout passed";
};

test("native mobile title drawer keeps its action above the keyboard and scrolls long rich titles", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 30000,
}, async () => {
    const css = compile(resolve(__dirname, "../../assets/scss/mobile.scss"), {logger: {warn() {}, debug() {}}}).css;
    const directory = mkdtempSync(resolve(tmpdir(), "siyuan-title-drawer-"));
    const script = resolve(directory, "run.cjs");
    const code = "const __name = value => value; (" + checkDrawerLayout.toString() + ")(" + JSON.stringify(css) + ")";
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(resolve(directory, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show:false, width:390, height:900, webPreferences:{nodeIntegration:true, contextIsolation:false}});
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(code)}));
        win.destroy(); app.exit(0);
    } catch(error) { console.error(error); win.destroy(); app.exit(1); }
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron") as unknown as string, [script],
            {env, windowsHide: true, timeout: 25000});
        assert.match(result.stdout, /Title drawer layout passed/);
    } finally {
        if (resolve(directory, "..") === resolve(tmpdir()) && directory.startsWith(resolve(tmpdir(), "siyuan-title-drawer-"))) {
            rmSync(directory, {recursive: true, force: true});
        }
    }
});
