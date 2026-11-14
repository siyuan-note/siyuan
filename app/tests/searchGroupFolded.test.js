const assert = require("node:assert/strict");
const fs = require("node:fs");
const {test} = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");
const {parseFragment} = require("parse5");

const source = file => ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
const compile = code => ts.transpileModule(code, {compilerOptions: {target: ts.ScriptTarget.ES2021,
    module: ts.ModuleKind.CommonJS}}).outputText;
const declaration = (file, name) => {
    const tree = source(file);
    const item = tree.statements.filter(ts.isVariableStatement).flatMap(node => [...node.declarationList.declarations])
        .find(node => node.name.getText(tree) === name);
    assert.ok(item, name);
    return "const " + item.getText(tree) + ";";
};
const load = (file, name, context) => vm.runInNewContext(compile(declaration(file, name)) + "\n" + name, context);

class Element {
    constructor(node = {}) {
        this.attributes = Object.fromEntries((node.attrs || []).map(attr => [attr.name, attr.value]));
        this.children = (node.childNodes || []).filter(child => child.tagName).map(child => new Element(child));
        this.children.forEach(child => { child.parentElement = this; });
        this.classList = {
            contains: name => (this.attributes.class || "").split(" ").includes(name),
            add: name => { if (!this.classList.contains(name)) this.attributes.class = [this.attributes.class, name].filter(Boolean).join(" "); },
            remove: name => { this.attributes.class = (this.attributes.class || "").split(" ").filter(item => item !== name).join(" "); },
            toggle: name => { const value = !this.classList.contains(name); this.classList[value ? "add" : "remove"](name); return value; },
        };
        this.scrollTop = 0;
        this.clientHeight = 200;
        this.offsetTop = 28;
    }
    set innerHTML(html) {
        this.children = new Element(parseFragment(html)).children;
        this.children.forEach(child => { child.parentElement = this; });
    }
    get id() { return this.attributes.id; }
    get dataset() { return {nodeId: this.getAttribute("data-node-id"), nodeType: this.getAttribute("data-node-type")}; }
    get firstElementChild() { return this.children[0] || null; }
    get lastElementChild() { return this.children.at(-1) || null; }
    get previousElementSibling() { return this.parentElement?.children[this.parentElement.children.indexOf(this) - 1] || null; }
    get nextElementSibling() { return this.parentElement?.children[this.parentElement.children.indexOf(this) + 1] || null; }
    getAttribute(name) { return this.attributes[name] ?? null; }
    setAttribute(name, value) { this.attributes[name] = value; }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    querySelectorAll(selector) {
        const matches = node => selector.startsWith(".") ? node.classList.contains(selector.slice(1)) :
            selector.startsWith("#") ? node.id === selector.slice(1) :
                node.getAttribute(selector.slice(1, selector.indexOf("="))) === selector.slice(selector.indexOf("=") + 2, -2);
        return this.children.flatMap(child => [...(matches(child) ? [child] : []), ...child.querySelectorAll(selector)]);
    }
    scrollIntoView() { this.scrolled = true; }
    getBoundingClientRect() {
        assert.equal(this.parentElement.classList.contains("fn__none"), false, "menu anchor must be visible");
        return {left: 40, bottom: 56};
    }
}

