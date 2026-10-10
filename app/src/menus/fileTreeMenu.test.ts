import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const fixture = () => {
    let visible = false;
    const opened: Element[] = [];
    const menu = {
        data: undefined as Element | undefined,
        element: {
            classList: {contains: () => !visible},
            contains: () => false,
        },
        remove: () => { visible = false; menu.data = undefined; },
    };
    const context = {
        window: {siyuan: {menus: {menu}}},
        document: {activeElement: null as HTMLElement | null},
        getSelection: () => ({rangeCount: 0}),
        require: () => ({hasClosestByAttribute: (element: {menuTrigger?: boolean}) => element.menuTrigger}),
    };
    const load = <T>(file: string): T => {
        const exports = {} as T;
        runInNewContext(transpileModule(readFileSync(__dirname + file, "utf8"), {
            compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2020},
        }).outputText, {...context, exports});
        return exports;
    };
    const {toggleFileTreeMenu} = load<typeof import("./fileTreeMenu")>("/fileTreeMenu.ts");
    const {globalClickHideMenu} = load<typeof import("./menuClick")>("/menuClick.ts");
    const click = (button: Element) => toggleFileTreeMenu(button, () => {
        menu.remove();
        opened.push(button);
        visible = true;
    });
    return {click, opened, menu, dismiss: globalClickHideMenu, isVisible: () => visible,
        openContextMenu: () => { menu.remove(); visible = true; }};
};

test("repeated clicks on a file tree more button open, close and reopen its menu", () => {
    const f = fixture();
    const button = {} as Element;
    f.click(button);
    assert.equal(f.isVisible(), true);
    f.click(button);
    assert.equal(f.isVisible(), false);
    assert.equal(f.opened.length, 1);
    f.click(button);
    assert.equal(f.isVisible(), true);
    assert.equal(f.opened.length, 2);
});

test("switching between panel, notebook, document and pinned more buttons opens the selected menu", () => {
    const f = fixture();
    const buttons = Array.from({length: 4}, () => ({} as Element));
    buttons.forEach(button => f.click(button));
    assert.equal(f.isVisible(), true);
    assert.deepEqual(f.opened, buttons);
    f.click(buttons[3]);
    assert.equal(f.isVisible(), false);
});

test("outside dismissal permits reopening while trigger clicks retain toggle handling", () => {
    const f = fixture();
    const button = {menuTrigger: true} as unknown as HTMLElement;
    f.click(button);
    f.dismiss(button);
    assert.equal(f.isVisible(), true);
    f.click(button);
    assert.equal(f.isVisible(), false);
    f.click(button);
    f.dismiss({} as HTMLElement);
    assert.equal(f.isVisible(), false);
    f.click(button);
    assert.equal(f.isVisible(), true);
    assert.equal(f.opened.length, 3);
});

test("a context menu replacing a more menu does not consume the next more-button click", () => {
    const f = fixture();
    const button = {} as Element;
    f.click(button);
    f.openContextMenu();
    f.click(button);
    assert.equal(f.opened.length, 2);
    assert.equal(f.menu.data, button);
});
