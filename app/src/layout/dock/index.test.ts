import {readFileSync} from "node:fs";
import {join} from "node:path";
import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {runInNewContext} from "node:vm";
import * as ts from "typescript";
import {resolveDockPanelVisibility} from "./panelVisibility";
import {resolveDockResponsiveLayout} from "./responsiveLayout";

const loadDockPrototype = (frames: Array<() => void>, document: object, adjustLayout: () => void,
                           resizeTabs: () => void, isTouchHoverInput = () => false,
                           timers: Array<() => void> = [], siyuan: object = {}) => {
    const exports: {Dock?: {prototype: object}} = {};
    const source = ts.transpileModule(readFileSync(join(__dirname, "index.ts"), "utf8"), {
        compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
    }).outputText;
    runInNewContext(source, {
        exports,
        document,
        window: {siyuan, setTimeout: (callback: () => void) => timers.push(callback), clearTimeout() {}},
        setTimeout: (callback: () => void) => timers.push(callback),
        requestAnimationFrame: (callback: () => void) => frames.push(callback),
        require: (name: string) => {
            if (name === "../util") {
                return {adjustLayout, setPanelFocus: () => {}};
            }
            if (name === "../tabUtil") {
                return {resizeTabs, setTabPosition: () => {}};
            }
            if (name.endsWith("/resize")) {
                return {recordBeforeResizeTop: () => {}};
            }
            if (name.endsWith("/panelVisibility")) {
                return {resolveDockPanelVisibility};
            }
            if (name.endsWith("/constants")) {
                return {Constants: {TIMEOUT_TRANSITION: 200, TIMEOUT_DOCK_TOGGLE: 150,
                    ATTRIBUTE_DOCK_WIDTH: "data-dock-width"}};
            }
            if (name.endsWith("/hasClosest")) {
                return {hasClosestByClassName: (element: HTMLElement, className: string) => {
                    for (let current = element; current; current = current.parentElement) {
                        if (current.classList.contains(className)) {
                            return current;
                        }
                    }
                    return false;
                }};
            }
            if (name.endsWith("/hoverInput")) {
                return {isTouchHoverInput};
            }
            if (name.endsWith("/panelTransition")) {
                return {bindPanelTransitionGuard() {}};
            }
            if (name.endsWith("/barVisibility")) {
                return {syncDockBarVisibility() {}, setDockBarHover() {}, setDockBarPointerOver() {},
                    isDockBarPointerOver: () => false,
                    getDockBarWidth: (element: {clientWidth: number}) => element.clientWidth};
            }
            return {};
        },
    });
    return exports.Dock.prototype;
};

describe("dock initialization", () => {
    for (const position of ["Left", "Right", "Bottom"] as const) {
        for (const pin of [false, true]) {
            it(`${position} ${pin ? "fixed" : "floating"} panel stays behind loading until positioned`, () => {
                const timers: Array<() => void> = [];
                const classes = new Set<string>();
                const classList = {
                    add: (...names: string[]) => names.forEach(name => classes.add(name)),
                    contains: (name: string) => classes.has(name),
                    remove: (...names: string[]) => names.forEach(name => classes.delete(name)),
                };
                const style = {opacity: "", transform: "", zIndex: ""};
                const element = {
                    style, classList, clientWidth: 260, clientHeight: 240,
                    nextElementSibling: {classList}, previousElementSibling: {classList},
                    insertAdjacentHTML() {}, addEventListener() {}, contains: () => false,
                    querySelector: (selector: string) => selector === ".layout__dockresize" ? {addEventListener() {}} : null,
                    setAttribute: (_name: string, value: string) => {
                        style.opacity = /opacity:([^;]+)/.exec(value)?.[1] || "";
                        style.transform = "";
                        style.zIndex = "";
                    },
                };
                const active = {classList, getAttribute: () => "outline"};
                const items = {clientWidth: 40, parentElement: {classList, clientWidth: 40, addEventListener() {}},
                    querySelector: () => active};
                const layout = {element, children: [] as unknown[]};
                const siyuan = {zIndex: 10, config: {uiLayout: {hideDock: false}},
                    layout: {layout: {children: [{children: [layout, {}, layout]}, layout]}}};
                const document = {activeElement: null as HTMLElement | null,
                    querySelector: (): null => null,
                    querySelectorAll: () => [items, items],
                    getElementById: (id: string) => id === "status" ? {offsetHeight: 24} : {lastElementChild: items},
                };
                const prototype = loadDockPrototype([], document, () => {}, () => {}, () => false, timers, siyuan);
                let restored = 0;
                Object.assign(prototype, {toggleModel() {
                    restored++;
                    this.showDock();
                }});
                const Dock = prototype.constructor as typeof import("./index").Dock;
                const dock = new Dock({app: {} as import("../../index").App,
                    position, data: {pin, data: []}});
                assert.equal(restored, 2);
                assert.equal(style.opacity, pin ? "" : "0");
                assert.equal(style.zIndex, "");
                assert.equal(siyuan.zIndex, 10);
                assert.equal(timers.length, pin ? 0 : 1);
                timers.forEach(callback => callback());
                if (!pin) {
                    assert.ok(classes.has("layout--float"));
                    assert.equal(style.opacity, "0");
                    assert.equal(style.transform, position === "Left" ? "translateX(-268px)" :
                        position === "Right" ? "translateX(268px)" : "translateY(248px)");
                }
                dock.showDock();
                assert.equal(style.opacity, pin ? "" : "1");
                assert.equal(siyuan.zIndex, pin ? 10 : 11);
                if (!pin) {
                    assert.equal(style.transform, position === "Left" ? "translateX(40px)" :
                        position === "Right" ? "translateX(-40px)" : "translateY(-24px)");
                    dock.hideDock();
                    assert.equal(style.opacity, "0");
                    assert.equal(style.transform, position === "Left" ? "translateX(-268px)" :
                        position === "Right" ? "translateX(268px)" : "translateY(248px)");
                }
            });
        }
    }
});

