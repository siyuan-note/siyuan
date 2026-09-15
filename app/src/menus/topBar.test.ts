import * as assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {runInNewContext} from "node:vm";
import * as ts from "typescript";

const source = ts.transpileModule(readFileSync(resolve(process.cwd(), "src/menus/topBar.ts"), "utf8"), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
}).outputText;

const open = (pluginItems: IMenu[], target?: Element) => {
    const items: IMenu[] = [];
    let calledTarget: Element | undefined;
    const menu = {
        remove: () => { items.length = 0; },
        element: {setAttribute: (): void => undefined},
        append: (item: IMenu) => items.push(item),
    };
    const dependencies = {
        Constants: {MENU_BAR_ENTRY: "barEntry"},
        TOP_BAR_ROOT_PATH: "topBar",
        MenuItem: class {constructor(public element: IMenu) {}},
        subMenu: class {public menus: IMenu[] = [];},
        refreshTopBarEntryCatalog: (): void => undefined,
        buildEntryVisibilityToggleItem: () => ({id: "hide"}),
        buildEntryVisibilityMenuItems: () => [{id: "visible"}, {id: "hidden", checked: false}],
        fillTopBarContextMenu: (element: Element, menu: {menus: IMenu[]}) => {
            calledTarget = element;
            menu.menus.push(...pluginItems);
        },
    };
    const exports: {initTopBarMenu?: (target?: Element) => unknown} = {};
    runInNewContext(source, {exports, require: () => dependencies, window: {siyuan: {menus: {menu}}}});
    exports.initTopBarMenu(target);
    return {items, calledTarget};
};

test("top bar plugin actions precede visibility controls and retain target identity", () => {
    const target = {getAttribute: () => "plugin-test"} as unknown as Element;
    const {items, calledTarget} = open([{id: "action"}], target);
    assert.equal(calledTarget, target);
    assert.deepEqual(items.map(item => item.type || item.id), [
        "action", "separator", "hide", "separator", "visible", "hidden",
    ]);
});

test("button menu normalizes plugin separators", () => {
    const separator: IMenu = {type: "separator"};
    const {items} = open([
        separator, {id: "first"}, separator, {id: "ignored", ignore: true}, separator,
        {id: "second"}, separator, separator,
    ], {getAttribute: () => "plugin-test"} as unknown as Element);
    assert.deepEqual(items.map(item => item.type || item.id), [
        "first", "separator", "second", "separator", "hide", "separator", "visible", "hidden",
    ]);
});

test("empty and ignored plugin groups do not add separators", () => {
    for (const pluginItems of [[], [{type: "separator"}, {id: "ignored", ignore: true}] as IMenu[]]) {
        assert.deepEqual(open(pluginItems, {getAttribute: (): null => null} as unknown as Element)
            .items.map(item => item.id), ["visible", "hidden"]);
    }
});

test("blank top bar never invokes plugin callbacks", () => {
    const {items, calledTarget} = open([{id: "action"}]);
    assert.equal(calledTarget, undefined);
    assert.deepEqual(items.map(item => item.id), ["visible", "hidden"]);
});
