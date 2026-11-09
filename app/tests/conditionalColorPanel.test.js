const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const runCases = async (sources, mobile) => {
    const assert = require("node:assert/strict");
    const path = require("node:path").posix;
    document.body.innerHTML = '<div class="b3-menu"></div>';
    const menu = document.body.firstElementChild;
    if (mobile) menu.classList.add("b3-menu--fullscreen", "b3-menu--sheet");
    const requests = [];
    const transactions = [];
    let items;
    let suffix = "";
    let nextID = 0;
    window.Lute = {NewNodeID: () => `new-${++nextID}`};
    window.siyuan = {config: {}, zIndex: 0, languages: sources.languages};
    const fields = [
        {id: "people", name: "People", type: "relation", relation: {avID: "people-db"}},
        {id: "tasks", name: "Tasks", type: "relation", relation: {avID: "tasks-db"}},
        {id: "staff", name: "Staff", type: "rollup", rollup: {relationKeyID: "tasks", keyID: "staff"}},
    ];
    const relationValue = id => ({type: "relation", relation: {blockIDs: [id], contents: []}});
    const rules = [
        {id: "direct", target: "item", color: null, filter: {
            column: "people", operator: "Contains any item", value: relationValue("alice"),
        }},
        {id: "rollup", target: "item", color: null, filter: {
            column: "staff", operator: "Contains any item", value: {type: "rollup", rollup: {contents: [relationValue("bob")]}},
        }},
    ];
    const data = {id: "source", viewID: "view", viewType: "table", view: {columns: fields,
        filters: [{column: "people", operator: "Contains any item", value: relationValue("unrelated")}],
        conditionalColors: rules}};
    const respond = (url, request) => {
        requests.push({url, request});
        if (url.endsWith("getAttributeView")) return {code: 0, data: {av: {keyValues: [{key: {
            id: "staff", type: "relation", relation: {avID: "people-db"},
        }}]}}};
        assert.equal(url, "/api/av/getAttributeViewPrimaryKeyValues");
        return {code: 0, data: {rows: {values: (request.blockIDs || ["alice", "bob", "carol"]).map(id => ({
            blockID: id, block: {content: id[0].toUpperCase() + id.slice(1) + suffix},
        }))}}};
    };
    const mocks = {
        "plugin/Menu": {Menu: class {
            items = [];
            addItem(item) {this.items.push(item);}
            addSeparator() {}
            close() {}
        }},
        "protyle/render/av/viewSettingMenu": {openViewSettingMenu: menu => {items = menu.items;}},
        "protyle/render/av/view": {getFieldsByData: data => data.view.columns},
        "protyle/render/av/col": {getColIconByType: () => "iconDatabase"},
        "protyle/render/av/cell": {genCellValue: type => ({type})},
        "protyle/render/av/color": {getAVColorGridHTML: () => "", getAVColorOrder: () => [], getAVCustomColors: () => [],
            getAVBackgroundColor: () => "red"},
        "protyle/wysiwyg/transaction": {transaction: (_protyle, perform, undo) => transactions.push(structuredClone({perform, undo}))},
        "util/fetch": {fetchSyncPost: async (url, request) => respond(url, request),
            fetchPost: (url, request, callback) => callback(respond(url, request))},
    };
    const cache = {};
    const load = name => {
        if (mocks[name]) return mocks[name];
        if (cache[name]) return cache[name];
        if (!sources[name]) return {};
        const exports = {};
        cache[name] = exports;
        new Function("exports", "require", sources[name])(exports, request =>
            load(path.normalize(path.join(path.dirname(name), request))));
        return exports;
    };
    const open = () => load("protyle/render/av/conditionalColorMenu").openConditionalColorsMenu({
        protyle: {options: {}}, blockElement: {dataset: {nodeId: "carrier"}}, data, menuElement: menu, onResize() {},
    });
    const get = selector => {const element = menu.querySelector(selector); assert.ok(element, selector); return element;};
    const rule = id => get(`[data-rule-id="${id}"]`);
    const labels = id => Array.from(rule(id).querySelectorAll('[data-type="relationFilterTrigger"] .av__relation-filter-chip > .fn__ellipsis'), chip => chip.textContent);
    const assertLabels = (direct = ["Alice"]) => {
        assert.deepEqual(labels("direct"), direct);
        assert.deepEqual(labels("rollup"), ["Bob" + suffix]);
    };
    const changeTarget = () => {
        const target = rule("direct").querySelector('[data-action="target"]');
        target.value = target.value === "item" ? "property" : "item";
        target.dispatchEvent(new Event("change", {bubbles: true}));
    };
    const choose = id => {
        rule(id).querySelector('[data-type="relationFilterTrigger"]').click();
        rule(id).querySelector('[data-type="relationFilterOption"][data-id="carol"]').click();
    };
    await open();
    assertLabels();
    assert.equal(transactions.length, 0);
    assert.equal(requests.length, 2, "metadata and selected labels are batched once per panel");
    assert.deepEqual(requests[1].request, {id: "people-db", blockIDs: ["alice", "bob"]});
    changeTarget();
    assertLabels();
    rule("direct").querySelector('[data-action="color"]').click();
    items[0].click();
    assertLabels();
    get('[data-action="add"]').click();
    items[0].click();
    assertLabels();
    rule("new-1").querySelector('[data-action="remove"]').dispatchEvent(new MouseEvent("click", {bubbles: true}));
    assertLabels();
    const root = get("[data-rules]");
    window.siyuan.dragElement = rule("direct");
    rule("rollup").dispatchEvent(new DragEvent("drop", {bubbles: true, clientY: rule("rollup").getBoundingClientRect().bottom + 1}));
    assert.deepEqual(Array.from(root.children, element => element.dataset.ruleId), ["rollup", "direct"]);
    assertLabels();
    assert.equal(requests.length, 2, "redrawing target, color, added/removed rules and order does not reload labels");
    choose("direct");
    assertLabels(["Alice", "Carol"]);
    changeTarget();
    assertLabels(["Alice", "Carol"]);
    choose("rollup");
    assert.deepEqual(labels("rollup"), ["Bob", "Carol"]);
    changeTarget();
    assert.deepEqual(labels("direct"), ["Alice", "Carol"]);
    assert.deepEqual(labels("rollup"), ["Bob", "Carol"]);
    const stored = transactions.at(-1).perform[0].data;
    assert.deepEqual(stored.find(rule => rule.id === "direct").filter.value.relation.blockIDs, ["alice", "carol"]);
    assert.deepEqual(stored.find(rule => rule.id === "rollup").filter.value.rollup.contents[0].relation.blockIDs, ["bob", "carol"]);
    assert.deepEqual(data.view.filters[0].value.relation.blockIDs, ["unrelated"], "view filters remain independent");

    suffix = " updated";
    await open();
    assert.deepEqual(labels("direct"), ["Alice updated", "Carol updated"]);
    assert.deepEqual(labels("rollup"), ["Bob updated", "Carol updated"]);
    changeTarget();
    assert.deepEqual(labels("direct"), ["Alice updated", "Carol updated"]);
    assert.deepEqual(labels("rollup"), ["Bob updated", "Carol updated"]);
};

