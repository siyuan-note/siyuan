import * as assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {compile} from "sass";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const transpile = (file: string) => transpileModule(readFileSync(join(__dirname, file), "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2020},
}).outputText;
const referenceSource = transpile("openReference.ts");
const dialogSource = transpile("MobileEditorDialog.ts");
const sheetSource = transpile("bindBottomSheetDialog.ts");
const saveSource = transpile("../../protyle/util/editorSave.ts");
const editorSessionSource = transpile("../../protyle/render/av/editorSession.ts");
const cellEditorSource = transpile("../../protyle/render/av/cellEditor.ts");

const deferred = <T>() => {
    let resolve: (value: T) => void;
    let reject: (error: Error) => void;
    const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
    return {promise, resolve, reject};
};

class EventTargetMock {
    listeners = new Map<string, Set<() => void>>();
    addEventListener(type: string, callback: () => void) {
        if (!this.listeners.has(type)) {
            this.listeners.set(type, new Set());
        }
        this.listeners.get(type).add(callback);
    }
    removeEventListener(type: string, callback: () => void) { this.listeners.get(type)?.delete(callback); }
    dispatch(type: string) { this.listeners.get(type)?.forEach(callback => callback()); }
    listenerCount() { return Array.from(this.listeners.values()).reduce((sum, callbacks) => sum + callbacks.size, 0); }
}

class ElementMock extends EventTargetMock {
    isConnected = true;
    parentElement?: ElementMock;
    dataset: Record<string, string> = {};
    blurred = false;
    style: Record<string, string> = {};
    attributes = new Map<string, string>();
    classes = new Set<string>();
    classList = {
        add: (name: string) => this.classes.add(name),
        remove: (name: string) => this.classes.delete(name),
        contains: (name: string) => this.classes.has(name),
        toggle: (name: string, enabled: boolean) => enabled ? this.classes.add(name) : this.classes.delete(name),
    };
    children = new Map<string, ElementMock>();
    cleared = false;
    setAttribute(name: string, value: string) { this.attributes.set(name, value); }
    hasAttribute(name: string) { return this.attributes.has(name); }
    removeAttribute(name: string) { this.attributes.delete(name); }
    querySelector(selector: string) { return this.children.get(selector); }
    querySelectorAll(selector: string): ElementMock[] {
        return selector === "[data-node-id]" ? Array.from(this.children.values()).flatMap(child =>
            [...child.dataset.nodeId ? [child] : [], ...child.querySelectorAll(selector)]) : [];
    }
    prepend(element: ElementMock) { this.children.set("handle", element); }
    remove() { this.isConnected = false; }
    contains(element: ElementMock): boolean {
        return this === element || Array.from(this.children.values()).some(child => child.contains(element));
    }
    dispatchEvent(event: {type: string, bubbles?: boolean}) {
        this.dispatch(event.type);
        if (event.bubbles) {
            this.parentElement?.dispatchEvent(event);
        }
        return true;
    }
    blur() { this.blurred = true; }
    replaceChildren() { this.cleared = true; this.children.clear(); }
}