const fixture = (mobile, folded, group = 1) => {
    const host = new Element();
    host.innerHTML = '<div><span data-type="result"></span></div><div id="searchList"></div>';
    const list = host.querySelector("#searchList");
    const editor = new Element();
    const drag = new Element();
    const previews = [];
    const config = {group, method: 0, page: 1};
    const window = {siyuan: {config: {search: folded === undefined ? {} : {groupFolded: folded}}, languages: {}}};
    const context = {window, document: {querySelector: () => list},
        escapeHtml: value => value, escapeHtmlTextAndAttr: value => value, getDisplayName: value => value,
        getNotebookName: () => "Notebook", getNotebookIcon: () => "", getFileTreeIconHTML: () => "",
        unicode2Emoji: () => "", getIconByType: () => "iconParagraph", getAttr: () => "",
        getArticle: options => previews.push(options.id), getSearchAVMatchesFromHTML: () => []};
    const onSearch = load(mobile ? "src/mobile/menu/search.ts" : "src/search/util.ts", mobile ? "onRecentBlocks" : "onSearch", context);
    const data = ["one", "two"].map((doc, index) => ({box: "box", hPath: doc, children:
        Array.from({length: index ? 1 : 2}, (_, i) => ({id: doc + i, rootID: doc, type: "NodeParagraph", ial: {}, content: "hit", box: "box", hPath: doc}))}));
    const flat = data.flatMap(item => item.children);
    const element = {querySelector: selector => selector === "#searchList" ? list : selector === ".search__drag" ? drag :
        selector === "#searchInput" ? {value: "hit"} : list.querySelector(selector)};
    const render = (focus) => mobile ? onSearch(group ? data : flat, config, undefined, focus) :
        onSearch(group ? data : flat, {protyle: {element: editor}}, element, config, focus);
    return {render, context, config, list, host, previews, window};
};

const groups = state => state.list.children.filter(child => !child.classList.contains("b3-list-item"));
const assertFolded = (state, expected) => {
    assert.deepEqual(groups(state).map(item => item.classList.contains("fn__none")), expected);
    assert.deepEqual(state.list.querySelectorAll(".b3-list-item__arrow").map(item => !item.classList.contains("b3-list-item__arrow--open")), expected);
};
const click = (file, condition, context) => {
    const tree = source(file);
    let body;
    const visit = node => {
        if (ts.isIfStatement(node) && node.expression.getText(tree) === condition) body = node.thenStatement.getText(tree);
        ts.forEachChild(node, visit);
    };
    visit(tree);
    assert.ok(body, condition);
    vm.runInNewContext(compile("do " + body + " while (false);"), {...context, event: {stopPropagation() {}, preventDefault() {}}});
};

for (const mobile of [false, true]) {
    const file = mobile ? "src/mobile/menu/search.ts" : "src/search/util.ts";
    test((mobile ? "mobile" : "desktop") + " grouped rendering follows saved preference on every refresh and retains manual controls", () => {
        for (const preference of [undefined, false, true]) {
            const state = fixture(mobile, preference);
            state.render();
            assertFolded(state, [!!preference, !!preference]);
            assert.equal(state.list.querySelector(".b3-list-item--focus").dataset.nodeId, "one0");
            if (!mobile) assert.deepEqual(state.previews, ["one0"]);
            const context = {searchPanelElement: state.list, searchListElement: state.list};
            click(file, mobile ? 'type === "expand"' : 'target.id === "searchExpand"', context);
            assertFolded(state, [false, false]);
            click(file, mobile ? 'type === "contract"' : 'target.id === "searchCollapse"', context);
            assertFolded(state, [true, true]);
            click(file, 'target.classList.contains("b3-list-item__toggle")', {...context, target: state.list.firstElementChild.firstElementChild});
            assertFolded(state, [false, true]);
            assert.equal(state.window.siyuan.config.search.groupFolded, preference);
            state.render({currentId: "two0"});
            assertFolded(state, [!!preference, !!preference]);
            assert.equal(state.list.querySelector(".b3-list-item--focus").dataset.nodeId, "two0");
            if (!mobile) assert.deepEqual(state.previews, ["one0", "two0"]);
            state.render();
            assertFolded(state, [!!preference, !!preference]);
        }
    });
    test((mobile ? "mobile" : "desktop") + " ungrouped results ignore the folding preference", () => {
        const state = fixture(mobile, true, 0);
        state.render();
        assert.equal(state.list.children.length, 3);
        assert.equal(state.list.querySelectorAll(".fn__none").length, 0);
        assert.equal(state.list.querySelectorAll(".b3-list-item__arrow").length, 0);
    });
}

