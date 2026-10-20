import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {getVisibleSheetViewport} from "../../../menus/sheetOpen";

const compiled = transpileModule(readFileSync("src/protyle/render/av/mobilePanel.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

const createPanel = () => {
    const listeners = new Map<string, (event: unknown) => void>();
    const scrim = {style: {opacity: ""}};
    const observers: Array<() => void> = [];
    const classes = new Set<string>();
    const resizeListeners = new Set<() => void>();
    let backTarget: HTMLElement;
    const backButtonClasses = new Set<string>();
    const backButton = {classList: {toggle: (name: string, force: boolean) => {
        if (force) {
            backButtonClasses.add(name);
        } else {
            backButtonClasses.delete(name);
        }
    }}};
    const menu = {
        style: {height: "", transform: "", transition: "", setProperty() {}},
        classList: {add: (...names: string[]) => names.forEach(name => classes.add(name)),
            contains: (name: string) => classes.has(name)},
        setAttribute() {},
        clientHeight: 400,
        offsetHeight: 400,
        firstElementChild: undefined as undefined | {classList: {contains: (name: string) => boolean}},
        insertedHTML: [] as string[],
        insertAdjacentHTML(position: string, html: string) {
            this.insertedHTML.push(`${position}:${html}`);
            this.firstElementChild = {classList: {contains: (name: string) => html.includes(name)}};
        },
        querySelectorAll: (selector: string): Element[] => selector.includes("block__icon--menu-back") && backTarget ? [backTarget] : [],
        querySelector: (selector: string) => selector.includes("sheet-back") ? backButton : null,
        addEventListener: (name: string, listener: (event: unknown) => void) => listeners.set(name, listener),
    };
    const actions: string[] = [];
    const panel = {
        querySelector: () => scrim,
        parentElement: {},
        dispatchEvent: (event: CustomEvent) => actions.push(event.detail),
    };
    const exports: {bindMobileAVPanel?: (panel: unknown, menu: unknown) => void} = {};
    runInNewContext(compiled, {
        exports,
        require: () => ({waitForSheetViewport: () => () => {}, getVisibleSheetViewport,
            escapeAttr: (value: string) => value || "", getSheetActionsHTML: () => "actions",
            setSheetExpanded: (_menu: unknown, expanded: boolean) => {
                if (expanded) {
                    classes.add("b3-menu--expanded");
                } else {
                    classes.delete("b3-menu--expanded");
                }
            }, updateMenuItemGroupClasses() {}}),
        window: {
            innerHeight: 800,
            siyuan: {languages: {back: "Back"}, mobile: {size: {portrait: {height1: 800}}}},
            addEventListener: (_name: string, callback: () => void) => resizeListeners.add(callback),
        },
        performance: {now: () => 1000},
        MutationObserver: class {
            constructor(callback: () => void) {
                observers.push(callback);
            }

            observe() {}

            disconnect() {}
        },
        CustomEvent: class {detail: unknown; constructor(_name: string, options: {detail: unknown}) { this.detail = options.detail; }},
    });
    exports.bindMobileAVPanel(panel, menu);
    const drag = (sortable: boolean, offset: number, title = false) => {
        const target = {
            closest: (selector: string) => sortable && selector.includes('[draggable="true"]') ||
                title && selector === ".b3-menu__title--actions" ? {} : null,
            parentElement: menu,
        };
        listeners.get("touchstart")({target, touches: [{clientX: 80, clientY: 100}]});
        listeners.get("touchmove")({touches: [{clientX: 80, clientY: 100 + offset}]});
    };
    const end = (offset = 200) => listeners.get("touchend")({changedTouches: [{clientY: 100 + offset}]});
    // 触发内容观察者，模拟数据库面板内容整体重绘
    const rerender = () => observers[0]();
    const click = (type: string) => listeners.get("click")({
        target: {closest: () => ({dataset: {type}})}, detail: 1, preventDefault() {}, stopImmediatePropagation() {},
    });
    return {menu, scrim, drag, end, rerender, click, actions, classes, backButtonClasses,
        cancel: () => listeners.get("touchcancel")({}), resize: () => resizeListeners.forEach(callback => callback()),
        setBackTarget: () => {
            backTarget = {closest: (): null => null} as unknown as HTMLElement;
            rerender();
        }, closes: () => actions.filter(action => action === "close").length};
};

test("database panel handle is hosted by a root menu title", () => {
    const panel = createPanel();
    assert.equal(panel.menu.insertedHTML.length, 1);
    assert.match(panel.menu.insertedHTML[0], /b3-menu__title--actions/);
    assert.equal(panel.backButtonClasses.has("fn__none"), true);
    panel.menu.firstElementChild = undefined;
    panel.rerender();
    assert.equal(panel.menu.insertedHTML.length, 2);
});

test("pulling the database panel title upward expands it and downward restores half height", () => {
    const panel = createPanel();
    panel.drag(false, -120, true);
    panel.end(-120);
    assert.equal(panel.classes.has("b3-menu--expanded"), true);
    assert.equal(panel.menu.style.height, "800px");
    panel.resize();
    assert.equal(panel.menu.style.height, "800px");
    panel.drag(false, 200, true);
    panel.end();
    assert.equal(panel.classes.has("b3-menu--expanded"), false);
    assert.ok(Math.abs(parseFloat(panel.menu.style.height) - 448) < .01);
    assert.equal(panel.closes(), 0);
});

test("canceling an upward gesture restores the half-height database panel", () => {
    const panel = createPanel();
    panel.drag(false, -120, true);
    panel.cancel();
    assert.equal(panel.classes.has("b3-menu--expanded"), false);
    assert.ok(Math.abs(parseFloat(panel.menu.style.height) - 448) < .01);
});

test("the expand button toggles full height without closing the panel", () => {
    const panel = createPanel();
    panel.click("sheet-expand");
    assert.equal(panel.classes.has("b3-menu--expanded"), true);
    panel.rerender();
    assert.equal(panel.classes.has("b3-menu--expanded"), true);
    panel.click("sheet-expand");
    assert.equal(panel.classes.has("b3-menu--expanded"), false);
    assert.equal(panel.closes(), 0);
});

test("the close and back controls use the database panel action entry", () => {
    const panel = createPanel();
    panel.click("sheet-close");
    panel.setBackTarget();
    assert.equal(panel.backButtonClasses.has("fn__none"), false);
    panel.click("sheet-back");
    assert.deepEqual(panel.actions, ["close", "back"]);
});

test("sorting the first view downward does not move or dismiss the database panel", () => {
    const panel = createPanel();
    panel.drag(true, 200);
    assert.equal(panel.menu.style.transform, "");
    assert.equal(panel.scrim.style.opacity, "");
    panel.end();
    assert.equal(panel.closes(), 0);
});

test("sorting a later view upward leaves the database panel stationary", () => {
    const panel = createPanel();
    panel.drag(true, -50);
    assert.equal(panel.menu.style.transform, "");
    panel.end();
    assert.equal(panel.closes(), 0);
});

test("dragging the database panel background downward still dismisses it", () => {
    const panel = createPanel();
    panel.drag(false, 200);
    assert.equal(panel.menu.style.transform, "translateY(200px)");
    panel.end();
    assert.equal(panel.closes(), 1);
});
