const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {runInNewContext} = require("node:vm");
const ts = require("typescript");
const {parse} = require("ifdef-loader/preprocessor");

const loaderSource = readFileSync(path.resolve(__dirname, "../src/plugin/loader.ts"), "utf8");
const lifecycleSource = readFileSync(path.resolve(__dirname, "../src/plugin/lifecycle.ts"), "utf8");
const compile = source => ts.transpileModule(source, {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
}).outputText;
const lifecycleExports = {};
runInNewContext(compile(lifecycleSource), {exports: lifecycleExports, setTimeout, clearTimeout, queueMicrotask});

const deferred = () => {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return {promise, resolve};
};

const createHost = ({mobile = false, settingsWindow = false, names = ["alpha", "beta", "custom"],
    onWrite = () => {}, padding = ""} = {}) => {
    const app = {plugins: []};
    const calls = [];
    const events = [];
    const errors = [];
    let nextResponse;
    let permitted = true;
    class Plugin {
        constructor(options) {
            Object.assign(this, options);
            this.topBarIcons = [];
            this.statusBarIcons = [];
            this.docks = {};
            this.kernel = {init() {}};
        }
        onload() { events.push(`load:${this.name}`); onWrite(this.name); }
        onLayoutReady() {}
        onunload() { events.push(`unload:${this.name}`); }
        uninstall() { events.push(`uninstall:${this.name}`); }
        onDataChanged() {}
    }
    const catalog = names.map(name => ({
        name, displayName: name, css: "", i18n: {}, settingsWindow: true,
        js: (name === "custom" ?
            "module.exports = class extends require(\"siyuan\").Plugin { onDataChanged(reason) { require(\"siyuan\").record(this.name, reason); } };" :
            "module.exports = class extends require(\"siyuan\").Plugin {};") + `\n/*${padding}*/`,
    }));
    const dependencies = {
        Plugin, ...lifecycleExports,
        getHostCapabilities: () => ({plugins: permitted}),
        isSettingsWindow: () => settingsWindow,
        isWindow: () => false,
        isMobile: () => mobile,
        getFrontend: () => mobile ? "browser-mobile" : "browser-desktop",
        fetchSyncPost: async (url, request) => {
            assert.equal(url, "/api/petal/loadPetals");
            const data = catalog.filter(item => request.names === undefined || request.names.includes(item.name));
            const response = {code: 0, data};
            calls.push({request: JSON.parse(JSON.stringify(request)), names: data.map(item => item.name),
                bytes: Buffer.byteLength(JSON.stringify(response))});
            const pending = nextResponse;
            nextResponse = undefined;
            pending?.entered.resolve();
            if (pending) await pending.release.promise;
            return response;
        },
        getAPI: () => ({Plugin, record: (name, reason) => events.push(`data:${name}:${reason}`)}),
        getAllEditor: () => [],
        beginPluginTeardown() {}, markPluginDisposed() {},
        destroyPlugin: (owner, instance) => { owner.plugins = owner.plugins.filter(item => item !== instance); },
        deactivateCustomBlockPlugin() {}, activateCustomBlockPlugin() {},
        saveLayout() {}, applyTopBarEntryVisibility() {}, resizeTopBar() {}, ensureLute() {},
        refreshDockCatalog() {}, dispatchMobilePluginDocksChange() {},
        Constants: {},
    };
    const exports = {};
    runInNewContext(compile(parse(loaderSource, {MOBILE: mobile}, false, true)), {
        exports, require: () => dependencies,
        console: {error: (...args) => errors.push(args)},
        window: {eval: code => runInNewContext(code), siyuan: {layout: {}}},
        document: {getElementById: () => ({remove() {}, insertAdjacentElement() {}})},
    });
    return {app, calls, events, catalog, exports, errors,
        setPermitted(value) { permitted = value; },
        pauseNextResponse() {
            nextResponse = {entered: deferred(), release: deferred()};
            return nextResponse;
        },
        async init() {
            await exports.loadPlugins(app, undefined, false);
            await exports.afterLayoutReady(app);
            assert.deepEqual(errors, []);
        },
    };
};

for (const mobile of [false, true]) {
    test(`targeted data reloads fetch only their resources and preserve other instances (mobile=${mobile})`, async () => {
        const host = createHost({mobile});
        await host.init();
        assert.equal(host.calls[0].request.names, undefined);
        const beta = host.app.plugins.find(item => item.name === "beta");
        host.calls.length = 0;
        for (let index = 0; index < 3; index++) {
            await host.exports.reloadPlugin(host.app, {dataChangePlugins: ["alpha"], dataChangeReason: "overwrite"});
        }
        assert.equal(host.calls.length, 3);
        assert.ok(host.calls.every(call => JSON.stringify(call.names) === '["alpha"]'));
        assert.ok(host.calls.every(call => JSON.stringify(call.request.names) === '["alpha"]'));
        assert.equal(host.app.plugins.find(item => item.name === "beta"), beta);
        assert.equal(host.events.filter(event => event === "load:alpha").length, 4);
        assert.equal(host.events.filter(event => event === "load:beta").length, 1);
        assert.deepEqual(host.errors, []);
    });
}

