import {readFileSync} from "node:fs";
import {join} from "node:path";
import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {runInNewContext} from "node:vm";
import * as ts from "typescript";
import {resolveDockPanelVisibility} from "./panelVisibility";

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
                return {Constants: {TIMEOUT_TRANSITION: 200, TIMEOUT_DOCK_TOGGLE: 150}};
            }
            if (name.endsWith("/hoverInput")) {
                return {isTouchHoverInput};
            }
            if (name.endsWith("/panelTransition")) {
                return {bindPanelTransitionGuard() {}};
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
                const items = {clientWidth: 40, parentElement: {classList, addEventListener() {}},
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
        dock.elements = [{querySelectorAll: () => activeClasses.has("dock__item--active") ? [target] : []},
            {querySelectorAll: (): unknown[] => []}];
        dock.layout = {children: [wnd, otherWnd], element: {
            style: {width: "0px", marginLeft: "", opacity: ""},
            querySelector: (): null => null,
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