const setup = (readonly = false) => {
    const requests: Array<ReturnType<typeof deferred<any>> & {id: string}> = [];
    const messages: string[] = [];
    const dialogs: DialogMock[] = [];
    const editors: ProtyleMock[] = [];
    const registered = new Map<ProtyleMock, () => void>();
    const destroyCallbacks: Array<() => void> = [];
    const flushes: ProtyleMock[] = [];
    const refreshed: any[] = [];
    const titleEvents: string[] = [];
    const cellMasks: ElementMock[] = [];
    let flush: (editor: ProtyleMock) => Promise<void> = () => Promise.resolve();
    let disposedBindings = 0;
    const viewport = {top: 0, bottom: 800};
    const document = {activeElement: new ElementMock(), createElement: () => new ElementMock(),
        querySelectorAll: (selector: string) => {
            assert.ok([".av__mask, [data-av-location-editor]",
                ".av__mask:not(.av__richtext-mask), [data-av-location-editor]"].includes(selector));
            return cellMasks.filter(mask => mask.isConnected &&
                (selector.startsWith(".av__mask,") || !mask.classList.contains("av__richtext-mask")));
        }};
    const window = Object.assign(new EventTargetMock(), {
        innerHeight: 800,
        visualViewport: Object.assign(new EventTargetMock(), {offsetTop: 0, height: 800}),
        siyuan: {config: {readonly}, languages: {viewRefContent: "Reference", refExpired: "Expired", uploading: "Uploading",
            settingsPendingSaveError: "Pending save failed"},
            menus: {menu: {remove() {}}}, mobile: {size: {isLandscape: false, portrait: {height1: 800}}}},
    });
    class DialogMock {
        element = new ElementMock();
        destroyed = 0;
        constructor(public options: any) {
            for (const selector of [".b3-dialog", ".b3-dialog__body", ".b3-dialog__container", ".b3-dialog__scrim",
                ".mobile-reference-editor"]) {
                this.element.children.set(selector, new ElementMock());
            }
            this.element.querySelector(".b3-dialog__container").children.set(".b3-dialog__header", new ElementMock());
            this.element.classList.add("b3-dialog--open");
            dialogs.push(this);
        }
        destroy() {
            if (!this.destroyed) {
                this.destroyed++;
                destroyCallbacks.push(() => { this.element.isConnected = false; this.options.destroyCallback?.(); });
            }
        }
    }
    class ProtyleMock {
        protyle: any;
        destroyed = 0;
        uploading = false;
        constructor(public app: unknown, element: ElementMock, public options: any) {
            this.protyle = {app, element, contentElement: {scrollTop: 0, scrollLeft: 0},
                block: {id: options.blockId, rootID: options.rootId}, notebookId: options.notebookId,
                disabled: readonly, options, id: `editor-${editors.length}`, path: `/${options.rootId}.sy`,
                title: options.render.title ? {flushPendingInput: () => titleEvents.push("flush"),
                    cancelPendingInput: () => titleEvents.push("cancel")} : undefined};
            editors.push(this);
        }
        enable() { assert.fail("The drawer must not override the editor's readonly policy"); }
        isUploading() { return this.uploading; }
        destroy() { this.destroyed++; registered.delete(this); }
    }
    const dialogAPI = {} as typeof import("./MobileEditorDialog");
    const sheetAPI = {} as typeof import("./bindBottomSheetDialog");
    const saveAPI = {} as typeof import("../../protyle/util/editorSave");
    const editorSessionAPI = {} as typeof import("../../protyle/render/av/editorSession");
    const cellEditorAPI = {} as typeof import("../../protyle/render/av/cellEditor");
    const api = {} as typeof import("./openReference");
    const modules: Record<string, unknown> = {
        "../../dialog": {Dialog: DialogMock},
        "../../dialog/message": {showMessage: (value: string) => messages.push(value)},
        "../../util/escape": {escapeHtml: (value: string) => value.replace(/</g, "&lt;").replace(/>/g, "&gt;")},
        "../../constants": {Constants: {CB_GET_ALL: "all", CB_GET_CONTEXT: "context"}},
        "../../protyle": {Protyle: ProtyleMock},
        "../../protyle/util/editorSave": saveAPI,
        "../../protyle/render/av/editorSession": editorSessionAPI,
        "../../protyle/render/av/cellEditor": cellEditorAPI,
        "../../util/fetch": {fetchSyncPost: (url: string, data: {id: string}) => {
            assert.equal(url, "/api/block/getBlockInfo");
            const request = {...deferred<any>(), id: data.id};
            requests.push(request);
            return request.promise;
        }},
        "./MobileEditorDialog": dialogAPI,
        "./bindBottomSheetDialog": sheetAPI,
        "./bindBottomSheetDrag": {bindBottomSheetDrag: () => () => { disposedBindings++; }},
        "../../menus/sheetOpen": {waitForSheetViewport: (options: {open: () => void}) => {
            options.open();
            return () => {};
        }},
        "./keyboardToolbar": {activeBlur: () => { document.activeElement = new ElementMock(); }},
        "./secondaryEditors": {
            registerMobileSecondaryEditor: (editor: ProtyleMock, remove: () => void) => registered.set(editor, remove),
            flushMobileSecondaryEditor: (editor: ProtyleMock) => { flushes.push(editor); return flush(editor); },
        },
        "./visibleViewport": {getVisibleViewportBounds: () => viewport},
        "../../protyle/scroll/saveScroll": {saveScroll: () => ({scrollTop: 30}),
            getDocByScroll: (options: unknown) => refreshed.push(options)},
    };
    const globals = {window, document, console, CustomEvent, MutationObserver: class {
        observe() {}
        disconnect() {}
    }, require: (name: string) => {
        assert.ok(modules[name], `Unexpected module: ${name}`);
        return modules[name];
    }};
    runInNewContext(dialogSource, {...globals, exports: dialogAPI});
    runInNewContext(sheetSource, {...globals, exports: sheetAPI});
    runInNewContext(saveSource, {...globals, exports: saveAPI});
    runInNewContext(editorSessionSource, {...globals, exports: editorSessionAPI});
    runInNewContext(cellEditorSource, {...globals, exports: cellEditorAPI});
    runInNewContext(referenceSource, {...globals, exports: api});
    const source = {app: {}, element: new ElementMock(), block: {id: "origin-block", rootID: "origin-root"},
        notebookId: "origin-box", contentElement: {scrollTop: 247, scrollLeft: 13}} as unknown as IProtyle;
    const answer = (index: number, rootID = "target-root", box = "target-box") =>
        requests[index].resolve({code: 0, data: {rootID, box}});
    const open = async (blockId = "target-block", protyle = source, rootID = "target-root") => {
        const opening = api.openMobileReference(protyle, blockId);
        answer(requests.length - 1, rootID);
        await opening;
    };
    return {...api, ...dialogAPI, ...saveAPI, ...editorSessionAPI, ...cellEditorAPI,
        source, requests, messages, editors, registered, flushes, refreshed, titleEvents, cellMasks, viewport,
        window, document, answer, open,
        dialogs: dialogs as Array<DialogMock & import("./MobileEditorDialog").MobileEditorDialog>,
        setFlush: (callback: typeof flush) => { flush = callback; },
        finishDestroy: () => { destroyCallbacks.splice(0).forEach(callback => callback()); },
        disposedBindings: () => disposedBindings};
};

