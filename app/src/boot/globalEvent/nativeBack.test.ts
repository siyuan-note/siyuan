import {test} from "node:test";
import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const code = transpileModule(readFileSync("src/boot/globalEvent/nativeBack.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

const setup = (android = true) => {
    const closed: string[] = [];
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
    const siyuan = {dialogs, blockPanels: panels,
        menus: {menu: {element: element("menu", 50, true), remove: () => { closed.push("menu"); }}},
        layout: {rightDock: {layout: {element: dock}, isFloating: () => floating,
            isPanelVisible: () => drawerOpen, togglePanel: (visible: boolean) => { drawerOpen = visible; closed.push("drawer"); }}},
        viewer: {destroyed: true, viewer: element("viewer", 300), hide: () => { closed.push("viewer-hidden"); siyuan.viewer.destroyed = true; }},
    };
    const window = {siyuan, JSAndroid: android ? {} : undefined, history: {back: () => closed.push("history")},
        goBack: undefined as (() => void) | undefined};
    const api = {} as typeof import("./nativeBack");
    runInNewContext(code, {exports: api, window, document: {
        querySelectorAll: (selector: string) => elements[selector] || [], activeElement: null,
    }, getComputedStyle: (item: ReturnType<typeof element>) => ({display: "block", visibility: "visible", ...item.style}),
    CustomEvent: class { constructor(public type: string) {} }, require: (name: string) => ({
        "../../util/zIndex": {getZIndex: (item: ReturnType<typeof element>) => Number(item.style.zIndex)},
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
    return {api, window, siyuan, element, elements, closed, addDialog, dock,
        setFloating(value: boolean) { floating = value; }, setDrawer(value: boolean) { drawerOpen = value; }};
};

test("Android desktop back closes the highest menu, dialog and drawer one at a time, then uses history", () => {
    const state = setup();
    state.addDialog("first-dialog", 150);
    state.addDialog("top-dialog", 200);
    state.siyuan.menus.menu.element = state.element("menu", 250);
    state.siyuan.menus.menu.remove = () => {
        state.closed.push("menu"); state.siyuan.menus.menu.element.isConnected = false;
    };
    state.api.registerDesktopBackNavigation();
    for (let i = 0; i < 5; i++) state.window.goBack();
    assert.deepEqual(state.closed, ["menu", "top-dialog", "first-dialog", "drawer", "history"]);
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
    state.api.registerDesktopBackNavigation();
    state.window.goBack();
    assert.deepEqual(state.closed, ["viewer-hidden", "history"]);
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
    state.api.registerDesktopBackNavigation();
    assert.equal(state.window.goBack, undefined);
});
