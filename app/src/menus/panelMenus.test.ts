import * as assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {runInNewContext} from "node:vm";
import * as ts from "typescript";

const loadMenu = (name: "tag" | "bookmark") => {
    let visible = false;
    let menuName: string;
    const positions: {x: number, y: number, h: number}[] = [];
    const menu = {
        element: {
            classList: {contains: () => !visible},
            getAttribute: () => menuName,
            setAttribute: (_key: string, value: string) => { menuName = value; },
        },
        remove: () => { visible = false; },
        append: () => {},
        popup: (position: {x: number, y: number, h: number}) => {
            visible = true;
            positions.push({...position});
        },
    };
    const exports: Record<string, (...args: unknown[]) => void> = {};
    const source = ts.transpileModule(readFileSync(join(__dirname, `${name}.ts`), "utf8"), {
        compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
    }).outputText;
    runInNewContext(source, {
        exports,
        window: {siyuan: {config: {readonly: false}, menus: {menu}, languages: {}}},
        require: (path: string) => {
            if (path === "./Menu") { return {MenuItem: class { element = {}; }}; }
            if (path.endsWith("/constants")) {
                return {Constants: {MENU_TAG: "tag", MENU_BOOKMARK: "bookmark"}};
            }
            return {};
        },
    });
    return {open: exports[name === "tag" ? "openTagMenu" : "openBookmarkMenu"], positions,
        isVisible: () => visible};
};

for (const name of ["tag", "bookmark"] as const) {
    test(`${name} right clicks reopen at the current row and pointer`, () => {
        const {open, positions, isVisible} = loadMenu(name);
        const row = (bottom: number) => ({getAttribute: (): string | null => null,
            getBoundingClientRect: () => ({left: 0, bottom, height: 28})});
        const firstRow = row(120);
        const event = {type: "contextmenu", clientX: 80, clientY: 110};
        open(firstRow, event, "first");
        open(firstRow, {...event, clientX: 150, clientY: 115}, "first");
        open(row(200), {...event, clientX: 210, clientY: 190}, "second");
        assert.equal(isVisible(), true);
        assert.deepEqual(positions, [
            {x: 80, y: 120, h: 28},
            {x: 150, y: 120, h: 28},
            {x: 210, y: 200, h: 28},
        ]);
    });

    test(`${name} more button anchors to the button and toggles on a second click`, () => {
        const {open, positions, isVisible} = loadMenu(name);
        const row = {getAttribute: (): string | null => null};
        const button = {getBoundingClientRect: () => ({left: 240, bottom: 120, height: 20})};
        const event = {type: "click", clientX: 250, clientY: 110, target: {closest: () => button}};
        open(row, event, "first");
        assert.equal(isVisible(), true);
        assert.deepEqual(positions, [{x: 240, y: 120, h: 20}]);
        open(row, event, "first");
        assert.equal(isVisible(), false);
        assert.equal(positions.length, 1);
    });
}