test("only the latest resolved reference opens, without changing the original document or scroll", async () => {
    const fixture = setup();
    const first = fixture.openMobileReference(fixture.source, "first");
    const second = fixture.openMobileReference(fixture.source, "second");
    fixture.answer(1, "second-root");
    await second;
    fixture.answer(0, "first-root");
    await first;
    assert.equal(fixture.editors.length, 1);
    assert.equal(fixture.editors[0].options.blockId, "second");
    assert.equal(fixture.source.block.id, "origin-block");
    assert.equal(fixture.source.contentElement.scrollTop, 247);
    assert.equal(fixture.source.contentElement.scrollLeft, 13);
});

test("late reference responses cannot reopen after the source changes or a notebook locks", async () => {
    for (const invalidation of ["detach", "root", "block", "notebook", "lock"]) {
        const fixture = setup();
        const opening = fixture.openMobileReference(fixture.source, "target");
        if (invalidation === "detach") {
            (fixture.source.element as unknown as ElementMock).isConnected = false;
        } else if (invalidation === "root") {
            fixture.source.block.rootID = "changed-root";
        } else if (invalidation === "block") {
            fixture.source.block.id = "changed-block";
        } else if (invalidation === "notebook") {
            fixture.source.notebookId = "changed-notebook";
        } else {
            fixture.removeMobileReferenceSheet({notebookId: "origin-box"});
        }
        fixture.answer(0);
        await opening;
        assert.equal(fixture.editors.length, 0, invalidation);
        assert.equal(fixture.dialogs.length, 0, invalidation);
    }
});

