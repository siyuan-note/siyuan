import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {after, before, test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import * as capabilities from "./methodCapabilities";
import * as searchConfig from "./config";

const {parse} = require("ifdef-loader/preprocessor");
const previousWindow = globalThis.window;
before(() => {
    globalThis.window = {siyuan: {languages: {searchControlUnavailable: "searchControlUnavailable"}}} as unknown as Window & typeof globalThis;
});
after(() => {
    globalThis.window = previousWindow;
});

for (const mobile of [true, false]) {
    for (const [method, group] of [[0, 0], [2, 0], [2, 1], [3, 1], [4, 1]]) {
        test(`${mobile ? "mobile" : "desktop"} search menus honor method availability and selected group state (${method}, ${group})`, async () => {
            const items: IMenu[] = [];
            const search: {groupFolded?: boolean} = {};
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
                window: {siyuan: {languages, menus: {menu}, config: {ai: {embedding: {enabled: true}}, search}}}});
            await exports.moreMenu({method, group, sort: 0}, [], {}, () => {}, () => {});
            const sort = items.find(item => item.label === "sort");
            const grouping = items.find(item => item.label === "group");
            assert.deepEqual(Array.from(sort.submenu, item => item.checked),
                Array.from(sort.submenu, (_item, index) => index === 0));
            assert.deepEqual(Array.from(grouping.submenu, item => item.checked), [group === 0, group === 1]);
            assert.equal(Boolean(sort.disabled), method === 4 || (method === 2 && group === 0));
            assert.equal(Boolean(grouping.disabled), method === 4);
            const groupState = items.find(item => item.label === "searchGroupState");
            assert.equal(groupState.type, "submenu");
            assert.equal(Boolean(groupState.disabled), group !== 1 || method === 4);
            assert.deepEqual(Array.from(groupState.submenu, item => item.label), ["expandByDefault", "collapseByDefault"]);
            assert.ok(groupState.submenu.every(item => Boolean(item.disabled) === Boolean(groupState.disabled)));
            assert.ok(grouping.submenu.every(item => Boolean(item.disabled) === (method === 4)));
            for (const item of sort.submenu) {
                const rank = item.label === "sortByRankAsc" || item.label === "sortByRankDesc";
                assert.equal(Boolean(item.disabled), Boolean(sort.disabled) || (rank && method !== 0 && method !== 1));
            }
            assert.equal(items.some(item => item.label === "saveCriterion"), mobile);
            assert.equal(items.some(item => item.label === "removeCriterion"), mobile);
            assert.notEqual(items.at(-1).type, "separator");
            if (mobile) {
                assert.equal(Boolean(items.find(item => item.label === "searchType").disabled), method === 2);
                assert.equal(Boolean(items.find(item => item.label === "replaceType").disabled), method === 2 || method === 4);
                assert.deepEqual(Array.from(items.find(item => item.label === "searchMethod").submenu,
                    item => item.checked), [0, 1, 2, 3, 4].map(value => value === method));
            }
            for (const groupFolded of [undefined, false, true]) {
                search.groupFolded = groupFolded;
                items.length = 0;
                await exports.moreMenu({method, group, sort: 0}, [], {}, () => {}, () => {});
                const submenu = items.find(item => item.label === "searchGroupState").submenu;
                assert.deepEqual(Array.from(submenu, item => item.checked), [!groupFolded, Boolean(groupFolded)]);
            }
            assert.ok(items.flatMap(item => item.submenu || []).every(item => item.current === undefined));
        });
    }
}

