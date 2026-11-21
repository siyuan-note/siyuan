import {readFileSync} from "node:fs";
import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {runInNewContext} from "node:vm";
import {createSourceFile, isClassDeclaration, ModuleKind, ScriptTarget, transpileModule} from "typescript";
import type {Menu} from "./Menu";
import {getVisibleSheetViewport} from "./sheetOpen";
import {getMobileSheetHeight} from "../mobile/util/mobileSheetGesture";

const source = createSourceFile("Menu.ts", readFileSync("src/menus/Menu.ts", "utf8"), ScriptTarget.ES2021, true);
const declaration = source.statements.find(statement => isClassDeclaration(statement) && statement.name?.text === "Menu");
const compiled = transpileModule(declaration.getText(source), {
    compilerOptions: {target: ScriptTarget.ES2021, module: ModuleKind.CommonJS},
}).outputText;

const setup = (options: {
    viewportHeight: number,
    visualHeight?: number,
    visualOffsetTop?: number,
    expanded?: boolean,
    safeTop?: number,
    toolbarTop?: number,
}) => {
    const windowResizeListeners = new Set<() => void>();
    const viewportResizeListeners = new Set<() => void>();
    const classes = new Set<string>(["b3-menu--sheet"]);
    if (options.expanded) {
        classes.add("b3-menu--expanded");
    }
    const element = {
        style: {height: "100px"} as CSSStyleDeclaration,
        classList: {
            contains: (name: string) => classes.has(name),
        },
    };
    const module = {exports: {} as {Menu: typeof Menu}};
    const toolbar = {top: options.toolbarTop, height: 40, classList: {contains: () => false},
        getBoundingClientRect: () => ({top: toolbar.top, height: toolbar.height})};
    const window = {
            innerHeight: options.viewportHeight,
            siyuan: {mobile: {size: {portrait: {height1: options.viewportHeight}}}},
            addEventListener: (name: string, listener: () => void) => {
                if (name === "resize") {
                    windowResizeListeners.add(listener);
                }
            },
            removeEventListener: (name: string, listener: () => void) => {
                if (name === "resize") {
                    windowResizeListeners.delete(listener);
                }
            },
            visualViewport: {
                height: options.visualHeight ?? options.viewportHeight,
                offsetTop: options.visualOffsetTop ?? 0,
                addEventListener: (name: string, listener: () => void) => {
                    if (name === "resize") {
                        viewportResizeListeners.add(listener);
                    }
                },
                removeEventListener: (name: string, listener: () => void) => {
                    if (name === "resize") {
                        viewportResizeListeners.delete(listener);
                    }
                },
            },
    };
    runInNewContext(compiled, {exports: module.exports, getVisibleSheetViewport, getMobileSheetHeight, window,
        bindKeyboardSheetState: () => () => {},
        getComputedStyle: () => ({paddingTop: (options.safeTop || 0) + "px"}),
        document: {getElementById: () => options.toolbarTop === undefined ? undefined : toolbar,
            createElement: () => ({style: {}, remove() {}}), body: {append() {}}},
    });
    const menu = Object.create(module.exports.Menu.prototype) as Menu;
    Object.assign(menu, {
        element,
        updateSheetTitle: () => {},
        updateTargetPosition: () => {},
        sheetSafeArea: options.safeTop ? {} : undefined,
    });
    return {menu, element, windowResizeListeners, viewportResizeListeners, window, classes, toolbar};
};

describe("mobile menu sheet viewport", () => {
    it("clips half height to the space between the safe area and keyboard toolbar", () => {
        const f = setup({viewportHeight: 800, visualHeight: 300, safeTop: 44, toolbarTop: 250});
        f.menu.resetPosition();
        assert.equal(f.element.style.height, "206px");
        assert.equal(f.element.style.bottom, "550px");
        f.toolbar.top = 220;
        f.menu.resetPosition();
        assert.equal(f.element.style.height, "176px");
        f.toolbar.top = 0;
        f.toolbar.height = 0;
        f.menu.resetPosition();
        assert.equal(f.element.style.height, "256px", "a hidden toolbar reserves no viewport space");
    });

    it("fits an expanded database sheet above the keyboard", () => {
        const {menu, element} = setup({viewportHeight: 800,
            visualHeight: 420, expanded: true});
        menu.resetPosition();
        assert.equal(element.style.height, "420px");
        assert.equal(element.style.bottom, "380px");
    });

    it("keeps a half-height database sheet visible above the keyboard", () => {
        const {menu, element} = setup({viewportHeight: 800,
            visualHeight: 360});
        menu.resetPosition();
        assert.equal(element.style.height, "360px");
        assert.equal(element.style.bottom, "440px");
    });
    it("positions a keyboard-preserving sheet within the visible viewport", () => {
        const {menu, element} = setup({
            viewportHeight: 808,
            visualHeight: 476,
            visualOffsetTop: 32,
        });
        menu.resetPosition();
        assert.equal(element.style.bottom, "300px");
        assert.ok(Math.abs(parseFloat(element.style.height) - 404) < .001);
    });

    it("opens at half height irrespective of content", () => {
        const {menu, element} = setup({viewportHeight: 2000});
        menu.resetPosition();
        assert.equal(element.style.height, "1000px");
    });

    it("tracks asynchronous viewport changes while a sheet is open", () => {
        const {menu, windowResizeListeners, viewportResizeListeners} =
            setup({viewportHeight: 2000});
        const trackingMenu = menu as unknown as {
            startTrackingSheetViewport: () => void,
            stopTrackingTargetPosition: () => void,
        };
        trackingMenu.startTrackingSheetViewport();
        assert.equal(windowResizeListeners.size, 1);
        assert.equal(viewportResizeListeners.size, 1);
        trackingMenu.stopTrackingTargetPosition();
        assert.equal(windowResizeListeners.size, 0);
        assert.equal(viewportResizeListeners.size, 0);
    });
});