test("reference editors load whole blocks or ordinary documents and preserve readonly policy", async () => {
    for (const readonly of [false, true]) {
        for (const blockId of ["target-block", "target-root"]) {
            const fixture = setup(readonly);
            await fixture.open(blockId);
            assert.equal(fixture.dialogs[0].options.hideCloseIcon, true);
            const editor = fixture.editors[0];
            assert.deepEqual(Array.from(editor.options.action), [blockId === "target-root" ? "context" : "all"]);
            assert.equal(editor.options.render.title, blockId === "target-root");
            assert.equal(editor.options.render.scroll, true);
            assert.equal(editor.options.render.gutter, true);
            assert.equal(editor.options.databaseAttr, true);
            assert.equal(editor.options.render.breadcrumb, false);
            assert.equal(editor.options.render.background, false);
            assert.equal(editor.options.typewriterMode, false);
            assert.equal(editor.options.rootId, "target-root");
            assert.equal(editor.options.notebookId, "target-box");
            assert.equal(Object.prototype.hasOwnProperty.call(editor.options, "readonly"), false);
            assert.equal(Object.prototype.hasOwnProperty.call(editor.options, "disabled"), false);
            assert.equal(editor.protyle.disabled, readonly);
        }
    }
});

test("nested reference replacement waits for save and preserves the original reading position", async () => {
    const fixture = setup();
    await fixture.open();
    const oldEditor = fixture.editors[0];
    const oldDialog = fixture.dialogs[0];
    const save = deferred<void>();
    fixture.setFlush(() => save.promise);
    const opening = fixture.openMobileReference(oldEditor.protyle, "nested-block");
    fixture.answer(1, "nested-root");
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(fixture.flushes, [oldEditor]);
    assert.equal(fixture.editors.length, 1);
    assert.equal(oldEditor.destroyed, 0);
    assert.equal(oldDialog.element.hasAttribute("inert"), true);
    save.resolve();
    await opening;
    assert.equal(oldEditor.destroyed, 1);
    assert.equal(fixture.editors.length, 2);
    assert.equal(fixture.registered.size, 1);
    fixture.finishDestroy();
    fixture.source.contentElement.scrollTop = 999;
    fixture.source.contentElement.scrollLeft = 50;
    fixture.setFlush(() => Promise.resolve());
    await fixture.dialogs[1].close();
    fixture.finishDestroy();
    assert.equal(fixture.source.contentElement.scrollTop, 247);
    assert.equal(fixture.source.contentElement.scrollLeft, 13);
    assert.equal(fixture.editors[1].destroyed, 1);
    assert.equal(fixture.registered.size, 0);
});

test("closing a drawer invalidates a nested reference lookup that has not resolved yet", async () => {
    const fixture = setup();
    await fixture.open();
    const editor = fixture.editors[0];
    const opening = fixture.openMobileReference(editor.protyle, "nested-block");
    await fixture.dialogs[0].close();
    assert.equal(editor.destroyed, 1);
    assert.equal(fixture.source.element.isConnected, true);
    assert.equal(fixture.source.block.rootID, "origin-root");
    fixture.answer(1, "nested-root");
    await opening;
    fixture.finishDestroy();
    assert.equal(fixture.editors.length, 1);
    assert.equal(fixture.dialogs.length, 1);
    assert.equal(fixture.registered.size, 0);
    assert.equal(fixture.closeMobileEditorSheets(), undefined);
    assert.equal(fixture.source.contentElement.scrollTop, 247);
    assert.deepEqual(fixture.messages, []);
});

test("a failed save retains the reference content, removes inert, and allows close retry", async () => {
    const fixture = setup();
    await fixture.open();
    const editor = fixture.editors[0];
    const dialog = fixture.dialogs[0];
    fixture.setFlush(() => Promise.reject(new Error("<offline>")));
    await assert.rejects(dialog.close(), /offline/);
    assert.equal(dialog.destroyed, 0);
    assert.equal(editor.destroyed, 0);
    assert.equal(dialog.element.hasAttribute("inert"), false);
    assert.equal(dialog.element.querySelector(".b3-dialog__body").cleared, false);
    assert.equal(fixture.registered.has(editor), true);
    assert.deepEqual(fixture.messages, ["Error: &lt;offline&gt;"]);
    fixture.setFlush(() => Promise.resolve());
    await fixture.closeMobileEditorSheets();
    fixture.finishDestroy();
    assert.equal(editor.destroyed, 1);
    assert.equal(fixture.registered.size, 0);
});

