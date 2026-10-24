import {test} from "node:test";
import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {createSourceFile, isVariableStatement, ModuleKind, ScriptTarget, transpileModule} from "typescript";
import type {App} from "../../index";

const code = transpileModule(readFileSync("src/boot/globalEvent/nativeBack.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

const setup = (android = true, navigation?: Pick<typeof import("../../util/backForward"), "goBack" | "hasBackHistory">) => {
    const closed: string[] = [];
    const messages: string[] = [];
    const errors: unknown[] = [];
    let exitTipVisible = false;
    const elements: Record<string, ReturnType<typeof element>[]> = {};
    const element = (name: string, zIndex: number, hidden = false) => ({
        name, isConnected: true, parentElement: null as HTMLElement | null, dataset: {} as Record<string, string>,
        style: {zIndex: String(zIndex), opacity: "1"},
        classList: {contains: (value: string) => value === "av__richtext-mask" && name === "rich-text"},
        closest: (): unknown => hidden ? {} : null,
        querySelector: (): null => null,
        getAttribute: () => "false",
        contains: (): boolean => false,
        dispatchEvent: (event: {type: string}) => { closed.push(name + ":" + event.type); elements[".av__mask"] = []; },
        remove: () => { closed.push(name); Object.keys(elements).forEach(key => { elements[key] = elements[key].filter(item => item.name !== name); }); },
    });
    const dialogs: Array<{element: unknown, destroy: () => void}> = [];
    const panels: Array<{element: unknown, x: number, destroy: () => void}> = [];
    const dock = element("drawer", 100);
    let drawerOpen = true;
    let floating = true;
    const siyuan = {dialogs, blockPanels: panels, isReady: true,
        languages: {returnDesktop: "Press back again to return to desktop"},
        menus: {menu: {element: element("menu", 50, true), remove: () => { closed.push("menu"); }}},
        layout: {rightDock: {layout: {element: dock}, isFloating: () => floating,
            isPanelVisible: () => drawerOpen, togglePanel: (visible: boolean) => { drawerOpen = visible; closed.push("drawer"); }}},
        viewer: {destroyed: true, viewer: element("viewer", 300), hide: () => { closed.push("viewer-hidden"); siyuan.viewer.destroyed = true; }},
    };
    const window = {siyuan, JSAndroid: android ? {returnDesktop: () => closed.push("return-desktop")} : undefined,
        history: {back: () => assert.fail("native back must never navigate browser history")},
        goBack: undefined as (() => void) | undefined};
    const app = {} as App;
    const api = {} as typeof import("./nativeBack");
    runInNewContext(code, {exports: api, window, console: {error: (error: unknown) => errors.push(error)}, document: {
        querySelectorAll: (selector: string) => elements[selector] || [], activeElement: null,
        querySelector: (selector: string) => {
            assert.equal(selector, '#message [data-id="exitTip"]:not(.b3-snackbar--hide)');
            return exitTipVisible ? {} : null;
        },
    }, getComputedStyle: (item: ReturnType<typeof element>) => ({display: "block", visibility: "visible", ...item.style}),
    CustomEvent: class { constructor(public type: string) {} }, require: (name: string) => ({
        "../../util/zIndex": {getZIndex: (item: ReturnType<typeof element>) => Number(item.style.zIndex)},
        "../../util/backForward": navigation || {hasBackHistory: () => true, goBack: async (value: App) => {
            assert.equal(value, app);
            closed.push("document-back");
        }},
        "../../dialog/message": {
            showMessage: (text: string, timeout: number, type: string, id: string) => {
                assert.equal(text, siyuan.languages.returnDesktop);
                assert.equal(timeout, 3000);
                assert.equal(type, "info");
                assert.equal(id, "exitTip");
                messages.push(text);
                exitTipVisible = true;
            },
            hideMessage: (id: string) => { assert.equal(id, "exitTip"); exitTipVisible = false; },
        },
        "../../protyle/render/av/cellEditor": {AV_CELL_EDITOR_CLOSE_EVENT: "cell-close"},
        "../../protyle/render/av/richTextEditor": {destroyAVRichTextEditor: (save: boolean) => {
            assert.equal(save, true); closed.push("rich-text-saved"); elements[".av__mask"] = [];
        }},
    })[name]});
    const addDialog = (name: string, zIndex: number) => {
        const inner = element(name, zIndex);
        const item = {element: {...element("dialog-root", 0), querySelector: () => inner},
            destroy: () => { closed.push(name); dialogs.splice(dialogs.indexOf(item), 1); }};
        dialogs.push(item);
        return item;
    };
    return {api, app, window, siyuan, element, elements, closed, messages, errors, addDialog, dock,
        expireTip() { exitTipVisible = false; },
        setFloating(value: boolean) { floating = value; }, setDrawer(value: boolean) { drawerOpen = value; }};
};

test("Android desktop back closes the highest menu, dialog and drawer one at a time, then uses document history", () => {
    const state = setup();
    state.addDialog("first-dialog", 150);
    state.addDialog("top-dialog", 200);
    state.siyuan.menus.menu.element = state.element("menu", 250);
    state.siyuan.menus.menu.remove = () => {
        state.closed.push("menu"); state.siyuan.menus.menu.element.isConnected = false;
    };
    state.api.registerDesktopBackNavigation(state.app);
    for (let i = 0; i < 5; i++) state.window.goBack();
    assert.deepEqual(state.closed, ["menu", "top-dialog", "first-dialog", "drawer", "document-back"]);
});

test("native back restores a maximized PDF after closing higher overlays and before document history", () => {
    const state = setup();
    state.setDrawer(false);
    const pdf = state.element("pdf", 8);
    const button = {click: () => {
        state.closed.push("pdf-restored");
        state.elements[".pdf__outer--maximized"] = [];
    }};
    Object.assign(pdf, {querySelector: () => button});
    state.elements[".pdf__outer--maximized"] = [pdf];
    state.addDialog("dialog", 100);
    state.api.registerDesktopBackNavigation(state.app);
    state.window.goBack();
    state.window.goBack();
    state.window.goBack();
    assert.deepEqual(state.closed, ["dialog", "pdf-restored", "document-back"]);
});

test("a higher dialog closes ahead of an older menu regardless of array order", () => {
    const state = setup();
    state.siyuan.menus.menu.element = state.element("menu", 120);
    state.addDialog("highest-dialog", 200);
    state.addDialog("older-dialog", 160);
    assert.equal(state.api.closeDesktopBackLayer(), true);
    assert.deepEqual(state.closed, ["highest-dialog"]);
});

test("cell and rich text editors use their cleanup handlers before the parent dialog", () => {
    const state = setup();
    state.addDialog("dialog", 100);
    state.elements[".av__mask"] = [state.element("rich-text", 200)];
    state.api.closeDesktopBackLayer();
    assert.deepEqual(state.closed, ["rich-text-saved"]);
    state.elements[".av__mask"] = [state.element("cell", 210)];
    state.api.closeDesktopBackLayer();
    assert.deepEqual(state.closed, ["rich-text-saved", "cell:cell-close"]);
});

test("image previews run hidden cleanup and ordinary dock panels do not consume back", () => {
    const state = setup();
    state.setFloating(false);
    state.siyuan.viewer.destroyed = false;
    state.api.closeDesktopBackLayer();
    assert.deepEqual(state.closed, ["viewer-hidden"]);
    assert.equal(state.api.closeDesktopBackLayer(), false);
    state.api.registerDesktopBackNavigation(state.app);
    state.window.goBack();
    assert.deepEqual(state.closed, ["viewer-hidden", "document-back"]);
});

test("a popup inherits its parent's layer and hidden overlays do not consume back", () => {
    const state = setup();
    state.setDrawer(false);
    state.addDialog("dialog", 200);
    const mask = state.element("cell", 10);
    mask.parentElement = state.element("parent", 300) as unknown as HTMLElement;
    state.elements[".av__mask"] = [mask];
    state.api.closeDesktopBackLayer();
    assert.deepEqual(state.closed, ["cell:cell-close"]);
    const hiddenParent = state.element("parent", 400);
    hiddenParent.style.opacity = "0";
    mask.parentElement = hiddenParent as unknown as HTMLElement;
    state.elements[".av__mask"] = [mask];
    state.api.closeDesktopBackLayer();
    assert.deepEqual(state.closed, ["cell:cell-close", "dialog"]);
});

test("only the highest unpinned block popup closes on each back press", () => {
    const state = setup();
    state.setDrawer(false);
    for (const [name, zIndex, pin] of [["first", 150, "false"], ["top", 200, "false"], ["pinned", 250, "true"]] as const) {
        const element = state.element(name, zIndex);
        element.getAttribute = () => pin;
        const panel = {element, x: 1, destroy: () => {
            state.closed.push(name); state.siyuan.blockPanels.splice(state.siyuan.blockPanels.indexOf(panel), 1);
        }};
        state.siyuan.blockPanels.push(panel);
    }
    state.api.closeDesktopBackLayer();
    assert.deepEqual(state.closed, ["top"]);
    state.api.closeDesktopBackLayer();
    assert.deepEqual(state.closed, ["top", "first"]);
    assert.equal(state.api.closeDesktopBackLayer(), false);
});

test("closing dialogs consume repeated back presses and a plain browser keeps its own navigation", () => {
    const state = setup(false);
    state.setDrawer(false);
    const dialog = state.addDialog("closing", 200);
    dialog.element.dataset.dialogClosing = "true";
    dialog.element.querySelector = (): null => null;
    assert.equal(state.api.closeDesktopBackLayer(), true);
    state.api.registerDesktopBackNavigation(state.app);
    assert.equal(state.window.goBack, undefined);
});

test("at the history start Back prompts before returning to the system desktop, and expired tips do not confirm", () => {
    const state = setup(true, {hasBackHistory: () => false, goBack: async () => assert.fail("no history")});
    state.setDrawer(false);
    state.api.registerDesktopBackNavigation(state.app);
    state.window.goBack();
    assert.equal(state.messages.length, 1);
    assert.deepEqual(state.closed, []);
    state.expireTip();
    state.window.goBack();
    assert.equal(state.messages.length, 2);
    assert.deepEqual(state.closed, []);
    state.window.goBack();
    assert.deepEqual(state.closed, ["return-desktop"]);
    state.window.goBack();
    assert.equal(state.messages.length, 3);
    assert.deepEqual(state.closed, ["return-desktop"]);
});

test("closing an overlay cancels the previous return-to-desktop confirmation", () => {
    const state = setup(true, {hasBackHistory: () => false, goBack: async () => assert.fail("no history")});
    state.setDrawer(false);
    state.api.registerDesktopBackNavigation(state.app);
    state.window.goBack();
    state.addDialog("new-dialog", 200);
    state.window.goBack();
    state.window.goBack();
    assert.deepEqual(state.closed, ["new-dialog"]);
    assert.equal(state.messages.length, 2);
});

test("document navigation consumes rapid Back presses but still permits closing a newly opened overlay", async () => {
    let hasHistory = false;
    let finish: () => void;
    let navigations = 0;
    const state = setup(true, {hasBackHistory: () => hasHistory, goBack: () => {
        navigations++;
        hasHistory = false;
        return new Promise<void>(resolve => { finish = resolve; });
    }});
    state.setDrawer(false);
    state.api.registerDesktopBackNavigation(state.app);
    state.window.goBack();
    hasHistory = true;
    state.window.goBack();
    state.window.goBack();
    assert.equal(navigations, 1);
    assert.equal(state.messages.length, 1);
    state.addDialog("loading-dialog", 200);
    state.window.goBack();
    assert.deepEqual(state.closed, ["loading-dialog"]);
    finish();
    await new Promise(setImmediate);
    state.window.goBack();
    assert.equal(state.messages.length, 2);
    assert.deepEqual(state.closed, ["loading-dialog"]);
});

test("Back is consumed while the desktop is still initializing", () => {
    const state = setup();
    state.setDrawer(false);
    state.siyuan.isReady = false;
    state.api.registerDesktopBackNavigation(state.app);
    state.window.goBack();
    assert.deepEqual(state.closed, []);
    assert.deepEqual(state.messages, []);
});

test("a failed history navigation releases the Back guard without falling through to the system desktop", async () => {
    const error = new Error("history lookup failed");
    let navigations = 0;
    const state = setup(true, {hasBackHistory: () => true, goBack: async () => {
        navigations++;
        throw error;
    }});
    state.setDrawer(false);
    state.api.registerDesktopBackNavigation(state.app);
    state.window.goBack();
    await new Promise(setImmediate);
    assert.deepEqual(state.errors, [error]);
    assert.deepEqual(state.closed, []);
    assert.deepEqual(state.messages, []);
    state.window.goBack();
    await new Promise(setImmediate);
    assert.equal(navigations, 2);
});

test("native Back follows the actual desktop history stack and stops at its first document", async () => {
    const source = createSourceFile("backForward.ts", readFileSync("src/util/backForward.ts", "utf8"), ScriptTarget.ES2021, true);
    const names = ["goBack", "hasBackHistory", "forwardStack", "previousIsBack"];
    const declarations = source.statements.filter(statement => isVariableStatement(statement) &&
        statement.declarationList.declarations.some(item => names.includes(item.name.getText(source))));
    const code = transpileModule(declarations.map(item => item.getText(source)).join("\n"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    const visited: string[] = [];
    const navigation = {} as Pick<typeof import("../../util/backForward"), "goBack" | "hasBackHistory">;
    runInNewContext(code, {exports: navigation,
        window: {siyuan: {backStack: ["first", "second", "third"].map(id => ({id, protyle: {element: {}}}))}},
        document: {contains: () => true, querySelector: (): null => null}, saveBackScroll: () => {},
        focusStack: async (_app: App, stack: {id: string}) => { visited.push(stack.id); return true; },
    });
    const state = setup(true, navigation);
    state.setDrawer(false);
    state.api.registerDesktopBackNavigation(state.app);
    for (let i = 0; i < 2; i++) {
        state.window.goBack();
        await new Promise(setImmediate);
    }
    assert.deepEqual(visited, ["second", "first"]);
    assert.equal(state.messages.length, 0);
    state.window.goBack();
    assert.deepEqual(visited, ["second", "first"]);
    assert.equal(state.messages.length, 1);
    state.window.goBack();
    assert.deepEqual(state.closed, ["return-desktop"]);
});
