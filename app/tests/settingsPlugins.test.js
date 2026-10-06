const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const runCases = async sources => {
    const check = require("node:assert/strict");
    const load = (code, modules) => {
        const exports = {};
        new Function("require", "exports", code)(name => modules[name] || dependencies, exports);
        return exports;
    };
    const errors = [];
    const originalError = console.error;
    console.error = (...args) => errors.push(args);
    let preferences = {color: "red"};
    let permitted = true;
    let available = true;
    let luteLoads = 0;
    const requests = [];
    const notifications = [];
    const {PluginLifecycleCoordinator} = load(sources.lifecycle, {});
    const settingsApps = load(sources.settingsApp, {});
    const {GlobalPluginStateCoordinator} = load(sources.globalCoordinator, {});
    const events = load(sources.events, {});
    const owner = {appId: "owner", plugins: [{name: "dynamic", data: {color: "owner"}}]};
    const app = settingsApps.createSettingsPluginApp("settings");
    const host = {app: owner, applyPluginReload: data => { notifications.push(data); return Promise.resolve(); },
        openPluginSetting: () => Promise.resolve()};
    const windowContext = load(sources.windowContext, {electron: require("electron")});
    windowContext.setSettingsWindowHost(host);
    const dependencies = {
        Constants: {INLINE_TYPE: [], TIMEOUT_INPUT: 0},
        ...events,
        Kernel: class {init() {} destroy() {}},
        isSettingsWindow: windowContext.isSettingsWindow, getSettingsWindowHost: windowContext.getSettingsWindowHost,
        isWindow: () => true, isMobile: () => false,
        getFrontend: () => "desktop", getHostCapabilities: () => ({plugins: permitted}),
        normalizeStoragePath: value => value,
        fetchPost: (_url, _body, callback) => callback({...preferences}),
        getAllEditor: () => [], getAllModels: () => ({custom: []}),
        resolvePluginToolbar: () => [], clearPluginToolbarItems() {},
        activateCustomBlockPlugin() {}, deactivateCustomBlockPlugin() {},
        refreshDockCatalog() {}, applyTopBarEntryVisibility() {},
        resizeTopBar() {}, saveLayout() {},
        unregisterPluginCommands() {}, cancelAssetUploadsByPlugin() {}, releaseTrackedRangesByPlugin() {},
        removeBreadcrumbButtons() {}, unregisterCapability() {},
        registerPluginCommand() { throw new Error("settings registered a command"); },
        sendGlobalShortcut() { throw new Error("settings changed global shortcuts"); },
        updatePluginKeymap() { throw new Error("settings changed keymaps"); },
    };
    window.siyuan = {config: {bazaar: {petalDisabled: false}, readonly: false}, dialogs: [], layout: {}, storage: {}, ws: {app}};
    document.body.className = "body--settings";
    const layouts = load(sources.layouts, {});
    const tabs = load(sources.tabs, {"./getAll": layouts});
    dependencies.setTabPosition = tabs.setTabPosition;
    const pluginAPI = load(sources.plugin, {});
    Object.assign(dependencies, pluginAPI);
    const uninstall = load(sources.uninstall, {});
    const dynamicCode = `const {Plugin} = require("siyuan"); module.exports = class extends Plugin {
        async onload() {
            window.pluginLoads = (window.pluginLoads || 0) + 1;
            await this.onDataChanged();
            this.eventBus.on("ws-main", () => window.pluginMessages = (window.pluginMessages || 0) + 1);
            this.addCommand({langKey: "action", globalCallback() {}});
            this.addTopBar({icon: "iconSettings", title: "Settings"});
            this.addStatusBar({element: document.createElement("span")});
            this.addToolbarItem({name: "custom"});
            this.addDock({type: "custom", config: {}});
            this.addTab({type: "custom"});
            this.addBreadcrumbButton({id: "custom"});
        }
        onLayoutReady() { window.pluginLayouts = (window.pluginLayouts || 0) + 1; }
        async onDataChanged(reason) {
            const data = await this.loadData("prefs.json");
            document.getElementById("dynamicStyle")?.remove();
            const style = document.createElement("style"); style.id = "dynamicStyle";
            style.textContent = ".dynamic-control {color: " + data.color + ";}";
            document.head.append(style); document.body.classList.add("dynamic-enabled");
            window.pluginReason = reason;
        }
        onunload() {
            window.pluginUnloads = (window.pluginUnloads || 0) + 1;
            document.getElementById("dynamicStyle")?.remove();
            document.body.classList.remove("dynamic-enabled");
        }
    };`;
    const declared = {name: "dynamic", displayName: "Dynamic", js: dynamicCode, css: "", i18n: {}, settingsWindow: true};
    const legacy = {name: "legacy", displayName: "Legacy", js: "window.legacyExecuted = true;", css: "", i18n: {}};
    const fetchSyncPost = async (url, data) => {
        check.equal(url, "/api/petal/loadPetals");
        requests.push(data);
        return {code: 0, data: available ? [legacy, declared] : [legacy]};
    };
    const loader = load(sources.loader, {
        "../util/fetch": {fetchSyncPost}, "./index": pluginAPI, "./uninstall": uninstall,
        "./lifecycle": {PluginLifecycleCoordinator},
        "./API": {getAPI: () => pluginAPI},
        "../protyle/util/lute": {ensureLute: async () => luteLoads++},
    });
    const state = load(sources.global, {
        "./loader": loader, "./settingsApp": settingsApps,
        "./globalStateCoordinator": {GlobalPluginStateCoordinator}, "../util/fetch": {fetchSyncPost},
    });
    const control = document.createElement("div");
    control.className = "dynamic-control";
    control.textContent = "Settings";
    document.body.append(control);
    try {
        await loader.loadPlugins(app, undefined, false);
        await loader.afterLayoutReady(app);
        check.equal(app.plugins.length, 1);
        const first = app.plugins[0];
        check.notEqual(first, owner.plugins[0]);
        check.equal(owner.plugins[0].data.color, "owner");
        check.equal(window.legacyExecuted, undefined);
        check.equal(getComputedStyle(control).color, "rgb(255, 0, 0)");
        check.equal(window.pluginLoads, 1);
        check.equal(window.pluginLayouts, 1);
        document.body.classList.remove("body--settings");
        check.equal(windowContext.isSettingsWindow(), true);
        check.equal(windowContext.getSettingsOwnerApp(), owner);
        first.addCommand({langKey: "after-style-change", globalCallback() {}});
        check.deepEqual(first.commands, []);
        check.deepEqual(first.docks, {});
        check.deepEqual(first.statusBarIcons, []);
        events.emitToPlugins("ws-main", {cmd: "setLocalStorageVal"});
        check.equal(window.pluginMessages, 1);
        preferences = {color: "blue"};
        await state.applyPluginReload(app, {dataChangePlugins: ["dynamic"], dataChangeReason: "overwrite"});
        check.equal(app.plugins[0], first);
        check.equal(getComputedStyle(control).color, "rgb(0, 0, 255)");
        check.equal(window.pluginReason, "overwrite");
        check.equal(notifications.length, 0);
        await state.applyPluginReload(owner, {reloadPlugins: ["dynamic"]});
        check.equal(notifications.length, 1);
        await state.applyPluginReload(app, {unloadPlugins: ["dynamic"]});
        check.equal(app.plugins.length, 0);
        check.equal(document.getElementById("dynamicStyle"), null);
        check.equal(document.body.classList.contains("dynamic-enabled"), false);
        events.emitToPlugins("ws-main", {});
        check.equal(window.pluginMessages, 1);
        await state.applyPluginReload(app, {reloadPlugins: ["dynamic"]});
        check.equal(app.plugins.length, 1);
        check.notEqual(app.plugins[0], first);
        await state.applyPluginReload(app, {globalPetalEnabled: false, globalPetalDisabled: true,
            globalPetalRevision: 1, globalPetalChanged: true, unloadPlugins: ["dynamic"]});
        check.equal(app.plugins.length, 0);
        check.equal(window.siyuan.config.bazaar.petalDisabled, true);
        await state.applyPluginReload(app, {globalPetalEnabled: true, globalPetalDisabled: false,
            globalPetalRevision: 2, globalPetalChanged: true, reloadPlugins: ["dynamic"]});
        check.equal(app.plugins.length, 1);
        available = false;
        const luteBefore = luteLoads;
        await loader.refreshPlugins(app);
        check.equal(app.plugins.length, 0);
        check.equal(luteLoads, luteBefore);
        available = true;
        await loader.refreshPlugins(app);
        check.equal(app.plugins.length, 1);
        loader.disposePlugins(app);
        loader.disposePlugins(app);
        check.equal(app.plugins.length, 0);
        check.equal(owner.plugins.length, 1);
        check.equal(document.getElementById("dynamicStyle"), null);
        check.ok(requests.every(item => item.settingsWindow === true && item.frontend === "desktop"));
        check.ok(luteLoads > 0);
        permitted = false;
        const requestCount = requests.length;
        await loader.loadPlugins(settingsApps.createSettingsPluginApp("untrusted"), undefined, false);
        check.equal(requests.length, requestCount);
        check.deepEqual(errors, []);
    } finally {
        loader.disposePlugins(app);
        console.error = originalError;
    }
};

