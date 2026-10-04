const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const {test} = require("node:test");
const {runInNewContext} = require("node:vm");
const ts = require("typescript");
const config = require("../src/config/bazaar/packageConfig.ts");

const compile = source => ts.transpileModule(source, {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021},
}).outputText;
const deferred = () => {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return {promise, resolve};
};
const loadTab = (refreshPackages = async () => {}) => {
    let loads = 0;
    const module = {
        bazaar: {refreshPackages},
        mountBazaarTab(root) { this.bazaar.element = root; },
        unmountBazaarTab() {},
    };
    const exports = {};
    runInNewContext(compile(readFileSync("src/config/bazaarTab.ts", "utf8")), {
        exports, console, require: path => {
            if (path === "./bazaar") { loads++; return module; }
            return config;
        },
    });
    return {api: exports, loads: () => loads};
};

test("marketplace notifications do not load an unopened marketplace", async () => {
    const {api, loads} = loadTab();
    await api.refreshMountedBazaar(["widgets"]);
    assert.equal(loads(), 0);
});

test("marketplace refresh merges notifications and drains changes received during a request", async () => {
    const started = deferred();
    const blocked = deferred();
    const calls = [];
    const app = {};
    const {api} = loadTab(async (types, owner) => {
        assert.equal(owner, app);
        calls.push(Array.from(types));
        if (calls.length === 1) { started.resolve(); await blocked.promise; }
    });
    await api.mountBazaarTab({isConnected: true}, undefined, app);
    const pending = api.refreshMountedBazaar(["widgets"]);
    api.refreshMountedBazaar(["widgets", "templates"]);
    await started.promise;
    api.refreshMountedBazaar(["icons"]);
    api.refreshMountedBazaar(["icons", "plugins"]);
    assert.equal(calls.length, 1);
    blocked.resolve();
    await pending;
    assert.deepEqual(calls, [["widgets", "templates"], ["icons", "plugins"]]);
});

test("queued marketplace refresh ignores an unmounted or detached page", async () => {
    let refreshed = 0;
    const {api} = loadTab(async () => { refreshed++; });
    const root = {isConnected: true};
    await api.mountBazaarTab(root);
    const pending = api.refreshMountedBazaar(["themes"]);
    api.unmountBazaarTab(root);
    await pending;
    assert.equal(refreshed, 0);
    await api.mountBazaarTab({isConnected: false});
    await api.refreshMountedBazaar();
    assert.equal(refreshed, 0);
});

test("a settings remount during notification delivery does not lose the refresh", async () => {
    const calls = [];
    const {api} = loadTab(async types => { calls.push(Array.from(types)); });
    const root = {isConnected: true};
    await api.mountBazaarTab(root);
    const pending = api.refreshMountedBazaar(["themes"]);
    await Promise.resolve();
    await api.mountBazaarTab(root);
    await pending;
    assert.deepEqual(calls, [["themes"]]);
});

const source = ts.createSourceFile("bazaar.ts", readFileSync("src/config/bazaar.ts", "utf8"), ts.ScriptTarget.ES2021, true);
const declaration = source.statements.find(statement => ts.isVariableStatement(statement) &&
    statement.declarationList.declarations.some(item => item.name.getText(source) === "bazaar"));
const object = declaration.declarationList.declarations[0].initializer;
const loadMethods = (names, dependencies = {}) => {
    const methods = names.map(name => object.properties.find(property => property.name?.getText(source) === name).getText(source));
    const exports = {};
    runInNewContext(compile(`export const bazaar = {${methods.join(",")}};`), {
        exports, BAZAAR_PACKAGE_CONFIG: config.BAZAAR_PACKAGE_CONFIG,
        window: {siyuan: {config: {bazaar: {trust: true}}}}, ...dependencies,
    });
    return exports.bazaar;
};

test("package refresh waits for an installed-list request and preserves the selected view", async () => {
    const blocked = deferred();
    const calls = [];
    const bazaar = loadMethods(["refreshPackages"]);
    Object.assign(bazaar, {
        element: {isConnected: true, querySelector: selector => selector === "#configBazaarWidget" ?
            {parentElement: {getAttribute: () => "true"}} : null},
        _captureMount: () => 1, _isMountCurrent: () => true,
        _data: {details: new Map([["widgets:old", {}], ["themes:unrelated", {}]])},
        _detailRequestIDs: new Map([["widgets:old", 1]]),
        _downloadedRequest: blocked.promise,
        _genMyHTML: (type, app, order, detail) => { calls.push(["installed", type, order, detail]); return Promise.resolve(); },
        _reloadBazaarType: (type, preserve) => { calls.push(["online", type, preserve]); return Promise.resolve(); },
        _checkUpdate: (force, preserve) => { calls.push(["updates", force, preserve]); return Promise.resolve(); },
    });
    const pending = bazaar.refreshPackages(["widgets"], {});
    assert.deepEqual(calls, []);
    assert.equal(bazaar._data.details.has("widgets:old"), false);
    assert.equal(bazaar._data.details.has("themes:unrelated"), true);
    assert.equal(bazaar._detailRequestIDs.get("widgets:old"), 2);
    bazaar._downloadedRequest = undefined;
    blocked.resolve();
    await pending;
    assert.deepEqual(calls, [["installed", "widgets", true, false], ["online", "widgets", true], ["updates", true, true]]);
});

