import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const createMenu = () => {
    const inside = {};
    const outside = {};
    const trigger = {};
    const state = {removed: 0, closedPending: false, active: outside, selection: outside, rangeCount: 0};
    const exports = {} as typeof import("./menuClick");
    runInNewContext(transpileModule(readFileSync("src/menus/menuClick.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
    }).outputText, {
        exports,
        require: () => ({hasClosestByAttribute: (element: unknown) => element === trigger}),
        window: {siyuan: {menus: {menu: {
            element: {contains: (element: unknown) => element === inside},
            remove: () => { state.removed++; state.closedPending = true; },
        }}}},
        document: {get activeElement() { return state.active; }},
        getSelection: () => ({rangeCount: state.rangeCount, getRangeAt: () => ({startContainer: state.selection})}),
    });
    return {state, inside, outside, trigger, click: (element: unknown) => exports.globalClickHideMenu(element as HTMLElement)};
};

test("outside clicks close shared menus, including a pending hidden font menu", () => {
    const menu = createMenu();
    menu.click(menu.outside);
    assert.equal(menu.state.removed, 1);
    assert.equal(menu.state.closedPending, true);
});

test("menu content and data-menu triggers preserve search and repeated-click handling", () => {
    const menu = createMenu();
    menu.click(menu.inside);
    menu.click(menu.trigger);
    assert.equal(menu.state.removed, 0);
});

test("selecting text in a focused menu preserves the existing selection guard", () => {
    const menu = createMenu();
    menu.state.active = menu.inside;
    menu.state.selection = menu.inside;
    menu.state.rangeCount = 1;
    menu.click(menu.outside);
    assert.equal(menu.state.removed, 0);
    menu.state.active = menu.outside;
    menu.click(menu.outside);
    assert.equal(menu.state.removed, 1);
});

test("a selection outside the menu does not prevent dismissal", () => {
    const menu = createMenu();
    menu.state.active = menu.inside;
    menu.state.rangeCount = 1;
    menu.click(menu.outside);
    assert.equal(menu.state.removed, 1);
});