const loadMenu = (mobile: boolean, stored: Config.IUILayoutTabSearchConfig,
                  criteria: Config.IUILayoutTabSearchConfig[] = []) => {
    const items: IMenu[] = [];
    const storage = {search: structuredClone(stored)};
    const writes: Config.IUILayoutTabSearchConfig[] = [];
    const menu = {element: {classList: {contains: () => true}, setAttribute() {}},
        remove() {}, append: (item: IMenu) => items.push(item)};
    const dependencies: Record<string, unknown> = {
        "./config": searchConfig,
        "./methodCapabilities": capabilities,
        "../util/functions": {isMobile: () => mobile},
        "../menus/Menu": {MenuItem: class {element: IMenu; constructor(options: IMenu) { this.element = options; }}},
        "../constants": {Constants: {MENU_SEARCH_MORE: "more", LOCAL_SEARCHDATA: "search"}},
        "../protyle/util/compatibility": {isDisabledFeature: () => false,
            setStorageVal: (_key: string, value: Config.IUILayoutTabSearchConfig) => writes.push(structuredClone(value))},
    };
    const source = parse(readFileSync("src/search/menu.ts", "utf8"),
        {MOBILE: mobile, BROWSER: true}, false, true, "menu.ts");
    const code = transpileModule(source, {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    const exports: {moreMenu?: (...args: unknown[]) => Promise<void>} = {};
    runInNewContext(code, {exports, require: (name: string) => dependencies[name] || {},
        window: {siyuan: {storage, languages: new Proxy({}, {get: (_target, key) => key}), menus: {menu},
            config: {ai: {embedding: {enabled: true}}, search: {groupFolded: false}}}}});
    const classes = new Set<string>();
    const attributes: Record<string, string> = {};
    const control = {classList: {
        add: (name: string) => classes.add(name), remove: (name: string) => classes.delete(name),
        toggle: (name: string, force: boolean) => force ? classes.add(name) : classes.delete(name),
    }, toggleAttribute() {}, setAttribute: (name: string, value: string) => attributes[name] = value,
    removeAttribute: (name: string) => delete attributes[name]};
    const element = {querySelector: () => ({...control, parentElement: control})};
    let refreshed = 0;
    return {items, storage, writes, classes, attributes, control,
        open: async (config: Config.IUILayoutTabSearchConfig) => {
            items.length = 0;
            await exports.moreMenu(config, criteria, element, () => { config.page = 1; refreshed++; }, () => {});
        }, refreshed: () => refreshed};
};

for (const mobile of [true, false]) {
    for (const removed of [true, false]) {
        test(`${mobile ? "mobile" : "desktop"} sort and grouping survive reopening after reset=${removed}`, async () => {
            const config: Config.IUILayoutTabSearchConfig = {method: 0, group: 1, sort: 5, page: 3,
                removed, k: "query", idPath: ["notebook/document"], hPath: "Notebook/Document"};
            const savedCriterion = structuredClone(config);
            const h = loadMenu(mobile, config, [savedCriterion]);
            await h.open(config);
            h.items.find(item => item.label === "sort").submenu.find(item => item.label === "modifiedDESC").click(undefined, undefined);
            assert.equal(h.storage.search.sort, 4);
            assert.equal(h.storage.search.page, 1);
            assert.equal(h.writes.at(-1).sort, 4);
            assert.equal(h.refreshed(), 1);
            await h.open(config);
            h.items.find(item => item.label === "group").submenu.find(item => item.label === "noGroupBy").click(undefined, undefined);
            assert.equal(h.storage.search.group, 0);
            assert.equal(h.storage.search.sort, 4);
            const reopened = structuredClone(h.writes.at(-1));
            await h.open(reopened);
            assert.equal(h.items.find(item => item.label === "sort").submenu.find(item => item.label === "modifiedDESC").checked, true);
            assert.equal(h.items.find(item => item.label === "group").submenu.find(item => item.label === "noGroupBy").checked, true);
            config.idPath.push("another-notebook");
            assert.deepEqual(h.storage.search.idPath, ["notebook/document"]);
            assert.equal(savedCriterion.sort, 5);
            assert.equal(savedCriterion.group, 1);
        });
    }

    test(`${mobile ? "mobile" : "desktop"} grouping preserves the remembered global scope`, async () => {
        const stored: Config.IUILayoutTabSearchConfig = {method: 0, group: 1, sort: 5,
            idPath: ["global-notebook"], hPath: "Global"};
        const config = {...stored, idPath: ["temporary-notebook/document"], hPath: "Temporary"};
        searchConfig.setSearchConfigTemporaryPath(config, true);
        const h = loadMenu(mobile, stored);
        await h.open(config);
        h.items.find(item => item.label === "group").submenu.find(item => item.label === "noGroupBy").click(undefined, undefined);
        assert.equal(config.sort, 0);
        assert.equal(h.storage.search.sort, 0);
        assert.equal(h.storage.search.group, 0);
        assert.deepEqual(h.storage.search.idPath, stored.idPath);
        assert.equal(config.hPath, "Temporary");
    });

    test(`${mobile ? "mobile" : "desktop"} menu tooltips explain only unavailable controls`, async () => {
        const h = loadMenu(mobile, {method: 2, group: 0, sort: 0});
        await h.open(h.storage.search);
        const sort = h.items.find(item => item.label === "sort");
        sort.bind(h.control as unknown as HTMLElement);
        assert.equal(h.classes.has("ariaLabel"), true);
        assert.equal(h.attributes["aria-label"], "sort - searchControlUnavailable");
        const group = h.items.find(item => item.label === "group");
        group.bind(h.control as unknown as HTMLElement);
        assert.equal(h.classes.has("ariaLabel"), false);
        assert.equal(h.attributes["aria-label"], "group");
        group.submenu[0].bind(h.control as unknown as HTMLElement);
        assert.equal(h.classes.has("ariaLabel"), false);
    });
}