test("a reload batch shares one filtered request after lifecycle priority and deduplication", async () => {
    const host = createHost();
    await host.init();
    host.calls.length = 0;
    await host.exports.reloadPlugin(host.app, {
        uninstallPlugins: ["beta"], unloadPlugins: ["beta"], reloadPlugins: ["alpha", "beta", "alpha"],
        dataChangePlugins: ["alpha", "custom", "beta"], dataChangeReason: "sync",
    });
    assert.equal(host.calls.length, 1);
    assert.deepEqual(host.calls[0].request.names, ["alpha", "custom"]);
    assert.equal(host.app.plugins.some(item => item.name === "beta"), false);
    assert.ok(host.events.includes("data:custom:sync"));
    assert.deepEqual(host.errors, []);
});

test("custom data hooks, empty loads, disabled hosts and teardown-only batches do not fetch resources", async () => {
    const host = createHost();
    await host.init();
    host.calls.length = 0;
    await host.exports.loadPlugins(host.app, [], false);
    await host.exports.reloadPlugin(host.app, {dataChangePlugins: ["custom"], dataChangeReason: "overwrite"});
    await host.exports.reloadPlugin(host.app, {unloadPlugins: ["alpha"], uninstallPlugins: ["beta"]});
    await host.exports.reloadPlugin(host.app, {dataChangePlugins: ["alpha", "missing"]});
    host.setPermitted(false);
    await host.exports.reloadPlugin(host.app, {reloadPlugins: ["alpha"]});
    assert.equal(host.calls.length, 0);
    assert.ok(host.events.includes("data:custom:overwrite"));
    assert.deepEqual(host.errors, []);
});

test("named loading deduplicates names while startup and reconnect retain a full catalog", async () => {
    const host = createHost({settingsWindow: true});
    await host.exports.loadPlugins(host.app, ["alpha", "alpha", "missing"], false);
    assert.deepEqual(host.calls[0].request, {
        frontend: "browser-desktop", names: ["alpha", "missing"], settingsWindow: true,
    });
    assert.deepEqual(host.app.plugins.map(item => item.name), ["alpha"]);
    await host.exports.afterLayoutReady(host.app);
    await host.exports.refreshPlugins(host.app);
    assert.equal(host.calls[1].request.names, undefined);
    assert.equal(host.app.plugins.length, 3);
    assert.ok(host.calls.every(call => call.request.settingsWindow === true));
    assert.deepEqual(host.errors, []);
});

for (const action of ["unload", "uninstall", "dispose"]) {
    test(`a delayed filtered response does not restore a plugin after ${action}`, async () => {
        const host = createHost();
        await host.init();
        const pending = host.pauseNextResponse();
        const reloading = host.exports.reloadPlugin(host.app, {reloadPlugins: ["alpha"]});
        await pending.entered.promise;
        if (action === "dispose") {
            host.exports.disposePlugins(host.app);
        } else {
            await host.exports.reloadPlugin(host.app, {[`${action}Plugins`]: ["alpha"]});
        }
        pending.release.resolve();
        await reloading;
        assert.equal(host.app.plugins.some(item => item.name === "alpha"), false);
        assert.deepEqual(host.errors, []);
    });
}

test("concurrent reload calls keep independent filtered requests and latest catalog state", async () => {
    const host = createHost();
    await host.init();
    host.calls.length = 0;
    const pending = host.pauseNextResponse();
    const alpha = host.exports.reloadPlugin(host.app, {reloadPlugins: ["alpha"]});
    await pending.entered.promise;
    await host.exports.reloadPlugin(host.app, {reloadPlugins: ["beta"]});
    pending.release.resolve();
    await alpha;
    assert.deepEqual(host.calls.map(call => call.request.names), [["alpha"], ["beta"]]);
    host.catalog.splice(host.catalog.findIndex(item => item.name === "alpha"), 1);
    await host.exports.reloadPlugin(host.app, {reloadPlugins: ["alpha"]});
    assert.equal(host.app.plugins.some(item => item.name === "alpha"), false);
    assert.equal(host.app.plugins.filter(item => item.name === "beta").length, 1);
    assert.deepEqual(host.errors, []);
});

test("two frontend reload loops transfer only the changed plugin without hiding later notifications", async () => {
    let running = false;
    const queue = [];
    const names = Array.from({length: 32}, (_, index) => `plugin-${String(index).padStart(2, "0")}`);
    const common = {names, padding: "x".repeat(65536)};
    const first = createHost({...common, onWrite: name => { if (running && name === names[0]) queue.push(second); }});
    const second = createHost({...common, onWrite: name => { if (running && name === names[0]) queue.push(first); }});
    await first.init();
    await second.init();
    const fullBytes = first.calls[0].bytes;
    first.calls.length = second.calls.length = 0;
    running = true;
    queue.push(second);
    for (let index = 0; index < 12; index++) {
        const receiver = queue.shift();
        assert.ok(receiver);
        await receiver.exports.reloadPlugin(receiver.app, {dataChangePlugins: [names[0]], dataChangeReason: "overwrite"});
    }
    running = false;
    const requests = [...first.calls, ...second.calls];
    assert.equal(requests.length, 12);
    assert.equal(queue.length, 1);
    assert.ok(requests.every(call => JSON.stringify(call.names) === JSON.stringify([names[0]])));
    const totalBytes = requests.reduce((sum, call) => sum + call.bytes, 0);
    assert.ok(totalBytes < fullBytes * requests.length * 0.032);
    assert.deepEqual([...first.errors, ...second.errors], []);
});
