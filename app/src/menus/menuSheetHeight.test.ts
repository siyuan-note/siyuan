import {readFileSync} from "node:fs";
import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {runInNewContext} from "node:vm";
import {createSourceFile, isClassDeclaration, ModuleKind, ScriptTarget, transpileModule} from "typescript";
import type {Menu} from "./Menu";

const source = createSourceFile("Menu.ts", readFileSync("src/menus/Menu.ts", "utf8"), ScriptTarget.ES2021, true);
const declaration = source.statements.find(statement => isClassDeclaration(statement) && statement.name?.text === "Menu");
const compiled = transpileModule(declaration.getText(source), {
    compilerOptions: {target: ScriptTarget.ES2021, module: ModuleKind.CommonJS},
}).outputText;

const setup = (options: {fit: boolean, contentHeight: number, viewportHeight: number}) => {
    const windowResizeListeners = new Set<() => void>();
    const viewportResizeListeners = new Set<() => void>();
    const classes = new Set<string>(["b3-menu--sheet"]);
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
    };
    const module = {exports: {} as {Menu: typeof Menu}};
    runInNewContext(compiled, {
        exports: module.exports,
        window: {
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
        },
    });
    const menu = Object.create(module.exports.Menu.prototype) as Menu;
    Object.assign(menu, {
        element,
        updateSheetTitle: () => {},
        updateTargetPosition: () => {},
    });
    return {menu, element, itemsStyle, windowResizeListeners, viewportResizeListeners};
};

describe("mobile menu sheet content fit", () => {
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
