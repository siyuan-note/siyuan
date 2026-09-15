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
    let detail: {element: Element | null; entryPath: string | null};
    const menu = {
        remove: () => { items.length = 0; },
        element: {setAttribute: (): void => undefined},
        append: (item: IMenu) => items.push(item),
    };
    const dependencies = {
        Constants: {MENU_BAR_ENTRY: "barEntry"},
        TOP_BAR_ROOT_PATH: "topBar",
        MenuItem: class {constructor(public element: IMenu) {}},
        refreshTopBarEntryCatalog: (): void => undefined,
        buildEntryVisibilityToggleItem: () => ({id: "hide"}),
        buildEntryVisibilityMenuItems: () => [{id: "visible"}, {id: "hidden", checked: false}],
        emitOpenMenu: (options: {type: string; appendToMenu: boolean; detail: typeof detail}) => {
            assert.equal(options.type, "open-menu-topbar");
            assert.equal(options.appendToMenu, false);
            detail = options.detail;
            return pluginItems;
        },
    };
    const exports: {initTopBarMenu?: (target?: Element) => unknown} = {};
    runInNewContext(source, {exports, require: () => dependencies, window: {siyuan: {menus: {menu}}}});
    exports.initTopBarMenu(target);
    return {items, detail};
};

test("top bar plugin actions precede visibility controls and retain target identity", () => {
    const target = {getAttribute: () => "plugin-test"} as unknown as Element;
    const {items, detail} = open([{id: "action"}], target);
    assert.equal(detail.element, target);
    assert.equal(detail.entryPath, "topBar.plugin-test");
    assert.deepEqual(items.map(item => item.type || item.id), [
        "action", "separator", "hide", "separator", "visible", "hidden",
    ]);
});

test("blank top bar supplies null context and normalizes plugin separators", () => {
    const separator: IMenu = {type: "separator"};
    const {items, detail} = open([
        separator, {id: "first"}, separator, {id: "ignored", ignore: true}, separator,
        {id: "second"}, separator, separator,
    ]);
    assert.equal(detail.element, null);
    assert.equal(detail.entryPath, null);
    assert.deepEqual(items.map(item => item.type || item.id), [
        "first", "separator", "second", "separator", "visible", "hidden",
    ]);
});

test("empty and ignored plugin groups do not add separators", () => {
    for (const pluginItems of [[], [{type: "separator"}, {id: "ignored", ignore: true}] as IMenu[]]) {
        assert.deepEqual(open(pluginItems).items.map(item => item.id), ["visible", "hidden"]);
    }
});