it("touch compatibility hover skips dock timers while mouse hover remains available", () => {
    let touch = true;
    const timers: Array<() => void> = [];
    const prototype = loadDockPrototype([], {}, () => {}, () => {}, () => touch, timers);
    const style = {opacity: "0"};
    const dock = Object.assign(Object.create(prototype), {
        panelVisible: true, showDockTimeout: 0, hideDockTimeout: 0,
        layout: {element: {style}}, isFloating: () => true,
    }) as {showDockByHover(): void, hideDockByHover(): void};
    dock.showDockByHover();
    dock.hideDockByHover();
    assert.equal(timers.length, 0);
    touch = false;
    dock.showDockByHover();
    style.opacity = "1";
    dock.hideDockByHover();
    assert.equal(timers.length, 2);
});

describe("dock panel opening", () => {
    it("shows a panel after responsive layout changes it to floating", () => {
        const frames: Array<() => void> = [];
        let floating = false;
        let shows = 0;
        const prototype = loadDockPrototype(frames, {activeElement: null},
            () => frames.push(() => { floating = true; }), () => {});
        const dock = Object.create(prototype) as {
            panelVisible: boolean;
            layout: {element: unknown};
            resizeElement: unknown;
            hasActive(): boolean;
            isFloating(): boolean;
            showDock(): void;
            togglePanel(visible?: boolean): boolean;
        };
        dock.panelVisible = false;
        dock.layout = {element: {
            classList: {toggle: () => {}},
            style: {width: "260px"},
            getAttribute: (): null => null,
            querySelectorAll: (): unknown[] => [],
            querySelector: (): null => null,
            contains: () => false,
        }};
        dock.resizeElement = {classList: {remove: () => {}}};
        dock.hasActive = () => true;
        dock.isFloating = () => floating;
        dock.showDock = () => { if (floating) { shows++; } };

        assert.equal(dock.togglePanel(true), true);
        assert.equal(shows, 0);
        assert.equal(frames.length, 2);
        frames.shift()();
        frames.shift()();
        assert.equal(shows, 1);
    });

});

