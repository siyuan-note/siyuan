import {readFileSync} from "node:fs";
import {join} from "node:path";
import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {runInNewContext} from "node:vm";
import * as ts from "typescript";
import {resolveDockPanelVisibility} from "./panelVisibility";

const loadDockPrototype = (frames: Array<() => void>, document: object, adjustLayout: () => void,
                           resizeTabs: () => void) => {
    const exports: {Dock?: {prototype: object}} = {};
    const source = ts.transpileModule(readFileSync(join(__dirname, "index.ts"), "utf8"), {
        compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
    }).outputText;
    runInNewContext(source, {
        exports,
        document,
        window: {setTimeout: () => 0},
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
                return {Constants: {TIMEOUT_TRANSITION: 200}};
            }
            return {};
        },
    });
    return exports.Dock.prototype;
};

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
