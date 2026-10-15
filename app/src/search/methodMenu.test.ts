import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import * as capabilities from "./methodCapabilities";

const {parse} = require("ifdef-loader/preprocessor");

for (const mobile of [true, false]) {
    for (const [method, group] of [[0, 0], [2, 0], [2, 1], [3, 1], [4, 1]]) {
        test(`${mobile ? "mobile" : "desktop"} search menus disable only unsupported options (${method}, ${group})`, async () => {
            const items: IMenu[] = [];
            const languages = new Proxy({}, {get: (_target, key) => key});
            const menu = {element: {classList: {contains: () => true}, setAttribute() {}},
                remove() {}, append: (item: IMenu) => items.push(item)};
            const dependencies: Record<string, unknown> = {
                "./methodCapabilities": capabilities,
                "../menus/Menu": {MenuItem: class {element: IMenu; constructor(options: IMenu) { this.element = options; }}},
                "../constants": {Constants: {MENU_SEARCH_MORE: "more"}},
                "../protyle/util/compatibility": {isDisabledFeature: () => false},
            };
            const source = parse(readFileSync("src/search/menu.ts", "utf8"),
                {MOBILE: mobile, BROWSER: true}, false, true, "menu.ts");
            const code = transpileModule(source, {
                compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
            }).outputText;
            const exports: {moreMenu?: (...args: unknown[]) => Promise<void>} = {};
            runInNewContext(code, {exports, require: (name: string) => dependencies[name] || {},
                window: {siyuan: {languages, menus: {menu}, config: {ai: {embedding: {enabled: true}}}}}});
            await exports.moreMenu({method, group, sort: 0}, [], {}, () => {}, () => {});
            const sort = items.find(item => item.label === "sort");
            const grouping = items.find(item => item.label === "group");
            assert.equal(Boolean(sort.disabled), method === 4 || (method === 2 && group === 0));
            assert.equal(Boolean(grouping.disabled), method === 4);
            assert.ok(grouping.submenu.every(item => Boolean(item.disabled) === (method === 4)));
            for (const item of sort.submenu) {
                const rank = item.label === "sortByRankAsc" || item.label === "sortByRankDesc";
                assert.equal(Boolean(item.disabled), Boolean(sort.disabled) || (rank && method !== 0 && method !== 1));
            }
            assert.equal(Boolean(items.find(item => item.label === "saveCriterion").disabled), false);
            assert.equal(Boolean(items.find(item => item.label === "removeCriterion").disabled), false);
            if (mobile) {
                assert.equal(Boolean(items.find(item => item.label === "searchType").disabled), method === 2);
                assert.equal(Boolean(items.find(item => item.label === "replaceType").disabled), method === 2 || method === 4);
            }
        });
    }
}
