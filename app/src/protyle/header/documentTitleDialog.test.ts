import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
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
        element = {dataset: {}, querySelector: (selector: string) =>
            selector === ".document-title-dialog" ? this.host : this.confirm};
        constructor(private options: {beforeClose: () => boolean, destroyCallback: () => void}) {
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
    };
    const load = (file: string) => {
        const source = require("ifdef-loader/preprocessor").parse(
            readFileSync(resolve(__dirname, file), "utf8"), {MOBILE: mobile, BROWSER: false});
        const exports: any = {};
        runInNewContext(transpileModule(source, {
            compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
        }).outputText, {exports, require: () => dependencies, window,
            document: {addEventListener: () => {}}, console: {error: () => {}}});
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