test("raw transaction and title-save failures keep the drawer open until a successful retry", async () => {
    for (const operation of ["transaction", "title"]) {
        const fixture = setup();
        await fixture.open("target-root");
        const editor = fixture.editors[0];
        const dialog = fixture.dialogs[0];
        const transaction = {doOperations: [{action: "update", id: "target-block", data: "edited content"}]};
        const url = operation === "transaction" ? "/api/transactions" : "/api/filetree/renameDoc";
        const payload = operation === "transaction" ? {session: editor.protyle.id, transactions: [transaction]} :
            {notebook: editor.protyle.notebookId, path: editor.protyle.path, title: "Edited title"};
        // Transactions with code 0 but no acknowledged operations must not discard editor content either.
        await fixture.trackEditorSaveRequest(url, payload, Promise.resolve({code: operation === "transaction" ? 0 : 1}));
        await assert.rejects(dialog.close(), /Pending save failed/);
        assert.equal(editor.destroyed, 0);
        assert.equal(dialog.element.hasAttribute("inert"), false);
        assert.equal(fixture.registered.has(editor), true);
        assert.deepEqual(fixture.titleEvents, ["flush"]);
        await fixture.trackEditorSaveRequest(url, payload, Promise.resolve({code: 0, data: [transaction]}));
        await dialog.close();
        assert.equal(editor.destroyed, 1);
        assert.deepEqual(fixture.titleEvents, ["flush", "flush", "cancel"]);
    }
});

test("closing waits for the actual transaction acknowledgement after pending input has flushed", async () => {
    const fixture = setup();
    await fixture.open();
    const editor = fixture.editors[0];
    const transaction = {doOperations: [{action: "update", id: "target-block", data: "edited content"}]};
    const response = deferred<{code: number, data: typeof transaction[]}>();
    fixture.trackEditorSaveRequest("/api/transactions", {session: editor.protyle.id, transactions: [transaction]}, response.promise);
    const closing = fixture.dialogs[0].close();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(fixture.flushes.length, 1);
    assert.equal(editor.destroyed, 0);
    assert.equal(fixture.dialogs[0].element.hasAttribute("inert"), true);
    response.resolve({code: 0, data: [transaction]});
    await closing;
    assert.equal(editor.destroyed, 1);
});

test("locking a document cancels pending title input instead of transmitting its rename", async () => {
    const fixture = setup();
    await fixture.open("target-root");
    fixture.removeMobileReferenceSheet({notebookId: "target-box"});
    assert.deepEqual(fixture.titleEvents, ["cancel"]);
    assert.equal(fixture.flushes.length, 0);
    assert.equal(fixture.editors[0].destroyed, 1);
});

test("close keeps nested richtext controls usable until every child editor has finished", async () => {
    const fixture = setup();
    await fixture.open("target-root");
    const editor = fixture.editors[0];
    const dialog = fixture.dialogs[0];
    const owner = new ElementMock();
    owner.parentElement = editor.protyle.element;
    editor.protyle.element.children.set("database-block", owner);
    const firstDone = fixture.beginAVEditorSession(owner as unknown as HTMLElement);
    const secondDone = fixture.beginAVEditorSession(owner as unknown as HTMLElement);
    const closing = dialog.close();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(dialog.element.hasAttribute("inert"), false);
    assert.equal(editor.protyle.element.listenerCount(), 1);
    assert.equal(editor.destroyed, 0);
    assert.equal(fixture.flushes.length, 0);
    assert.deepEqual(fixture.titleEvents, []);
    firstDone();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(dialog.element.hasAttribute("inert"), false);
    assert.equal(editor.protyle.element.listenerCount(), 1);
    assert.equal(fixture.flushes.length, 0);
    secondDone();
    await closing;
    assert.equal(editor.protyle.element.listenerCount(), 0);
    assert.equal(editor.destroyed, 1);
    assert.deepEqual(fixture.flushes, [editor]);
    assert.deepEqual(fixture.titleEvents, ["flush", "cancel"]);
});

