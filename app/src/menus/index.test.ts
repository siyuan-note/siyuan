import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {getDocTreeMenuItems} from "./navigationSelection";

const {parse} = require("ifdef-loader/preprocessor");
const compiled = transpileModule(parse(readFileSync("src/menus/index.ts", "utf8"),
    {MOBILE: false, BROWSER: true}, false, true, "index.ts"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

for (const [label, attribute] of [["virtual row", "data-notebook-id"], ["pinned row", "data-notebook"], ["legacy row", ""]]) {
    test(`document context menu retains notebook identity from a ${label}`, () => {
        const calls: unknown[] = [];
        let positioned = false;
        let contextmenu: (event: unknown) => void;
        const body = {};
        const container = {isEqualNode: () => false};
        const attributes: Record<string, string> = {"data-type": "navigation-file", "data-node-id": "doc", "data-path": "/doc.sy"};
        if (attribute) { attributes[attribute] = "box"; }
        const legacyRoot = attribute ? undefined : {getAttribute: () => "box"};
        const row = {parentElement: container, isEqualNode: () => false,
            getAttribute: (name: string) => attributes[name] ?? null,
            closest: (selector: string) => selector === "ul[data-url]" ? legacyRoot : null,
            getBoundingClientRect: () => ({bottom: 30, height: 28}),
        };
        const child = {parentElement: row, getAttribute: (): null => null, hasAttribute: () => false,
            classList: {contains: () => false}, closest: (): null => null};
        const exported: {Menus?: new (app: unknown) => unknown} = {};
        runInNewContext(compiled, {exports: exported,
            window: {siyuan: {config: {readonly: false}}, addEventListener: (type: string, callback: typeof contextmenu) => {
                assert.equal(type, "contextmenu"); contextmenu = callback;
            }},
            document: {querySelector: () => body}, getSelection: () => ({rangeCount: 0}),
            require: (name: string) => {
                const dependencies: Record<string, unknown> = {
                    "./Menu": {Menu: class {}}, "./menuClick": {bindTouchMenuDismiss() {}},
                    "./navigationSelection": {getDocTreeMenuItems},
                    "../protyle/util/hasClosest": {hasClosestByClassName: (): null => null},
                    "../layout/util": {setPanelFocus() {}},
                    "./navigation": {initFileMenu: (_app: unknown, notebook: string, path: string, target: unknown) => {
                        calls.push({notebook, path, target});
                        return {popup: () => { positioned = true; }};
                    }},
                };
                return dependencies[name] || {};
            }});
        new exported.Menus({});
        contextmenu({target: child, preventDefault() {}, stopPropagation() {}});
        assert.deepEqual(calls, [{notebook: "box", path: "/doc.sy", target: row}]);
        assert.equal(positioned, true);
    });
}
