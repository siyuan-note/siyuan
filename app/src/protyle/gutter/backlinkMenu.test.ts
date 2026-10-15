import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import test from "node:test";
import {createSourceFile, forEachChild, isIfStatement, ScriptTarget, transpileModule} from "typescript";

const preprocess = require("ifdef-loader/preprocessor").parse;
const source = createSourceFile("index.ts", readFileSync(join(__dirname, "index.ts"), "utf8"), ScriptTarget.Latest, true);
let menuSource: string;
const collect = (node: import("typescript").Node) => {
    if (isIfStatement(node) && node.expression.getText(source) === "!protyle.options.backlinkData") {
        menuSource = node.getText(source);
    }
    forEachChild(node, collect);
};
collect(source);
assert.ok(menuSource);

const fixture = (mobile: boolean, backlink = true, folded = false) => {
    const items: IMenu[] = [];
    const opened: unknown[][] = [];
    const protyle = {app: {}, notebookId: "source-notebook", options: {backlinkData: backlink}};
    const action = folded ? ["highlight", "all"] : ["highlight", "context", "root-scroll"];
    const dependencies = {
        protyle,
        id: "source-block",
        window: {siyuan: {menus: {menu: {append: (item: IMenu) => items.push(item)}},
            config: {keymap: {general: {enter: {custom: "enter"}, enterBack: {custom: "back"}}}},
            languages: {openBy: "Open", enter: "Enter", enterBack: "Back", click: "Click"}}},
        MenuItem: class {public element: IMenu; constructor(options: IMenu) {this.element = options;}},
        updateHotkeyTip: (key: string) => key,
        updateHotkeyAfterTip: (key: string) => key,
        checkFold: (id: string, callback: (zoomIn: boolean, action: string[]) => void) => {
            assert.equal(id, "source-block");
            callback(folded, action);
        },
        openMobileFileById: (...args: unknown[]) => opened.push(args),
        openFileById: (...args: unknown[]) => opened.push(args),
        zoomOut: () => {},
        enterBack: () => {},
    };
    const js = transpileModule(preprocess(menuSource, {MOBILE: mobile}, false, true), {
        compilerOptions: {target: ScriptTarget.ES2021},
    }).outputText;
    new Function(...Object.keys(dependencies), js)(...Object.values(dependencies));
    return {items, opened, protyle, action};
};

test("mobile backlink menus open the source block with its notebook and fold actions", () => {
    for (const folded of [false, true]) {
        const {items, opened, protyle, action} = fixture(true, true, folded);
        assert.equal(items.length, 1);
        assert.equal(items[0].id, "enter");
        assert.equal(items[0].label, "Open");
        assert.equal(items[0].accelerator, undefined);
        items[0].click(undefined, undefined);
        assert.deepEqual(opened, [[protyle.app, "source-block", action, undefined, protyle.notebookId]]);
    }
});

test("desktop backlink menus retain their open action and shortcut", () => {
    for (const folded of [false, true]) {
        const {items, opened, protyle, action} = fixture(false, true, folded);
        assert.equal(items.length, 1);
        assert.ok(items[0].accelerator);
        items[0].click(undefined, undefined);
        assert.deepEqual(opened, [[{app: protyle.app, id: "source-block", action, zoomIn: folded}]]);
    }
});

test("ordinary block menus retain enter and back actions on both platforms", () => {
    for (const mobile of [false, true]) {
        const {items} = fixture(mobile, false);
        assert.deepEqual(items.map(item => item.id), ["enter", "enterBack"]);
    }
});