test("package refresh stops when the page is replaced while awaiting an older request", async () => {
    const blocked = deferred();
    const bazaar = loadMethods(["refreshPackages"]);
    Object.assign(bazaar, {
        element: {isConnected: true, querySelector: () => null}, _captureMount: () => 1, _isMountCurrent: () => false,
        _data: {details: new Map()}, _detailRequestIDs: new Map(),
        _downloadedRequest: blocked.promise, _genMyHTML: () => assert.fail("stale page refreshed"),
    });
    const pending = bazaar.refreshPackages(["widgets"], {});
    blocked.resolve();
    await pending;
});

test("installed refresh preserves search and scroll, and an old request cannot clear a new loading flag", async () => {
    const requests = [];
    const bazaar = loadMethods(["_genMyHTML"], {
        getFrontend: () => "desktop",
        fetchPost: (_url, data, callback) => {
            const pending = deferred();
            requests.push({data, callback, ...pending});
            return pending.promise;
        },
        loadDownloadedRatings() {}, loadDownloadedUserRatings() {},
        window: {siyuan: {languages: {emptyContent: "Empty"}}},
    });
    let generation = 1;
    let loading = false;
    const button = {classList: {contains: () => false}, getAttribute: () => "myWidget"};
    const content = {
        scrollTop: 160,
        set innerHTML(_value) { this.scrollTop = 0; },
        getAttribute: () => loading ? "true" : null,
        setAttribute: () => { loading = true; }, removeAttribute: () => { loading = false; },
        previousElementSibling: {querySelector: selector => selector === ".b3-text-field" ? {value: "search term"} :
            selector === ".counter" ? {classList: {add() {}}} : button},
    };
    Object.assign(bazaar, {
        element: {querySelector: selector => selector === "#configBazaarDownloaded" ? content : null},
        _data: {}, _captureMount: () => generation, _isMountCurrent: value => value === generation,
        _updateDownloadedToolbar() {}, _updateDownloadedSortSelect() {}, _getDownloadedSortValue: () => "2",
        _applyDownloadedDeprecations() {}, _preserveDownloadedOrder: data => data, _loadDownloadedDeprecations() {},
    });
    const old = bazaar._genMyHTML("widgets", {}, true);
    generation++;
    loading = false;
    const current = bazaar._genMyHTML("widgets", {}, true);
    requests[0].callback({data: {packages: []}});
    requests[0].resolve();
    await old;
    assert.equal(loading, true);
    assert.equal(requests[1].data.keyword, "search term");
    requests[1].callback({data: {packages: []}});
    requests[1].resolve();
    await current;
    assert.equal(loading, false);
    assert.equal(content.scrollTop, 160);
});

test("package detail ignores responses superseded by a cross-window refresh", async () => {
    const callbacks = [];
    const bazaar = loadMethods(["_fetchPackageDetail"], {
        getFrontend: () => "desktop",
        fetchPost: (_url, _data, callback) => { callbacks.push(callback); return Promise.resolve(); },
    });
    let saved;
    Object.assign(bazaar, {
        _captureMount: () => 1, _isMountCurrent: () => true, _getDetailKey: () => "widgets:sample",
        _detailRequestIDs: new Map(), _setPackageDetail: (_type, _name, detail) => { saved = detail; },
    });
    const received = [];
    await bazaar._fetchPackageDetail("widgets", "sample", detail => received.push(detail));
    await bazaar._fetchPackageDetail("widgets", "sample", detail => received.push(detail));
    const latest = {installed: null, available: {name: "sample"}};
    callbacks[1]({code: 0, data: latest});
    callbacks[0]({code: 0, data: {installed: {name: "sample"}}});
    assert.equal(saved, latest);
    assert.deepEqual(received, [latest]);
});

for (const available of [undefined, {name: "sample"}]) {
    test(`uninstalled package detail ${available ? "switches to online actions" : "closes for a local-only package"}`, async () => {
        let closed = false;
        let rendered;
        const readme = {scrollTop: 125, classList: {remove: () => { closed = true; }}};
        const side = {getAttribute: name => ({"data-from": "downloaded", "data-package-type": "widgets", "data-name": "sample"})[name],
            closest: () => readme};
        const bazaar = loadMethods(["_refreshReadmeDetail"]);
        Object.assign(bazaar, {
            element: {querySelector: () => side}, _getPackageDetail: () => ({installed: {name: "sample"}}),
            _fetchPackageDetail: async (_type, _name, callback) => callback({installed: null, available}),
            _renderReadme: (...args) => { rendered = args; readme.scrollTop = 0; },
        });
        await bazaar._refreshReadmeDetail("widgets", "sample");
        assert.equal(closed, !available);
        if (available) {
            assert.equal(rendered[1], "bazaar");
            assert.equal(rendered[3].installed, null);
            assert.equal(rendered[4], true);
            assert.equal(readme.scrollTop, 125);
        }
    });
}

test("shared WebSocket dispatcher refreshes marketplace state before forwarding the notification", () => {
    const model = ts.createSourceFile("Model.ts", readFileSync("src/layout/Model.ts", "utf8"), ts.ScriptTarget.ES2021, true);
    const declaration = model.statements.find(ts.isClassDeclaration);
    const method = declaration.members.find(member => member.name?.getText(model) === "processWebSocketMessage");
    const calls = [];
    const exports = {};
    runInNewContext(compile(`export class Model {${method.getText(model)}}`), {exports, require: path =>
        path.includes("processMessage") ? {processMessage: data => data} :
            {refreshMountedBazaar: types => { calls.push(Array.from(types)); return Promise.resolve(); }}});
    new exports.Model().processWebSocketMessage(JSON.stringify({cmd: "bazaarChanged", data: ["templates"]}), message => calls.push(message.cmd));
    assert.deepEqual(calls, [["templates"], "bazaarChanged"]);
});
