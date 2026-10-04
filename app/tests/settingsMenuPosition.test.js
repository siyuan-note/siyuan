const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const {test} = require("node:test");
const {runInNewContext} = require("node:vm");
const {ModuleKind, ScriptTarget, transpileModule} = require("typescript");

for (const [width, height] of [[1000, 760], [493, 376]]) {
    for (const anchored of [true, false]) {
        test(`settings menus position below their title bar (${width}x${height}, anchored=${anchored})`, () => {
            const window = {innerWidth: width, innerHeight: height, siyuan: {zIndex: 11},
                addEventListener() {}, removeEventListener() {}};
            const document = {getElementById: () => null,
                querySelector: selector => selector === ".toolbar--settings" ? {clientHeight: 32} : null};
            const load = (file, modules = {}) => {
                const exports = {};
                runInNewContext(transpileModule(readFileSync(file, "utf8"), {
                    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
                }).outputText, {exports, window, document, require: name => modules[name] || {}});
                return exports;
            };
            const topBar = load("src/layout/getTopBarHeight.ts");
            const position = load("src/util/setPosition.ts", {"../layout/getTopBarHeight": topBar});
            const {Menu} = load("src/menus/Menu.ts", {
                "../layout/getTopBarHeight": topBar,
                "../util/setPosition": position,
                "./menuPosition": load("src/menus/menuPosition.ts"),
                "../util/functions": {isMobile: () => false},
                "../config/entryVisibility/runtime": {applyMenuEntryVisibility() {}},
                "./menuGroup": {updateMenuItemGroupClasses() {}},
                "../plugin/EventBusCore": {forEachPluginSubscriber() {}},
            });
            const classes = new Set(["fn__none"]);
            const items = {innerHTML: "<input><div>Fonts</div>", style: {},
                getBoundingClientRect() { return {height: Math.min(300, parseFloat(this.style.maxHeight) || 300)}; }};
            const element = {id: "commonMenu", style: {}, clientWidth: 280, lastElementChild: items,
                getAttribute: () => null, querySelectorAll: () => [],
                classList: {contains: name => classes.has(name), remove: name => classes.delete(name)},
                getBoundingClientRect() {
                    const top = parseFloat(this.style.top) || 0;
                    const left = parseFloat(this.style.left) || 0;
                    const height = items.getBoundingClientRect().height + 18;
                    return {top, left, right: left + 280, bottom: top + height, height, width: 280};
                },
            };
            const menu = Object.assign(Object.create(Menu.prototype), {element, wheelEvent: "wheel"});
            menu.popup({x: width - 210, y: height - 100, h: anchored ? 28 : undefined});
            const rect = element.getBoundingClientRect();
            assert.equal(classes.has("fn__none"), false);
            assert.ok(element.style.top && element.style.left);
            assert.ok(rect.top >= 32, JSON.stringify(rect));
            assert.ok(rect.bottom <= height, JSON.stringify(rect));
            assert.ok(rect.left >= 0 && rect.right <= width, JSON.stringify(rect));
        });
    }
}
