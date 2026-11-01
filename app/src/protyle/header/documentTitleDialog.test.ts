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
    children: ElementMock[] = [];
    className = "";
    querySelector() { return this.children[0]; }
    appendChild(element: ElementMock) { this.children.push(element); }
    addEventListener(type: string, callback: () => void) { this.listeners.set(type, callback); }
    removeEventListener(type: string) { this.listeners.delete(type); }
    replaceChildren() { this.content = ""; }
}

const setup = (mobile: boolean) => {
    const window = {siyuan: {
        dialogs: [] as any[], mobile: {}, layout: {}, blockPanels: [] as any[], ws: {app: {}},
        config: {readonly: false}, isPublish: false,
        languages: {rename: "Rename", confirm: "Confirm", settingsPendingSaveError: "Save failed"},
    }};
    const messages: string[] = [];
    const ready: number[] = [];
    const guards: Array<{dispose: () => void, flush: () => Promise<void>, disposed: boolean}> = [];
    const instances: ProtyleMock[] = [];
    const afters: Array<() => void> = [];
    const viewport = {top: 0, bottom: 800};
    const resizeListeners = new Set<() => void>();
    let sheetClose: () => Promise<void>;
    let sheetResize: () => void;
    let sheetOpen: () => void;
    let keyboardShows = 0;
    let sheetDisposals = 0;
    const keyboardToolbar = {hidden: true, top: 752, classList: {contains: () => keyboardToolbar.hidden},
        getBoundingClientRect: () => ({top: keyboardToolbar.top})};
    const document = {activeElement: undefined as unknown, addEventListener: () => {},
        getElementById: () => keyboardToolbar, createElement: () => new ElementMock()};
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
    let openTitle: (isValid?: () => boolean) => Promise<void> = async () => {};
    class ProtyleMock {
        destroyed = 0;
        titleFlushes = 0;
        protyle: any;
        constructor(_app: unknown, element: ElementMock, options: {blockId: string, notebookId?: string, after: (value: ProtyleMock) => void}) {
            const input = {isConnected: true, editable: true, ownerDocument: document, focusCount: 0,
                getAttribute: () => input.editable ? "true" : "false",
                focus: () => { input.focusCount++; document.activeElement = input; }};
            this.protyle = {element, notebookId: options.notebookId, block: {rootID: options.blockId}, wysiwyg: {},
                title: {editElement: input, flushPendingInput: () => { this.titleFlushes++; return flushTitle(this); },
                    openEditor: (isValid?: () => boolean) => openTitle(isValid),
                    mountEditorOnly: (field: ElementMock) => { this.protyle.field = field; }}};
            instances.push(this);
            afters.push(() => options.after(this));
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
        element = {dataset: {}, isConnected: true, classList: {add: (name: string) => this.classes.add(name)},
            querySelector: (selector: string) => selector === ".b3-dialog" ? this.viewport :
                selector === ".document-title-dialog" ? this.host : this.confirm};
        constructor(public options: {beforeClose: () => boolean, destroyCallback: () => void,
            width?: string, height?: string, containerClassName?: string, hideCloseIcon?: boolean}) {
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
        callMobileAppShowKeyboard: () => { keyboardShows++; },
        bindBottomSheetDialog: (_dialog: DialogMock, close: () => Promise<void>, resize: () => void, open: () => void) => {
            sheetClose = close;
            sheetResize = resize;
            sheetOpen = open;
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
            document,
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
    Object.assign(dependencies, load("documentTitleEditor.ts"));
    const titleDialog = load("documentTitleDialog.ts");
    return {window, messages, guards, instances, ready, afters, secondary, registry, allEditors, system,
        viewport, resizeListeners, closeSheet: () => sheetClose(), resizeSheet: () => sheetResize(),
        openSheet: () => sheetOpen(), keyboardShows: () => keyboardShows,
        setOpenTitle: (callback: typeof openTitle) => { openTitle = callback; },
        sheetDisposals: () => sheetDisposals,
        keyboardToolbar, resizeToolbar: () => toolbarObserver(), toolbarObserved: () => toolbarObserved,
        open: (id = "doc", notebook: string | undefined = "encrypted") =>
            titleDialog.openDocumentTitleDialog({id, notebook}) as DialogMock,
        setFlush: (callback: typeof flush) => { flush = callback; },
        setGuard: (callback: typeof flushGuard) => { flushGuard = callback; },
        setTitle: (callback: typeof flushTitle) => { flushTitle = callback; }};
};

for (const mobile of [false, true]) {
    test(`${mobile ? "mobile" : "desktop"} rename dismissal discards its draft without saving`, async () => {
        const state = setup(mobile);
        let writes = 0;
        state.setFlush(async () => { writes++; });
        state.setTitle(async () => { writes++; });
        const dialog = state.open();
        if (mobile) await state.closeSheet();
        else dialog.destroy();
        await settle();
        assert.equal(dialog.destroyed, true);
        assert.equal(dialog.host.content, "");
        assert.equal(writes, 0);
        assert.equal(state.guards[0].disposed, true);
        assert.equal(state.instances[0].destroyed, 1);
    });

    test(`${mobile ? "mobile" : "desktop"} rename confirmation waits for acknowledgement and rejects duplicate submissions`, async () => {
        const state = setup(mobile);
        const pending = deferred();
        let writes = 0;
        state.setFlush(() => { writes++; return pending.promise; });
        const dialog = state.open();
        dialog.confirm.listeners.get("click")();
        dialog.confirm.listeners.get("click")();
        dialog.destroy();
        if (mobile) await state.closeSheet();
        assert.equal(writes, 1);
        assert.equal(dialog.destroyed, false);
        pending.resolve();
        await settle();
        assert.equal(dialog.destroyed, true);
    });

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
        dialog.confirm.listeners.get("click")();
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
    dialog.confirm.listeners.get("click")();
    await settle();
    draft = "typed while waiting";
    pending.resolve();
    await settle();
    assert.equal(saved, draft);
    assert.equal(dialog.destroyed, true);
    assert.equal(state.instances[0].titleFlushes, 1);

    state.setFlush(async () => { throw new Error("Conflict"); });
    const blocked = state.open("other");
    blocked.confirm.listeners.get("click")();
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
    assert.equal(dialog.options.hideCloseIcon, true);
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
    dialog.confirm.listeners.get("click")();
    await settle();
    assert.equal(dialog.destroyed, false);
    assert.equal(dialog.host.content, "private title");
    assert.equal(state.sheetDisposals(), 0);
    assert.equal(state.resizeListeners.size, 1);
    state.setTitle(async () => {});
    dialog.confirm.listeners.get("click")();
    await settle();
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
    assert.equal(dialog.options.hideCloseIcon, undefined);
    assert.equal(dialog.classes.size, 0);
    assert.equal(state.resizeListeners.size, 0);
});

test("mobile rename readiness mounts one standalone field and rejects late readiness after dismissal", () => {
    const mobile = setup(true);
    const dialog = mobile.open();
    mobile.afters[0]();
    mobile.afters[0]();
    assert.equal(dialog.host.children.length, 1);
    assert.equal(dialog.host.children[0].className, "document-title-dialog__editor b3-text-field");
    assert.equal(mobile.instances[0].protyle.field, dialog.host.children[0]);
    const late = mobile.open("late");
    late.destroy();
    mobile.afters[1]();
    assert.equal(late.host.children.length, 0);
    const desktop = setup(false);
    const desktopDialog = desktop.open();
    desktop.afters[0]();
    assert.equal(desktopDialog.host.children.length, 0, "desktop keeps its existing title layout");
});

for (const sheetFirst of [true, false]) {
    test(`mobile rename waits for the ${sheetFirst ? "editor" : "sheet"} before loading and focusing its title once`, async () => {
        const state = setup(true);
        const pending = deferred();
        let loads = 0;
        state.setOpenTitle(() => { loads++; return pending.promise; });
        state.open();
        const input = state.instances[0].protyle.title.editElement;
        if (sheetFirst) state.openSheet();
        else state.afters[0]();
        assert.equal(loads, 0, "title focus must not run inside a hidden or uninitialized sheet");
        assert.equal(input.focusCount, 0);
        assert.equal(state.keyboardShows(), 0);
        if (sheetFirst) state.afters[0]();
        else state.openSheet();
        assert.equal(loads, 1);
        assert.equal(input.focusCount, 0, "source loading must finish before keyboard activation");
        pending.resolve();
        await settle();
        assert.equal(input.focusCount, 1);
        assert.equal(state.keyboardShows(), 1);
        assert.equal(loads, 1);
        state.openSheet();
        state.resizeSheet();
        state.resizeToolbar();
        assert.equal(input.focusCount, 1);
        assert.equal(state.keyboardShows(), 1);
    });
}

for (const invalidate of ["dismiss", "lock", "another-dialog", "readonly", "workspace-readonly", "publish",
    "not-editable", "detached", "save"] as const) {
    test(`mobile rename does not steal focus after ${invalidate} during source loading`, async () => {
        const state = setup(true);
        const pending = deferred();
        const saving = deferred();
        let isValid: () => boolean;
        state.setOpenTitle(valid => { isValid = valid; return pending.promise; });
        const dialog = state.open();
        state.afters[0]();
        state.openSheet();
        const editor = state.instances[0];
        if (invalidate === "dismiss") dialog.destroy();
        if (invalidate === "lock") state.registry.closeDocumentTitleDialogs({notebookId: "encrypted"});
        if (invalidate === "another-dialog") state.window.siyuan.dialogs.push({});
        if (invalidate === "readonly") editor.protyle.disabled = true;
        if (invalidate === "workspace-readonly") state.window.siyuan.config.readonly = true;
        if (invalidate === "publish") state.window.siyuan.isPublish = true;
        if (invalidate === "not-editable") editor.protyle.title.editElement.editable = false;
        if (invalidate === "detached") dialog.element.isConnected = false;
        if (invalidate === "save") {
            state.setFlush(() => saving.promise);
            dialog.confirm.listeners.get("click")();
        }
        if (["dismiss", "lock", "another-dialog", "detached"].includes(invalidate)) assert.equal(isValid(), false);
        pending.resolve();
        await settle();
        assert.equal(editor.protyle.title.editElement.focusCount, 0);
        assert.equal(state.keyboardShows(), 0);
        saving.resolve();
        await settle();
    });
}

test("failed mobile title loading and desktop readiness never request the mobile keyboard", async () => {
    const mobile = setup(true);
    mobile.setOpenTitle(async () => { throw new Error("Title unavailable"); });
    mobile.open();
    mobile.openSheet();
    mobile.afters[0]();
    const desktop = setup(false);
    desktop.open();
    desktop.afters[0]();
    await settle();
    assert.equal(mobile.keyboardShows(), 0);
    assert.equal(mobile.instances[0].protyle.title.editElement.focusCount, 0);
    assert.equal(desktop.keyboardShows(), 0);
});

const checkDrawerLayout = (css: string, toolbarSource: string, paddingSource: string, titleSource: string) => {
    const check: typeof assert = require("node:assert/strict");
    const {paddingElement, setUndo} = new Function(toolbarSource +
        "\nreturn {paddingElement: getMobileToolbarPaddingElement, setUndo: setMobileToolbarUndo};")() as {
        paddingElement: typeof import("../lite/mobileToolbar").getMobileToolbarPaddingElement,
        setUndo: typeof import("../lite/mobileToolbar").setMobileToolbarUndo,
    };
    document.head.innerHTML = `<style>${css}</style>`;
    document.body.style.cssText = "--b3-font-size:16px;--b3-font-size-editor:16px;--mobile-top-safe-area:0px";
    document.body.innerHTML = `<div class="mobile-document-title-dialog mobile-bottom-sheet-dialog b3-dialog--open">
<div class="b3-dialog"><div class="b3-dialog__scrim"></div>
<div class="b3-dialog__container mobile-bottom-sheet mobile-document-title-sheet" style="width:100vw;height:auto;transition:none">
<div class="b3-menu__title b3-menu__title--root"></div><div class="b3-dialog__header">Rename</div>
<div class="b3-dialog__body"><div class="document-title-dialog protyle">
<div class="protyle-content"><div class="protyle-top"><div class="protyle-title">
<span class="protyle-title__icon">File</span><div class="protyle-attr">Private alias and backlinks</div>
<div class="protyle-title__rich protyle"><div class="protyle-content"><div class="protyle-wysiwyg">
<div data-node-id="title-paragraph" data-type="NodeParagraph" class="p"><div class="protyle-title__input" contenteditable="true"></div><div class="protyle-attr">Paragraph badge</div></div>
</div></div></div></div></div><div class="protyle-wysiwyg">Hidden document body</div></div></div>
<div class="b3-dialog__action"><button class="b3-button b3-button--text">Confirm</button></div></div></div></div></div>`;
    const container = document.querySelector<HTMLElement>(".b3-dialog");
    const sheet = document.querySelector<HTMLElement>(".mobile-document-title-sheet");
    const host = document.querySelector<HTMLElement>(".document-title-dialog");
    const editable = document.querySelector<HTMLElement>("[contenteditable]");
    const action = document.querySelector<HTMLElement>(".b3-dialog__action");
    const field = document.createElement("div");
    field.className = "document-title-dialog__editor b3-text-field";
    host.appendChild(field);
    const titleExports: any = {};
    new Function("exports", "require", titleSource)(titleExports, () => ({}));
    const title = Object.assign(Object.create(titleExports.Title.prototype), {
        element: host.querySelector(".protyle-title"), editElement: editable,
        richEditor: {fragment: {protyle: {element: host.querySelector(".protyle-title__rich")}}},
    });
    title.mountEditorOnly(field);
    check.equal(host.querySelector(".protyle-top"), null, "the drawer has a standalone field without a document title container");
    check.equal(host.querySelector(".protyle-title__icon"), null, "the document block icon stays outside the drawer field");
    check.equal(field.querySelector<HTMLElement>(".protyle-attr").offsetHeight, 0, "the field does not show block corner badges");
    const owner = {element: host, contentElement: host.firstElementChild, options: {action: [], render: {title: true}},
        preview: {updatePadding: () => {}}, title,
        wysiwyg: {element: host.querySelector(":scope > .protyle-content > .protyle-wysiwyg")}} as unknown as IProtyle;
    const setPadding = new Function("Constants", "getPadding", "BACKLINK_EDITOR_PADDING",
        paddingSource + "\nreturn setPadding;")({CB_GET_HISTORY: "history"},
        () => ({left: 24, right: 16, top: 16, bottom: 16}), "");
    setPadding(owner);
    const fragment = {lite: true, element: host.querySelector(".protyle-title__rich")} as IProtyle;
    setUndo(fragment, owner, () => {});
    for (const height of [800, 350, 220]) {
        container.style.top = "30px";
        container.style.height = `${height}px`;
        for (const large of [false, true]) {
            document.body.style.setProperty("--b3-font-size-editor", large ? "32px" : "16px");
            for (const long of [false, true]) {
                editable.innerHTML = long ? "<strong>Rich title </strong><em>with styles </em>".repeat(50) : "Untitled document";
                check.equal(getComputedStyle(editable).fontSize, "16px", "the mobile rename field uses the UI font size");
                const rect = sheet.getBoundingClientRect();
                const button = action.getBoundingClientRect();
                const editor = host.getBoundingClientRect();
                const context = JSON.stringify({height, large, long, sheet: rect.toJSON(), button: button.toJSON()});
                check.ok(rect.height > 0 && rect.height <= height + 1, context);
                check.ok(Math.abs(rect.bottom - (30 + height)) < 1, context);
                check.ok(button.top >= rect.top && button.bottom <= rect.bottom + 1 && button.height >= 30, context);
                check.ok(editor.bottom <= button.top + 1 && editor.height > 0, context);
                if (long) {
                    check.ok(field.scrollWidth > field.clientWidth, "long rich titles scroll horizontally in one line: " + context);
                    check.ok(editable.getBoundingClientRect().height < 40, "long titles do not wrap into several lines: " + context);
                } else if (height === 800 && !large) {
                    check.ok(rect.height < 250, "short title does not reserve a full editor: " + context);
                }
                if (!long && height === 800) {
                    const fieldBounds = field.getBoundingClientRect();
                    check.ok(Math.abs((fieldBounds.top - editor.top) - (editor.bottom - fieldBounds.bottom)) < 1,
                        "short titles have symmetric vertical spacing after editor padding updates: " + context);
                }
            }
        }
    }
    editable.textContent = "Short title";
    for (const theme of ["light", "dark"]) {
        document.body.style.setProperty("--b3-theme-background", theme === "light" ? "#fff" : "#1e1e1e");
        document.body.style.setProperty("--b3-theme-surface", theme === "light" ? "#f3f3f3" : "#292929");
        for (const height of [800, 350, 220]) {
            container.style.height = `${height}px`;
            for (const padding of ["48px", "160px", ""]) {
                paddingElement(fragment)?.style.setProperty("padding-bottom", padding);
                const gap = sheet.getBoundingClientRect().bottom - action.getBoundingClientRect().bottom;
                check.ok(gap < 1, `keyboard padding cannot create a gap below Confirm: ${theme}, ${height}, ${padding}, gap=${gap}`);
                check.equal(getComputedStyle(field).backgroundColor, getComputedStyle(host).backgroundColor,
                    "the standalone input follows the editor background in both themes");
                check.equal(getComputedStyle(fragment.element).backgroundColor, getComputedStyle(host).backgroundColor);
            }
        }
    }
    editable.textContent = "";
    editable.dataset.tip = "Untitled document";
    editable.focus();
    title.mountEditorOnly(field);
    check.equal(document.activeElement, editable);
    check.equal(getComputedStyle(editable, "::after").content, '"Untitled document"');
    check.equal(document.querySelector<HTMLElement>(".document-title-dialog > .protyle-content > .protyle-wysiwyg").offsetHeight, 0);
    return "Title drawer layout passed";
};

test("native mobile title drawer keeps its action above the keyboard and edits rich titles in a single standalone line", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 30000,
}, async () => {
    const css = compile(resolve(__dirname, "../../assets/scss/mobile.scss"), {logger: {warn() {}, debug() {}}}).css;
    const toolbarSource = transpileModule(readFileSync(resolve(__dirname, "../lite/mobileToolbar.ts"), "utf8")
        .replace(/^export /gm, ""), {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;
    const uiSource = readFileSync(resolve(__dirname, "../ui/initUI.ts"), "utf8");
    const paddingSource = transpileModule(uiSource.slice(uiSource.indexOf("export const setPadding ="),
        uiSource.indexOf("export const getPadding =")).replace(/^export /gm, ""),
    {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;
    const titleSource = transpileModule(readFileSync(resolve(__dirname, "Title.ts"), "utf8"), {
        compilerOptions: {target: ScriptTarget.ES2021, module: ModuleKind.CommonJS},
    }).outputText;
    const directory = mkdtempSync(resolve(tmpdir(), "siyuan-title-drawer-"));
    const script = resolve(directory, "run.cjs");
    const code = "const __name = value => value; (" + checkDrawerLayout.toString() + ")(" + JSON.stringify(css) + "," +
        JSON.stringify(toolbarSource) + "," + JSON.stringify(paddingSource) + "," + JSON.stringify(titleSource) + ")";
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(resolve(directory, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show:false, width:390, height:900, webPreferences:{nodeIntegration:true, contextIsolation:false}});
    win.webContents.on("console-message", event => console.error(event.message));
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