if (process.versions.electron && process.type === "browser") {
    const {app, BrowserWindow} = require("electron");
    const ts = require("typescript");
    app.setPath("userData", process.argv[2]);
    app.commandLine.appendSwitch("disable-gpu");
    app.whenReady().then(async () => {
        const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false}});
        let code = 0;
        try {
            const sources = Object.fromEntries(Object.entries({loader: "loader", plugin: "index", lifecycle: "lifecycle",
                settingsApp: "settingsApp", global: "globalState", globalCoordinator: "globalStateCoordinator",
                events: "EventBusCore", uninstall: "uninstall"}).map(([key, file]) => [key,
                ts.transpileModule(fs.readFileSync(path.join(__dirname, "../src/plugin", file + ".ts"), "utf8"), {
                    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021},
                }).outputText]));
            sources.windowContext = ts.transpileModule(fs.readFileSync(path.join(__dirname,
                "../src/config/setting/windowContext.ts"), "utf8"), {
                compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021},
            }).outputText;
            for (const [key, file] of Object.entries({layouts: "getAll.ts", tabs: "tabUtil.ts"})) {
                sources[key] = ts.transpileModule(fs.readFileSync(path.join(__dirname, "../src/layout", file), "utf8"), {
                    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021},
                }).outputText;
            }
            await win.loadURL("about:blank");
            await win.webContents.executeJavaScript(`(${runCases.toString()})(${JSON.stringify(sources)})`);
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
    test("settings plugin instances isolate lifecycle, UI, dynamic styles, configuration and event resources", async () => {
        const profile = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-settings-plugins-"));
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