if (process.versions.electron && process.type === "browser") {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", process.argv[2]);
    app.commandLine.appendSwitch("disable-gpu");
    app.whenReady().then(async () => {
        const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false}});
        let code = 0;
        try {
            const ts = require("typescript");
            const sources = {languages: JSON.parse(fs.readFileSync(path.join(__dirname, "../appearance/langs/en.json"), "utf8"))};
            for (const name of ["conditionalColorMenu", "conditionalColor", "capabilities", "capabilities.generated", "filter", "filterTree", "filterDropdown", "selectPosition"]) {
                sources[`protyle/render/av/${name}`] = ts.transpileModule(fs.readFileSync(path.join(__dirname,
                    `../src/protyle/render/av/${name}.ts`), "utf8"), {
                    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
                }).outputText;
            }
            for (const name of ["escape", "setPosition"]) {
                sources[`util/${name}`] = ts.transpileModule(fs.readFileSync(path.join(__dirname, `../src/util/${name}.ts`), "utf8"), {
                    compilerOptions: {module: ts.ModuleKind.CommonJS},
                }).outputText;
            }
            for (const mobile of [false, true]) {
                await win.loadURL("data:text/html,<html><body></body></html>");
                await win.webContents.executeJavaScript(`(${runCases.toString()})(${JSON.stringify(sources)}, ${mobile})`);
            }
        } catch (error) {
            console.error(error);
            code = 1;
        } finally {
            win.destroy();
            app.exit(code);
        }
    });
} else {
    const {test} = require("node:test");
    const {execFile} = require("node:child_process");
    const {promisify} = require("node:util");
    test("conditional color relation and rollup chips retain names across edits, redraws and panel rebuilds on desktop and mobile", async () => {
        const profile = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-conditional-colors-"));
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        try {
            await promisify(execFile)(require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 30000});
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            fs.rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