const createWidthFixture = (position: "Left" | "Right" | "Bottom", pin = true) => {
    const classList = (...initial: string[]) => {
        const classes = new Set(initial);
        return {
            contains: (name: string) => classes.has(name),
            add: (...names: string[]) => names.forEach(name => classes.add(name)),
            remove: (...names: string[]) => names.forEach(name => classes.delete(name)),
            toggle: (name: string, force: boolean) => force ? classes.add(name) : classes.delete(name),
        };
    };
    const attributes: Record<string, string> = {};
    const element = {
        classList: classList(), style: {width: "232px", height: "232px", maxWidth: ""},
        getAttribute: (name: string) => attributes[name] ?? null,
        setAttribute: (name: string, value: string) => { attributes[name] = value; },
        removeAttribute: (name: string) => { delete attributes[name]; },
        querySelector: (): null => null, contains: () => false, addEventListener() {},
    };
    const panels: Array<{parentElement: object, classList: ReturnType<typeof classList>,
        getAttribute(name: string): string}> = [];
    const children = [0, 1].map(() => ({element: {
        parentElement: element, classList: classList("fn__none"), style: {width: "", height: ""},
        nextElementSibling: {classList: classList()}, previousElementSibling: {classList: classList()},
        querySelector: () => ({children: panels}),
    }}));
    children.forEach(child => {
        child.element.querySelector = () => ({children: panels.filter(panel => panel.parentElement === child.element)});
    });
    const items: Record<string, {classList: ReturnType<typeof classList>, getAttribute(name: string): string}> = {};
    const elements = [0, 1].map(index => ({
        parentElement: {classList: classList()},
        querySelector: () => Object.values(items).find(item => item.getAttribute("data-index") === String(index) &&
            item.classList.contains("dock__item--active")),
        querySelectorAll: () => Object.values(items).filter(item => item.getAttribute("data-index") === String(index) &&
            item.classList.contains("dock__item--active")),
    }));
    const document = {activeElement: null as HTMLElement | null,
        querySelector: (selector: string) => items[/data-type="([^"]+)"/.exec(selector)?.[1]],
    };
    const prototype = loadDockPrototype([], document, () => {}, () => {});
    const dock = Object.assign(Object.create(prototype), {
        position, pin, panelVisible: true, responsiveManualOverride: true,
        layout: {element: Object.assign(element, {querySelectorAll: () => panels}), children}, elements,
        resizeElement: {classList: classList()}, data: {}, showDock() {}, hideDock() {},
    }) as import("./index").Dock;
    const add = (type: string, index: number, savedWidth = "232") => {
        const attrs: Record<string, string> = {"data-type": type, "data-index": String(index),
            "data-id": type + "-tab", "data-width": savedWidth};
        items[type] = {classList: classList(), getAttribute: name => attrs[name] ?? null};
        panels.push({parentElement: children[index].element,
            classList: classList("file-tree", "sy__" + type, "fn__none"), getAttribute: name => attrs[name] ?? null});
        Object.assign(dock.data, {[type]: {onGraph() {}, destroy() {}}});
    };
    const open = (type: string) => dock.toggleModel(type, true, false, false, false, false);
    const close = (type: string) => dock.toggleModel(type, false, true, false, false, false);
    return {dock, element, add, open, close};
};

