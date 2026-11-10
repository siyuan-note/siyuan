import {readFileSync} from "node:fs";
import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {runInNewContext} from "node:vm";
import {createSourceFile, isClassDeclaration, ModuleKind, ScriptTarget, transpileModule} from "typescript";
import type {Menu} from "./Menu";
import {getVisibleSheetViewport} from "./sheetOpen";
import {getMobileSheetBounds} from "../mobile/util/mobileSheetGesture";

const source = createSourceFile("Menu.ts", readFileSync("src/menus/Menu.ts", "utf8"), ScriptTarget.ES2021, true);
const declaration = source.statements.find(statement => isClassDeclaration(statement) && statement.name?.text === "Menu");
const compiled = transpileModule(declaration.getText(source), {
    compilerOptions: {target: ScriptTarget.ES2021, module: ModuleKind.CommonJS},
}).outputText;

const setup = (options: {
    fit: boolean,
    contentHeight: number,
    viewportHeight: number,
    visualHeight?: number,
    visualOffsetTop?: number,
    preserveKeyboard?: boolean,
    expanded?: boolean,
    expandable?: boolean,
    safeTop?: number,
    toolbarTop?: number,
}) => {
    const windowResizeListeners = new Set<() => void>();
    const viewportResizeListeners = new Set<() => void>();
    const classes = new Set<string>(["b3-menu--sheet"]);
    if (options.expanded) {
        classes.add("b3-menu--expanded");
    }
    if (options.fit) {
        classes.add("b3-menu--fit");
    }
    const title = {getBoundingClientRect: () => ({height: 16})};
    const itemsStyle = {flex: ""} as CSSStyleDeclaration;
    const items = {
        style: itemsStyle,
        // 模拟真实底部菜单中 flex: 1 将内容区域撑满父容器的情况
        get scrollHeight() {
            return itemsStyle.flex === "none" ? options.contentHeight : options.viewportHeight * .9 - 16;
        },
    };
    const element = {
        style: {height: "100px"} as CSSStyleDeclaration,
        firstElementChild: title,
        lastElementChild: items,
        classList: {
            contains: (name: string) => classes.has(name),
        },
        getAttribute: () => options.expandable ? "true" : null,
    };
    const module = {exports: {} as {Menu: typeof Menu}};
    const toolbar = {top: options.toolbarTop, classList: {contains: () => false},
        getBoundingClientRect: () => ({top: toolbar.top})};
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
    runInNewContext(compiled, {exports: module.exports, getVisibleSheetViewport, getMobileSheetBounds, window,
        bindKeyboardSheetState: () => () => {},
        getComputedStyle: () => ({paddingTop: (options.safeTop || 0) + "px"}),
        document: {getElementById: () => options.toolbarTop === undefined ? undefined : toolbar,
            createElement: () => ({style: {}, remove() {}}), body: {append() {}}},
    });
    const menu = Object.create(module.exports.Menu.prototype) as Menu;
    Object.assign(menu, {
        element,
        preserveSheetKeyboard: options.preserveKeyboard ?? false,
        updateSheetTitle: () => {},
        updateTargetPosition: () => {},
        sheetSafeArea: options.safeTop ? {} : undefined,
    });
    return {menu, element, itemsStyle, windowResizeListeners, viewportResizeListeners, window, classes, toolbar};
};

describe("mobile menu sheet content fit", () => {
    it("reserves top safe area and keyboard toolbar in the same numeric manual-height bound", () => {
        const f = setup({fit: true, contentHeight: 2000, viewportHeight: 800, visualHeight: 300,
            safeTop: 44, toolbarTop: 250});
        Object.assign(f.menu, {sheetPreferredHeight: 530});
        f.menu.resetPosition();
        assert.equal(f.element.style.height, "206px");
        assert.equal(f.element.style.maxHeight, "206px");
        assert.equal(f.element.style.bottom, "550px");
        f.toolbar.top = 220;
        f.menu.resetPosition();
        assert.equal(f.element.style.height, "176px");
    });
    it("retains a manual height through keyboard clamping, content updates and expand restore", () => {
        const f = setup({fit: true, contentHeight: 2000, viewportHeight: 800});
        Object.assign(f.menu, {sheetPreferredHeight: 530});
        f.menu.resetPosition();
        assert.equal(f.element.style.height, "530px");
        f.window.visualViewport.height = 300;
        f.menu.resetPosition();
        assert.equal(f.element.style.height, "300px");
        f.window.visualViewport.height = 800;
        f.menu.resetPosition();
        assert.equal(f.element.style.height, "530px");
        f.classes.add("b3-menu--expanded");
        f.menu.resetPosition();
        assert.equal(f.element.style.height, "800px");
        f.classes.delete("b3-menu--expanded");
        f.menu.resetPosition();
        assert.equal(f.element.style.height, "530px");
    });
    it("fits an expanded database sheet above the keyboard", () => {
        const {menu, element} = setup({fit: false, contentHeight: 2000, viewportHeight: 800,
            visualHeight: 420, expanded: true, expandable: true});
        menu.resetPosition();
        assert.equal(element.style.height, "420px");
        assert.equal(element.style.bottom, "380px");
    });

    it("keeps a half-height database sheet visible above the keyboard", () => {
        const {menu, element} = setup({fit: false, contentHeight: 2000, viewportHeight: 800,
            visualHeight: 360, expandable: true});
        menu.resetPosition();
        assert.equal(element.style.height, "360px");
        assert.equal(element.style.bottom, "440px");
    });
    it("positions a keyboard-preserving sheet within the visible viewport", () => {
        const {menu, element} = setup({
            fit: false,
            contentHeight: 272,
            viewportHeight: 808,
            visualHeight: 476,
            visualOffsetTop: 32,
            preserveKeyboard: true,
        });
        menu.resetPosition();
        assert.equal(element.style.bottom, "300px");
        assert.ok(Math.abs(parseFloat(element.style.height) - 428.4) < .001);
    });

    it("keeps the standard sheet height when fitting is not requested", () => {
        const {menu, element} = setup({fit: false, contentHeight: 272, viewportHeight: 2000});
        menu.resetPosition();
        assert.equal(element.style.height, "1120px");
    });

    it("shrinks the sheet to short content", () => {
        const {menu, element, itemsStyle} = setup({fit: true, contentHeight: 272, viewportHeight: 2000});
        menu.resetPosition();
        assert.equal(element.style.height, "288px");
        assert.equal(itemsStyle.flex, "");
    });

    it("caps fitted content at the standard sheet height", () => {
        const {menu, element} = setup({fit: true, contentHeight: 2000, viewportHeight: 2000});
        menu.resetPosition();
        assert.equal(element.style.height, "1120px");
    });

    it("keeps a minimum height for empty content", () => {
        const {menu, element} = setup({fit: true, contentHeight: 0, viewportHeight: 2000});
        menu.resetPosition();
        assert.equal(element.style.height, "160px");
    });

    it("tracks asynchronous viewport changes while a fitted sheet is open", () => {
        const {menu, windowResizeListeners, viewportResizeListeners} =
            setup({fit: true, contentHeight: 272, viewportHeight: 2000});
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