test("locking while a child editor is open releases the close waiter and removes its listeners", async () => {
    const fixture = setup();
    await fixture.open("target-root");
    const editor = fixture.editors[0];
    const dialog = fixture.dialogs[0];
    const childDone = fixture.beginAVEditorSession(editor.protyle.element);
    const closing = dialog.close();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(editor.protyle.element.listenerCount(), 1);
    fixture.removeMobileReferenceSheet({notebookId: "target-box"});
    await closing;
    fixture.finishDestroy();
    assert.equal(editor.protyle.element.listenerCount(), 0);
    assert.equal(fixture.window.listenerCount(), 0);
    assert.equal(fixture.window.visualViewport.listenerCount(), 0);
    assert.equal(editor.destroyed, 1);
    assert.equal(dialog.destroyed, 1);
    assert.equal(dialog.element.querySelector(".b3-dialog__body").cleared, true);
    assert.deepEqual(fixture.titleEvents, ["cancel"]);
    assert.equal(fixture.flushes.length, 0);
    childDone();
    await Promise.resolve();
    assert.equal(fixture.flushes.length, 0);
    assert.equal(fixture.closeMobileEditorSheets(), undefined);
});

test("close commits only this drawer's plain database cell and ends composition before saving", async () => {
    const fixture = setup();
    await fixture.open();
    const editor = fixture.editors[0];
    const block = new ElementMock();
    block.dataset.nodeId = "drawer-database";
    editor.protyle.element.children.set("database", block);
    const ownCell = new ElementMock();
    ownCell.dataset.avBlockId = "drawer-database";
    const otherCell = new ElementMock();
    otherCell.dataset.avBlockId = "other-database";
    const richtext = new ElementMock();
    richtext.dataset.avBlockId = "drawer-database";
    richtext.classList.add("av__richtext-mask");
    const input = new ElementMock();
    ownCell.children.set("input", input);
    fixture.document.activeElement = input;
    fixture.cellMasks.push(ownCell, otherCell, richtext);
    const closed: string[] = [];
    ownCell.addEventListener(fixture.AV_CELL_EDITOR_CLOSE_EVENT, () => {
        assert.equal(input.blurred, true);
        closed.push("own");
    });
    otherCell.addEventListener(fixture.AV_CELL_EDITOR_CLOSE_EVENT, () => closed.push("other"));
    richtext.addEventListener(fixture.AV_CELL_EDITOR_CLOSE_EVENT, () => closed.push("richtext"));
    fixture.setFlush(() => {
        assert.deepEqual(closed, ["own"]);
        return Promise.resolve();
    });
    await fixture.dialogs[0].close();
    assert.deepEqual(closed, ["own"]);
    assert.equal(editor.destroyed, 1);
});

test("locking removes this drawer's plain and richtext cell masks without submitting either draft", async () => {
    const fixture = setup();
    await fixture.open();
    const block = new ElementMock();
    block.dataset.nodeId = "drawer-database";
    fixture.editors[0].protyle.element.children.set("database", block);
    const ownCell = new ElementMock();
    ownCell.dataset.avBlockId = "drawer-database";
    const richtext = new ElementMock();
    richtext.dataset.avBlockId = "drawer-database";
    richtext.classList.add("av__richtext-mask");
    const otherCell = new ElementMock();
    otherCell.dataset.avBlockId = "other-database";
    const input = new ElementMock();
    ownCell.children.set("input", input);
    fixture.document.activeElement = input;
    fixture.cellMasks.push(ownCell, richtext, otherCell);
    for (const mask of fixture.cellMasks) {
        mask.addEventListener(fixture.AV_CELL_EDITOR_CLOSE_EVENT, () => assert.fail("Lock must not submit cell drafts"));
    }
    fixture.removeMobileReferenceSheet({notebookId: "target-box"});
    assert.equal(ownCell.isConnected, false);
    assert.equal(richtext.isConnected, false);
    assert.equal(otherCell.isConnected, true);
    assert.equal(input.blurred, false);
    assert.equal(fixture.flushes.length, 0);
});

