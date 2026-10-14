const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const path = require("node:path");
const {test} = require("node:test");
const ts = require("typescript");

const source = ts.createSourceFile("bazaar.ts",
    readFileSync(path.join(__dirname, "../src/config/bazaar.ts"), "utf8"), ts.ScriptTarget.Latest, true);
let bazaarObject;
const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === "bazaar") {
        bazaarObject = node.initializer;
    }
    ts.forEachChild(node, visit);
};
visit(source);
assert.ok(bazaarObject && ts.isObjectLiteralExpression(bazaarObject));
const methodNames = ["_genMyHTML", "_shouldKeepDownloadedOrder", "_preserveDownloadedOrder", "_sortDownloadedPackages"];
const methods = bazaarObject.properties.filter(node => methodNames.includes(node.name?.getText(source)));
const code = ts.transpileModule(`const bazaar = {${methods.map(node => node.getText(source)).join(",\n")}};`, {
    compilerOptions: {target: ts.ScriptTarget.ES2020},
}).outputText;

const item = (name, extra = {}) => ({name, invalidReason: "test", ...extra});
const setup = ({downloaded, downloadedType = "widgets", sort = "0", type = "widgets"}) => {
    let sortValue = sort;
    let request;
    let rendering;
    const attributes = new Map();
    const button = {classList: {contains: () => false}, getAttribute: () => `my${type}`};
    const counter = {classList: {add() {}, remove() {}}};
    const content = {
        innerHTML: "",
        previousElementSibling: {querySelector: selector => selector === ".counter" ? counter :
            selector === ".b3-text-field" ? {value: ""} : button},
        getAttribute: name => attributes.get(name),
        setAttribute: (name, value) => attributes.set(name, value),
        removeAttribute: name => attributes.delete(name),
    };
    // 使用实际渲染回调及排序方法，隔离集市元数据、卡片样式和内核通信。
    const bazaar = new Function("dependencies", `
        const {BAZAAR_PACKAGE_CONFIG, fetchPost, getFrontend, loadDownloadedRatings, loadDownloadedUserRatings} = dependencies;
        ${code}
        return bazaar;
    `)({
        BAZAAR_PACKAGE_CONFIG: {[type]: {myType: `my${type}`, api: {installed: "/installed"}}},
        getFrontend: () => "desktop",
        loadDownloadedRatings() {},
        loadDownloadedUserRatings() {},
        fetchPost: (_url, _data, callback) => new Promise(resolve => {request = {callback, resolve};}),
    });
    Object.assign(bazaar, {
        _data: {downloaded, downloadedType},
        element: {querySelector: selector => selector === "#configBazaarDownloaded" ? content : null},
        _captureMount: () => ({}),
        _isMountCurrent: () => true,
        _syncPluginGlobalSwitch() {},
        _updateDownloadedToolbar() {},
        _updateDownloadedSortSelect() {},
        _getDownloadedSortValue: () => sortValue,
        _applyDownloadedDeprecations() {},
        _loadDownloadedDeprecations() {},
        _genInvalidDownloadedCardHTML: pkg => `<card>${pkg.name}</card>`,
    });
    const start = (preserveOrder = true) => {
        rendering = bazaar._genMyHTML(type, {plugins: []}, preserveOrder);
        return rendering;
    };
    const respond = async packages => {
        request.callback({code: 0, data: {packages}});
        request.resolve();
        await rendering;
        assert.equal(content.getAttribute("data-loading"), undefined);
        const names = bazaar._data.downloaded.map(pkg => pkg.name);
        assert.equal(content.innerHTML, names.map(name => `<card>${name}</card>`).join(""));
        assert.equal(bazaar._data.downloadedType, type);
        return names;
    };
    return {start, respond, setSort: value => {sortValue = value;}};
};

test("install refresh places a new package in the default name order", async () => {
    const {start, respond} = setup({downloaded: [item("zebra")]});
    assert.notEqual(start(), false);
    assert.deepEqual(await respond([item("alpha"), item("zebra")]), ["alpha", "zebra"]);
});

test("uninstall refresh reapplies the selected update-time order", async () => {
    const {start, respond} = setup({
        downloaded: [item("alpha"), item("beta"), item("gamma")], sort: "3",
    });
    start();
    assert.deepEqual(await respond([item("alpha", {updateTime: 1}), item("gamma", {updateTime: 2})]),
        ["gamma", "alpha"]);
});

test("replacement with the same package count reapplies the selected sort", async () => {
    const {start, respond} = setup({downloaded: [item("alpha"), item("beta")], sort: "1"});
    start();
    assert.deepEqual(await respond([item("alpha", {installTime: 1}), item("gamma", {installTime: 2})]),
        ["gamma", "alpha"]);
});

test("unchanged package set retains its order despite metadata changes", async () => {
    const {start, respond} = setup({downloaded: [item("beta"), item("alpha")], sort: "3"});
    start();
    assert.deepEqual(await respond([item("alpha", {updateTime: 2}), item("beta", {updateTime: 1})]),
        ["beta", "alpha"]);
});

test("another package type cannot supply the preserved order", async () => {
    const {start, respond} = setup({downloaded: [item("beta"), item("alpha")], downloadedType: "themes"});
    start();
    assert.deepEqual(await respond([item("alpha"), item("beta")]), ["alpha", "beta"]);
});

test("sort changes during a request override preserved order", async () => {
    const {start, respond, setSort} = setup({downloaded: [item("alpha"), item("beta")]});
    start();
    setSort("1");
    assert.deepEqual(await respond([item("alpha", {installTime: 1}), item("beta", {installTime: 2})]),
        ["beta", "alpha"]);
});

test("explicit sorting overrides preserved order for an unchanged set", async () => {
    const {start, respond} = setup({downloaded: [item("beta"), item("alpha")]});
    start(false);
    assert.deepEqual(await respond([item("alpha"), item("beta")]), ["alpha", "beta"]);
});

for (const sort of ["5", "6"]) {
    test(`install refresh applies plugin enablement sort ${sort}`, async () => {
        const {start, respond} = setup({downloaded: [item("beta")], type: "plugins", downloadedType: "plugins", sort});
        start();
        const packages = [item("alpha", {enabled: sort === "5"}), item("beta", {enabled: sort === "6"})];
        assert.deepEqual(await respond(packages), ["alpha", "beta"]);
    });
}

test("plugin enablement refresh retains the unchanged package order", async () => {
    const {start, respond} = setup({
        downloaded: [item("beta"), item("alpha")], type: "plugins", downloadedType: "plugins", sort: "5",
    });
    start();
    assert.deepEqual(await respond([item("alpha", {enabled: true}), item("beta", {enabled: false})]),
        ["beta", "alpha"]);
});
