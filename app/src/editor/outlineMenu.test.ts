import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isClassDeclaration, ScriptTarget, transpileModule} from "typescript";

for (const path of ["src/layout/dock/Outline.ts", "src/mobile/dock/MobileOutline.ts"]) {
    test(`${path}: outline expand menu lists actions first without stale state`, () => {
        const source = createSourceFile(path, readFileSync(path, "utf8"), ScriptTarget.ES2021, true);
        const method = source.statements.find(isClassDeclaration).members.find(member => member.name?.getText(source) === "showExpandLevelMenu");
        const compiled = transpileModule(`class Harness {${method.getText(source)}}; globalThis.Harness = Harness;`, {
            compilerOptions: {target: ScriptTarget.ES2021},
        }).outputText;
        const items: IMenu[] = [];
        const locations: unknown[] = [];
        const menu = {element: {setAttribute: () => {}}, remove: () => {}, append: (item: IMenu) => items.push(item),
            popup: (position: unknown) => locations.push(position), fullscreen: (position: unknown) => locations.push(position)};
        const context = {
            window: {siyuan: {menus: {menu}, languages: new Proxy({}, {get: (_target, key) => String(key)}),
                config: {keymap: {editor: {general: {expand: {custom: "Ctrl+Down"}, collapse: {custom: "Ctrl+Up"}}}}}}},
            Constants: {MENU_OUTLINE_EXPAND_LEVEL: "outline-expand-level"},
            MenuItem: class {element: IMenu; constructor(item: IMenu) { this.element = item; }},
        };
        const Harness = runInNewContext(`${compiled}\nHarness;`, context);
        const harness = new Harness();
        const actions: unknown[] = [];
        harness.setAllExpanded = (expanded: boolean) => actions.push(expanded);
        harness.expandToLevel = (level: number) => actions.push(level);
        harness.showExpandLevelMenu({getBoundingClientRect: () => ({left: 10, bottom: 20, height: 30})});
        assert.deepEqual(items.map(item => item.id), ["expandAll", "foldAll", "separator_all", "heading1", "heading2", "heading3", "heading4", "heading5", "heading6"]);
        assert.ok(items.every(item => item.current === undefined));
        items.forEach(item => item.click?.(undefined, undefined));
        assert.deepEqual(actions, [true, false, 1, 2, 3, 4, 5, 6]);
        if (path.includes("mobile")) {
            assert.deepEqual(locations, ["bottom"]);
        } else {
            assert.deepEqual(items.slice(0, 2).map(item => item.accelerator), ["Ctrl+Down", "Ctrl+Up"]);
            assert.deepEqual(JSON.parse(JSON.stringify(locations)), [{x: 10, y: 20, h: 30}]);
        }
    });
}