test("locking either notebook or removing either document clears content without waiting for a save", async () => {
    for (const options of [{notebookId: "origin-box"}, {notebookId: "target-box"},
        {rootIDs: ["origin-root"]}, {rootIDs: ["target-root"]}]) {
        const fixture = setup();
        await fixture.open();
        const dialog = fixture.dialogs[0];
        const editor = fixture.editors[0];
        fixture.setFlush(() => { assert.fail("Lock/removal must bypass saving inaccessible content"); });
        fixture.removeMobileReferenceSheet(options);
        assert.equal(dialog.element.querySelector(".b3-dialog__body").cleared, true);
        assert.equal(editor.destroyed, 1);
        assert.equal(dialog.destroyed, 1);
        assert.equal(fixture.registered.size, 0);
        assert.equal(fixture.closeMobileEditorSheets(), undefined);
        fixture.finishDestroy();
        assert.equal(editor.destroyed, 1);
    }
});

test("an active upload prevents closing or replacing the drawer until the upload finishes", async () => {
    const fixture = setup();
    await fixture.open();
    fixture.editors[0].uploading = true;
    await assert.rejects(fixture.dialogs[0].close(), /Uploading/);
    assert.equal(fixture.flushes.length, 0);
    assert.equal(fixture.editors[0].destroyed, 0);
    assert.equal(fixture.dialogs[0].element.hasAttribute("inert"), false);
    await fixture.open("nested", fixture.editors[0].protyle, "nested-root");
    assert.equal(fixture.editors.length, 1);
    fixture.editors[0].uploading = false;
    await fixture.dialogs[0].close();
    assert.equal(fixture.editors[0].destroyed, 1);
});

test("unrelated removals leave the current reference editor available", async () => {
    const fixture = setup();
    await fixture.open();
    fixture.removeMobileReferenceSheet({notebookId: "other-box", rootIDs: ["other-root"]});
    assert.equal(fixture.editors[0].destroyed, 0);
    assert.equal(fixture.dialogs[0].element.querySelector(".b3-dialog__body").cleared, false);
    assert.equal(fixture.registered.size, 1);
});

test("removal during initial editor loading uses the resolved target root", async () => {
    for (const removeFromRegistry of [false, true]) {
        const fixture = setup();
        await fixture.open();
        const editor = fixture.editors[0];
        editor.protyle.block.rootID = "";
        if (removeFromRegistry) {
            fixture.registered.get(editor)();
        } else {
            fixture.removeMobileReferenceSheet({rootIDs: ["target-root"]});
        }
        assert.equal(editor.destroyed, 1);
        assert.equal(fixture.dialogs[0].element.querySelector(".b3-dialog__body").cleared, true);
        assert.equal(fixture.closeMobileEditorSheets(), undefined);
    }
});

test("navigation invalidates an in-flight reference even when the source element is still attached", async () => {
    const fixture = setup();
    const opening = fixture.openMobileReference(fixture.source, "target");
    fixture.invalidateMobileReferenceOpen();
    fixture.answer(0);
    await opening;
    assert.equal(fixture.editors.length, 0);
});