test("the shared more menu persists only the confirmed preference and disables it when grouping is unavailable", async () => {
    for (const [method, group, disabled] of [[0, 0, true], [0, 1, false], [2, 1, false], [4, 1, true]]) {
        const items = [];
        let refreshes = 0;
        const pending = [];
        const state = fixture(false, false, group);
        state.config.method = method;
        const context = {window: state.window, Constants: {}, isDisabledFeature: () => true, withSearchMethodAvailability: item => item,
            getSearchMethodCapabilities: (method) => ({group: method !== 4}), isSearchSortAvailable: () => true,
            MenuItem: class { constructor(options) { this.element = options; } },
            searchConfigApi: {patch: async (key, value, applied) => {
                assert.equal(key, "groupFolded");
                pending.push(() => { state.window.siyuan.config.search[key] = value; applied(); });
            }}};
        state.window.siyuan.languages.searchGroupFolded = "fold groups";
        state.window.siyuan.menus = {menu: {element: new Element(), remove() {}, append: item => items.push(item)}};
        const moreMenu = load("src/search/menu.ts", "moreMenu", context);
        await moreMenu(state.config, [], {}, () => { refreshes++; }, () => {});
        const toggle = items.find(item => item.label === "fold groups");
        assert.ok(toggle);
        assert.equal(toggle.disabled, disabled);
        assert.equal(toggle.current, false);
        if (disabled) continue;
        toggle.click();
        assert.equal(refreshes, 0);
        assert.equal(state.window.siyuan.config.search.groupFolded, false);
        pending.shift()();
        assert.equal(refreshes, 1);
        state.render();
        assertFolded(state, [true, true]);
        toggle.click();
        pending.shift()();
        state.render();
        assertFolded(state, [false, false]);
    }
});

test("keyboard navigation and context menus reveal their group without changing the preference", () => {
    const state = fixture(false, true);
    state.render();
    const hidden = new Element();
    hidden.classList.add("fn__none");
    const body = {querySelector: selector => ["#searchAssets", "#searchUnRefPanel"].includes(selector) ? hidden :
        selector === "#searchInput" ? {value: "hit"} : state.list};
    state.window.siyuan.dialogs = [{element: {contains: () => true, querySelector: selector => selector === "#searchList" ? state.list : body},
        data: state.config, editors: {edit: {protyle: {}}}}];
    state.window.siyuan.storage = {};
    state.window.siyuan.config.keymap = {general: {openContextMenu: "context"}, editor: {general: {}}};
    state.window.siyuan.menus = {menu: {element: hidden}};
    const exports = {};
    let contextMenu = false;
    let menuPosition;
    vm.runInNewContext(compile(fs.readFileSync("src/boot/globalEvent/searchKeydown.ts", "utf8")), {
        exports, window: state.window, getSelection: () => ({rangeCount: 1, getRangeAt: () => ({startContainer: {}})}),
        require: () => ({matchHotKey: binding => contextMenu && binding === "context",
            initSearchMenu: () => ({popup: position => { menuPosition = position; }}),
            hasClosestByClassName: () => false, Constants: {KEYCODELIST: {}},
            getSearchAVMatches: () => [], getArticle: options => state.previews.push(options.id)})});
    for (const [key, expected, folds] of [["ArrowDown", "one1", [false, true]], ["ArrowDown", "two0", [false, false]],
        ["ArrowDown", "one0", [false, false]], ["ArrowUp", "two0", [false, false]]]) {
        assert.equal(exports.searchKeydown({}, {key, target: {id: "searchInput"}}), true);
        assert.equal(state.list.querySelector(".b3-list-item--focus").dataset.nodeId, expected);
        assert.equal(state.previews.at(-1), expected);
        assertFolded(state, folds);
    }
    state.render();
    assertFolded(state, [true, true]);
    assert.equal(exports.searchKeydown({}, {key: "ArrowUp", target: {id: "searchInput"}}), true);
    assertFolded(state, [true, false]);
    assert.equal(state.window.siyuan.config.search.groupFolded, true);
    state.render();
    contextMenu = true;
    assert.equal(exports.searchKeydown({}, {key: "F10", target: {id: "searchInput"}}), true);
    assert.equal(menuPosition.x, 70);
    assert.equal(menuPosition.y, 56);
    assertFolded(state, [false, true]);
    assert.equal(state.window.siyuan.config.search.groupFolded, true);
});
