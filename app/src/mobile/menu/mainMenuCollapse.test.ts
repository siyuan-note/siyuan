import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

test("mobile menu collapse persists independently and search temporarily reveals its items", () => {
    const storage: Record<string, unknown> = {};
    const writes: unknown[] = [];
    const groups = ["navigation", "extensions"].map(id => {
        let hidden = false;
        const attributes = new Map<string, string>();
        const group = {
            dataset: {menuGroup: id},
            closest: () => menu,
            querySelector: (selector: string): unknown => selector.includes("group-items") ? {
                classList: {toggle: (_name: string, value: boolean) => { hidden = value; }},
            } : selector.includes("group-title") ? {textContent: id} : button,
        };
        const button = {
            disabled: false,
            hasAttribute: () => button.disabled,
            closest: () => group,
            setAttribute: (key: string, value: string) => attributes.set(key, value),
            querySelector: () => ({setAttribute() {}}),
        };
        return {group, button, hidden: () => hidden, attributes};
    });
    const menu = {querySelectorAll: (): unknown[] => groups.map(value => value.group)};
    const exports = {} as {
        syncMainMenuGroupCollapse: (element: unknown, searching: boolean) => void;
        toggleMainMenuGroup: (button: unknown) => void;
    };
    runInNewContext(transpileModule(readFileSync("src/mobile/menu/mainMenuCollapse.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText, {
        exports,
        window: {siyuan: {storage, languages: {expand: "Expand", collapse: "Collapse"}}},
        require: () => ({Constants: {LOCAL_MOBILE_MENU_COLLAPSED: "collapsed"},
            setStorageVal: (_key: string, value: unknown) => writes.push(value)}),
    });
    exports.syncMainMenuGroupCollapse(menu, false);
    assert.deepEqual(groups.map(value => value.hidden()), [false, false]);
    exports.toggleMainMenuGroup(groups[1].button);
    assert.equal(JSON.stringify(storage.collapsed), '["extensions"]');
    assert.deepEqual(groups.map(value => value.hidden()), [false, true]);
    assert.equal(groups[1].attributes.get("aria-expanded"), "false");
    exports.syncMainMenuGroupCollapse(menu, true);
    assert.deepEqual(groups.map(value => value.hidden()), [false, false]);
    exports.toggleMainMenuGroup(groups[1].button);
    assert.equal(writes.length, 1);
    exports.syncMainMenuGroupCollapse(menu, false);
    assert.equal(groups[1].hidden(), true);
    exports.toggleMainMenuGroup(groups[1].button);
    assert.equal(groups[1].hidden(), false);
    assert.equal(writes.length, 2);
});