test("viewport changes preserve the original scroll and all resize listeners are removed on close", async () => {
    const fixture = setup();
    await fixture.open();
    const dialog = fixture.dialogs[0];
    const container = dialog.element.querySelector(".b3-dialog");
    assert.equal(dialog.options.height, "60%");
    assert.equal(container.style.height, "800px");
    assert.equal(fixture.window.listenerCount(), 1);
    assert.equal(fixture.window.visualViewport.listenerCount(), 2);
    fixture.viewport.top = 90;
    fixture.viewport.bottom = 440;
    fixture.source.contentElement.scrollTop = 500;
    fixture.window.visualViewport.dispatch("resize");
    assert.equal(container.style.top, "90px");
    assert.equal(container.style.height, "350px");
    assert.equal(dialog.element.classList.contains("mobile-reference-dialog--compact"), true);
    assert.equal(fixture.source.contentElement.scrollTop, 247);
    await dialog.close();
    fixture.finishDestroy();
    assert.equal(fixture.window.listenerCount(), 0);
    assert.equal(fixture.window.visualViewport.listenerCount(), 0);
    assert.equal(fixture.disposedBindings(), 1);
    fixture.viewport.bottom = 700;
    fixture.window.dispatch("resize");
    assert.equal(container.style.height, "350px");
});

test("refresh waits for pending input and ignores content invalidated while saving", async () => {
    const fixture = setup();
    await fixture.open();
    const save = deferred<void>();
    fixture.setFlush(() => save.promise);
    fixture.refreshMobileReferenceSheet(["target-root"], true);
    assert.equal(fixture.refreshed.length, 0);
    fixture.removeMobileReferenceSheet({rootIDs: ["target-root"]});
    save.resolve();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(fixture.refreshed.length, 0);
});

const mobileCSS = () => compile(join(__dirname, "../../assets/scss/main/_mobile.scss"), {
    logger: {warn() {}, debug() {}},
}).css;

test("reference stylesheet uses the visible container percentage rather than a full-screen viewport unit", () => {
    const css = mobileCSS();
    const referenceRule = css.match(/\.mobile-reference-dialog \.mobile-reference-sheet\s*\{([^}]+)\}/);
    assert.ok(referenceRule);
    assert.match(referenceRule[1], /max-height:\s*60%\s*;/);
    assert.doesNotMatch(referenceRule[1], /(?:min-)?height:\s*\d+(?:d?vh|px)\s*;/);
    assert.match(css, /\.mobile-reference-dialog--compact \.b3-dialog__header\s*\{\s*display:\s*none;/);
});

// Browser verification is opt-in because the regular unit suite also runs in socket-restricted environments.
const chromium = process.env.CHROMIUM_PATH;

test("reference drawer CSS caps its height at 60 percent of the visible viewport", {skip: !chromium}, () => {
    const css = mobileCSS();
    const directory = mkdtempSync(join(tmpdir(), "siyuan-reference-viewport-"));
    try {
        const html = join(directory, "index.html");
        writeFileSync(html, `<style>
            .b3-dialog {display:flex;position:absolute;width:100%}
            .b3-dialog__container {flex-shrink:0}
            ${css}
            </style>
            <div class="mobile-bottom-sheet-dialog mobile-reference-dialog b3-dialog--open">
              <div class="b3-dialog">
                <div class="b3-dialog__container mobile-bottom-sheet mobile-reference-sheet" style="height:60%;width:100vw">
                  <div class="b3-dialog__body">Reference content</div>
                </div>
              </div>
            </div>
            <script>
              const container = document.querySelector('.b3-dialog');
              const sheet = document.querySelector('.mobile-reference-sheet');
              const results = [];
              for (const height of [800, 350, 250, 600]) {
                container.style.height = height + 'px';
                container.style.top = '90px';
                const rect = sheet.getBoundingClientRect();
                results.push(rect.height <= height * 0.6 + 1 && rect.height > 0 &&
                  rect.bottom <= 90 + height + 1 && rect.top >= 90 + height * 0.4 - 1);
              }
              document.body.setAttribute('data-results', results.join(','));
            </script>`);
        const result = spawnSync(chromium, ["--headless", "--no-sandbox", "--disable-dev-shm-usage",
            "--disable-gpu", "--dump-dom", `--user-data-dir=${join(directory, "profile")}`, `file://${html}`],
        {encoding: "utf8", timeout: 30000, env: {...process.env, HOME: directory, XDG_CONFIG_HOME: directory}});
        assert.equal(result.status, 0, result.error?.message || result.stderr);
        assert.match(result.stdout, /data-results="true,true,true,true"/);
    } finally {
        rmSync(directory, {recursive: true, force: true});
    }
});