describe("dock minimum width on panel changes", () => {
    for (const position of ["Left", "Right"] as const) {
        for (const pin of [false, true]) {
            for (const index of [0, 1]) {
                it(`${position} ${pin ? "fixed" : "floating"} grows when opening a wide panel in scope ${index}`, () => {
                    const {dock, element, add, open, close} = createWidthFixture(position, pin);
                    add("agentChat", 0);
                    add("backlink", index);
                    open("agentChat");
                    assert.equal(element.style.width, "232px");
                    open("backlink");
                    assert.equal(element.style.width, "320px");
                    assert.equal(dock.getResponsiveMinimumSize(), 320);
                    assert.equal(dock.hasResponsiveManualOverride(), false);
                    open("agentChat");
                    if (index === 1) {
                        close("backlink");
                    }
                    assert.equal(dock.getResponsiveMinimumSize(), 232);
                    assert.equal(element.style.width, "320px");
                });
            }
        }
    }

    for (const type of ["graph", "globalGraph", "backlink", "inbox"]) {
        it(`restores an undersized saved ${type} panel at its minimum width`, () => {
            const {element, add, open} = createWidthFixture("Right");
            element.style.width = "0px";
            add(type, 1);
            open(type);
            assert.equal(element.style.width, "320px");
        });
    }

    it("keeps a larger preferred width while it is compressed by responsive layout", () => {
        const {dock, element, add, open} = createWidthFixture("Left");
        element.style.width = "240px";
        element.style.maxWidth = "240px";
        element.setAttribute("data-dock-width", "460");
        add("backlink", 0);
        open("backlink");
        assert.equal(dock.getResponsivePreferredSize(), 460);
        assert.equal(element.style.maxWidth, "240px");
        assert.equal(dock.hasResponsiveManualOverride(), true);
    });

    it("keeps a user-selected width when opening and closing a wide panel", () => {
        const {element, add, open, close} = createWidthFixture("Right");
        element.style.width = "480px";
        add("file", 0);
        add("backlink", 1);
        open("file");
        open("backlink");
        close("backlink");
        assert.equal(element.style.width, "480px");
    });

    it("repairs the width when revealing a collapsed panel", () => {
        const {dock, element, add, open} = createWidthFixture("Right");
        add("backlink", 0);
        open("backlink");
        dock.togglePanel(false);
        element.style.width = "232px";
        dock.togglePanel(true);
        assert.equal(element.style.width, "320px");
    });

    it("allows a newly widened panel to float when the window is too narrow", () => {
        const {dock, add, open} = createWidthFixture("Right");
        add("agentChat", 0);
        add("backlink", 1);
        open("agentChat");
        open("backlink");
        const result = resolveDockResponsiveLayout({
            availableSize: 750, centerMinimumSize: 480, gapSize: 8, hysteresis: 32,
            left: {preferredSize: 0, minimumSize: 232, participating: false, autoFloating: false, manualOverride: false},
            right: {preferredSize: dock.getResponsivePreferredSize(), minimumSize: dock.getResponsiveMinimumSize(),
                participating: true, autoFloating: false, manualOverride: dock.hasResponsiveManualOverride()},
        });
        assert.equal(result.right.autoFloating, true);
    });

    it("does not change bottom panel dimensions", () => {
        const {element, add, open} = createWidthFixture("Bottom");
        add("backlink", 0);
        open("backlink");
        assert.equal(element.style.width, "232px");
        assert.equal(element.style.height, "232px");
    });
});
describe("dock shortcut opening", () => {
    it("shows a dock item opened by shortcut after responsive layout changes", () => {
        const frames: Array<() => void> = [];
        let floating = false;
        let shows = 0;
        const activeClasses = new Set<string>();
        const target = {
            classList: {
                contains: (name: string) => activeClasses.has(name),
                add: (...names: string[]) => names.forEach(name => activeClasses.add(name)),
                remove: (...names: string[]) => names.forEach(name => activeClasses.delete(name)),
            },
            getAttribute: (name: string) => ({"data-index": "0", "data-id": "outline-tab", "data-width": "260"})[name],
        };
        const classes = {add: () => {}, remove: () => {}};
        const panel = {getAttribute: () => "outline-tab", classList: classes};
        const wnd = {element: {
            classList: classes,
            style: {height: "", width: ""},
            querySelector: () => ({children: [panel]}),
        }};
        const otherWnd = {element: {
            classList: classes,
            style: {height: "", width: ""},
            previousElementSibling: {classList: classes},
        }};
        const document = {activeElement: null as HTMLElement | null, querySelector: () => target};
        const prototype = loadDockPrototype(frames, document, () => {},
            () => frames.push(() => { floating = true; }));
        const dock = Object.create(prototype) as {
            panelVisible: boolean;
            position: string;
            elements: unknown[];
            layout: {children: unknown[], element: unknown};
            data: object;
            isFloating(): boolean;
            showDock(): void;
            toggleModel(type: string, show: boolean, close: boolean, removeDock: boolean,
                        isSaveLayout: boolean, restorePanel: boolean): void;
        };
        dock.panelVisible = true;
        dock.position = "Right";
        dock.elements = [{querySelector: () => activeClasses.has("dock__item--active") ? target : null,
            querySelectorAll: () => activeClasses.has("dock__item--active") ? [target] : []},
            {querySelectorAll: (): unknown[] => []}];
        dock.layout = {children: [wnd, otherWnd], element: {
            style: {width: "0px", marginLeft: "", opacity: ""},
            querySelector: (): null => null,
            querySelectorAll: (): unknown[] => [],
            getAttribute: (): null => null,
            addEventListener: () => {},
        }};
        dock.data = {};
        dock.isFloating = () => floating;
        dock.showDock = () => { if (floating) { shows++; } };

        dock.toggleModel("outline", false, false, false, false, false);
        assert.equal(shows, 0);
        frames.shift()();
        frames.shift()();
        assert.equal(shows, 1);
    });
});
