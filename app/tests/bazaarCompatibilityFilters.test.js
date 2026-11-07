const assert = require("node:assert/strict");
const {execFile} = require("node:child_process");
const {readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync} = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {promisify} = require("node:util");

const read = file => readFileSync(path.join(__dirname, "..", file), "utf8");

const compileSources = () => {
    const ts = require("typescript");
    const compile = text => ts.transpileModule(text, {
        compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021},
    }).outputText;
    const parse = file => ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true);
    const declaration = (source, name) => {
        const node = source.statements.find(node => ts.isVariableStatement(node) &&
            node.declarationList.declarations.some(item => item.name.getText(source) === name));
        assert.ok(node, name);
        return node;
    };
    const source = parse("src/config/bazaar.ts");
    const object = declaration(source, "bazaar").declarationList.declarations[0].initializer;
    const methods = ["_activateMount", "_invalidateMount", "_captureMount", "_beginBazaarRequest",
        "_isMountCurrent", "_isBazaarRequestCurrent", "genHTML", "_genCardHTML", "_genPackageIconHTML",
        "_genFundingHTML", "_genIncompatibleChipHTML", "_genDeprecatedChipHTML", "_genUpdateButtonHTML",
        "_genUpdateButtonAriaLabel", "_cacheBazaarDeprecations", "_initBazaarPanel", "_getDetailKey",
        "_getPackageDetail", "_stopBazaarCardWatcher", "_disposeBazaarCardRender", "_isBazaarCardRenderCurrent",
        "_scheduleBazaarCardBatch", "_watchBazaarCardBatch", "_fillBazaarCard", "_fillVisibleBazaarCards",
        "_setBazaarPanelActive", "_refreshCompatibilityFilters", "_renderBazaarCards", "_onBazaar"];
    methods.forEach(name => assert.ok(object.properties.some(node => node.name?.getText(source) === name), name));
    const properties = object.properties.filter(node => !ts.isMethodDeclaration(node) ||
        methods.includes(node.name.getText(source))).map(node => node.getText(source));
    const events = parse("src/config/bazaar/events.ts");
    const rating = parse("src/config/bazaar/rating.ts");
    const mobile = parse("src/mobile/menu/settingPanel.ts");
    const body = [
        `const bazaar = {${properties.join(",")}};`,
        ...["mountBazaarTab", "unmountBazaarTab"].map(name => declaration(source, name).getText(source)),
        ...events.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(events)),
        ...["getRatingSummaryText", "genCardRatingHTML"].map(name => declaration(rating, name).getText(rating)),
        declaration(mobile, "openSettingTab").getText(mobile),
    ].join("\n").replace(/^export /gm, "");
    // 控制器和事件直接提取生产代码，网络、存储及外围窗口服务由隔离页提供。
    const modules = {};
    for (const file of ["config/bazaar/packageConfig", "config/bazaar/html", "config/bazaar/filters",
        "config/bazaar/batchRenderer", "util/bazaarPackage", "util/escape", "util/number",
        "util/themeCompatibility", "protyle/util/hasClosest", "config/bazaar/runtime", "config/bazaarTab",
        "config/util/namespaceApi", "config/util/configApi", "config/util/dotPath", "config/util/sectionRuntime",
        "config/setting/pending"]) {
        modules[file] = compile(read(`src/${file}.ts`));
    }
    assert.match(read("src/config/setting/tabs.ts"), /mount:\s*mountBazaarTab/);
    return {modules, controller: compile(body) + "\nreturn {bazaar, mountBazaarTab, unmountBazaarTab, bindBazaarEvents, openSettingTab};"};
};

const setupFixture = async ({sources, languages, mobile}) => {
    const assert = require("node:assert/strict");
    const path = require("node:path");
    const cache = {};
    const requests = [];
    const writes = [];
    const persistence = {paused: false, saves: [], messages: []};
    let api;
    let mounted;
    let serverConfig = {trust: true, petalDisabled: false};
    window.siyuan = {languages, storage: {"local-bazaar": {
        plugin: "0", theme: "0", icon: "0", template: "0", widget: "0", downloadedPlugin: "0",
    }}, config: {bazaar: JSON.parse(JSON.stringify(serverConfig))}};
    const overrides = {
        "util/fetch": {fetchSyncPost: (url, patch) => {
            assert.equal(url, "/api/setting/patch");
            const operation = {};
            const result = new Promise(resolve => {
                operation.finish = (success = true) => {
                    if (success) {
                        for (const [type, filters] of Object.entries(patch.bazaar.compatibilityFilters)) {
                            for (const [filter, value] of Object.entries(filters)) {
                                serverConfig = load("config/util/dotPath").mergeRecordByDottedPath(serverConfig,
                                    `compatibilityFilters.${type}.${filter}`, value);
                            }
                        }
                    }
                    resolve({code: success ? 0 : -1, msg: success ? "" : "Save rejected"});
                };
            });
            persistence.saves.push({patch, ...operation});
            if (!persistence.paused) operation.finish();
            return result;
        }},
        "config/setting/sync": {refreshSettingConfigAfter: async (namespace, save) => {
            assert.equal(namespace, "bazaar");
            await save();
            await load("config/bazaar/runtime").bazaarConfigApi.apply(JSON.parse(JSON.stringify(serverConfig)));
            await load("config/bazaarTab").refreshMountedBazaarFilters();
            return true;
        }},
    };
    const load = key => {
        if (key === "config/bazaar") return api;
        if (overrides[key]) return overrides[key];
        if (cache[key]) return cache[key];
        const exports = {};
        cache[key] = exports;
        assert.ok(sources.modules[key], `available source: ${key}`);
        new Function("require", "exports", sources.modules[key])(
            name => load(path.posix.normalize(path.posix.join(path.posix.dirname(key), name))), exports);
        return exports;
    };
    const dependencies = Object.assign({}, ...Object.keys(sources.modules).filter(key =>
        !key.startsWith("config/util/") && key !== "config/bazaarTab" && key !== "config/setting/pending").map(load));
    document.documentElement.dataset.frontend = mobile ? "browser-mobile" : "browser-desktop";
    const bind = root => {
        mounted = load("config/bazaarTab").mountBazaarTab(root).then(() => {
            api.bindBazaarEvents(api.bazaar, {}, api.bazaar._captureMount());
        });
        return mounted;
    };
    Object.assign(dependencies, {
        Constants: {LOCAL_BAZAAR: "local-bazaar"},
        getFrontend: () => mobile ? "browser-mobile" : "browser-desktop", isMobile: () => mobile,
        syncRatingUser: () => false, renderBazaarInstall() {},
        showMessage: message => persistence.messages.push(message),
        fetchPost: (url, data, callback) => {
            requests.push({url, data, callback});
            return Promise.resolve();
        },
        setStorageVal: (key, value) => writes.push({key, value: JSON.parse(JSON.stringify(value))}),
        getSettingTab: id => { assert.equal(id, "bazaar"); return {mount: bind}; },
        watchSettingTabInteractions() {}, bindSettingSaveDelegation() {}, closeModel() {},
        openModel: options => {
            document.body.innerHTML = '<div id="model" style="width:100%;height:100%"><div class="fixture-host" style="width:100%;height:100%"></div></div>';
            const host = document.querySelector(".fixture-host");
            host.innerHTML = options.html;
            options.bindEvent(host);
        },
    });
    api = new Function(...Object.keys(dependencies), sources.controller)(...Object.values(dependencies));
    const {bazaar} = api;
    const remount = async () => {
        if (bazaar.element) load("config/bazaarTab").unmountBazaarTab(bazaar.element);
        if (mobile) {
            api.openSettingTab({}, {id: "bazaar", title: languages.bazaar});
            await mounted;
            assert.ok(bazaar.element.classList.contains("config--mobile"));
        } else {
            document.body.innerHTML = '<div class="config" style="height:100%;width:100%"></div>';
            await bind(document.body.firstElementChild);
        }
        const installed = [{name: "installed-incompatible", bazaarIncompatible: true, bazaarVersionUnsupported: true}];
        bazaar._data.downloaded = installed;
        bazaar.element.querySelector("#configBazaarDownloaded").textContent = "Installed packages stay visible";
    };
    const panel = type => bazaar.element.querySelector(`.config-bazaar__panel[data-type="${dependencies.BAZAAR_PACKAGE_CONFIG[type].tabType}"]`);
    const input = (type, filter) => panel(type).querySelector(`[data-bazaar-filter="${filter}"]`);
    const names = type => Array.from(panel(type).querySelectorAll(".b3-card[data-name]"), item => item.dataset.name);
    const response = (type, packages, mount = bazaar._beginBazaarRequest(type)) => {
        panel(type).setAttribute("data-init", "true");
        bazaar._onBazaar({code: 0, data: {packages}}, type, mount);
    };
    const select = (type, value, mode = false) => {
        const element = panel(type).querySelector(mode ? "#bazaarSelect" : ".b3-select");
        element.value = value;
        element.dispatchEvent(new Event("change", {bubbles: true}));
    };
    const activate = type => {
        const tab = dependencies.BAZAAR_PACKAGE_CONFIG[type].tabType;
        bazaar.element.querySelector(`.layout-tab-bar [data-type="${tab}"]`).click();
    };
    const packages = [
        {name: "new", created: "2025-02-01T00:00:00Z", modes: ["light"]},
        {name: "old", created: "2024-01-01T00:00:00Z", modes: ["dark"]},
        {name: "version", bazaarVersionUnsupported: true, created: "2025-03-01T00:00:00Z"},
        {name: "platform", bazaarIncompatible: true, created: "2025-04-01T00:00:00Z"},
        {name: "both", bazaarVersionUnsupported: true, bazaarIncompatible: true, created: "2025-05-01T00:00:00Z"},
        {name: "unknown"},
        {name: "same-time", created: "2025-02-01T08:00:00+08:00", modes: ["light", "dark"]},
    ].map((item, index) => ({preferredName: item.name, preferredDesc: "Marketplace compatibility regression",
        author: "SiYuan", frontends: ["all"], downloads: 100 - index, updated: `2025-06-0${7 - index}`, ...item}));
    window.fixture = {api, bazaar, remount, panel, input, names, response, select, activate,
        packages, requests, writes, persistence, types: dependencies.BAZAAR_PACKAGE_TYPES, mobile,
        settle: () => load("config/setting/pending").flushSettingSaves(),
        snapshot: () => JSON.parse(JSON.stringify(serverConfig))};
    await remount();
};

const runInteractionCases = async () => {
    const assert = require("node:assert/strict");
    const f = window.fixture;
    const {bazaar, panel, input, names, response, select, activate, packages, requests, writes, types} = f;
    const version = "hideUnsupportedVersion";
    const platform = "hideIncompatiblePlatform";
    const toggle = async (type, filter, label = false) => {
        const control = input(type, filter);
        (label ? control.labels[0] : control).click();
        await f.settle();
    };
    const installedHTML = bazaar.element.querySelector("#configBazaarDownloaded").innerHTML;
    for (const type of types) {
        activate(type);
        response(type, packages);
        assert.equal(panel(type).querySelectorAll("[data-bazaar-filter]").length, 2);
        for (const filter of [version, platform]) {
            const element = input(type, filter);
            assert.equal(element.type, "checkbox");
            assert.equal(element.checked, false);
            assert.equal(element.labels.length, 1);
            assert.ok(element.labels[0].textContent.trim().length > 0);
            assert.equal(element.tabIndex, 0);
        }
        assert.equal(panel(type).querySelector(".counter").textContent, "7");
        await toggle(type, version, true);
        assert.equal(input(type, version).checked, true, "label activates the native checkbox");
        assert.deepEqual(names(type), ["new", "old", "platform", "unknown", "same-time"]);
        await toggle(type, platform);
        assert.deepEqual(names(type), ["new", "old", "unknown", "same-time"]);
        assert.equal(panel(type).querySelector(".counter").textContent, "4");
        assert.equal(bazaar._data[type], packages, "filters preserve the source collection");
        assert.equal(bazaar._data.downloaded.length, 1);
        assert.equal(bazaar.element.querySelector("#configBazaarDownloaded").innerHTML, installedHTML);
        await toggle(type, version);
        assert.deepEqual(names(type), ["new", "old", "version", "unknown", "same-time"]);
        await toggle(type, platform);
        assert.equal(names(type).length, 7);
    }
    assert.equal(bazaar.element.querySelector('[data-type="downloaded"] [data-bazaar-filter]'), null);
    activate("plugins");
    await toggle("plugins", version);
    assert.equal(input("themes", version).checked, false, "types do not share preferences");
    select("plugins", "6");
    assert.deepEqual(names("plugins"), ["platform", "new", "same-time", "old", "unknown"]);
    select("plugins", "7");
    assert.deepEqual(names("plugins"), ["old", "new", "same-time", "platform", "unknown"]);
    assert.equal(writes.at(-1).value.plugin, "7");
    assert.equal(window.siyuan.config.bazaar.compatibilityFilters.plugins.hideUnsupportedVersion, true);
    assert.equal(writes.at(-1).value.compatibilityFilters, undefined, "filters are not stored in local.json");
    await toggle("plugins", platform);
    response("plugins", packages.filter(item => item.name === "both"));
    assert.deepEqual(names("plugins"), []);
    assert.equal(panel("plugins").querySelector(".counter").textContent, "0");
    assert.equal(panel("plugins").querySelector(".b3-list--empty").textContent, window.siyuan.languages.emptyContent);
    await toggle("plugins", platform);
    await toggle("plugins", version);
    assert.deepEqual(names("plugins"), ["both"]);
    const search = panel("plugins").querySelector(".b3-text-field");
    search.value = "  search  ";
    const count = requests.length;
    search.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", isComposing: true, bubbles: true}));
    assert.equal(requests.length, count, "IME composition does not submit a search");
    search.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}));
    const pending = requests.at(-1);
    assert.equal(pending.data.keyword, "search");
    assert.equal(pending.data.frontend, f.mobile ? "browser-mobile" : "browser-desktop");
    await toggle("plugins", version);
    await toggle("plugins", platform);
    pending.callback({code: 0, data: {packages}});
    assert.deepEqual(names("plugins"), ["old", "new", "same-time", "unknown"], "search uses current filters and sort");
    assert.equal(search.value, "  search  ", "saving filters retains the search field");
    assert.equal(bazaar.element.querySelector(".layout-tab-bar .item--focus").dataset.type, "plugin");
    search.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}));
    const stale = requests.at(-1);
    search.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}));
    requests.at(-1).callback({code: 0, data: {packages: [packages[0]]}});
    stale.callback({code: 0, data: {packages}});
    assert.deepEqual(names("plugins"), ["new"], "an older search cannot overwrite newer results");
    activate("themes");
    await toggle("themes", version);
    await toggle("themes", platform);
    select("themes", "6");
    select("themes", "1", true);
    assert.deepEqual(names("themes"), ["same-time", "old", "unknown"]);
    await toggle("themes", version);
    assert.deepEqual(names("themes"), ["version", "same-time", "old", "unknown"]);
    assert.equal(panel("themes").querySelector("#bazaarSelect").value, "1");
    assert.equal(panel("themes").querySelector(".b3-select").value, "6");
    await toggle("themes", version);
    assert.deepEqual(names("themes"), ["same-time", "old", "unknown"]);
    select("themes", "0", true);
    assert.deepEqual(names("themes"), ["new", "same-time", "unknown"]);
    select("themes", "7");
    assert.deepEqual(names("themes"), ["new", "same-time", "unknown"]);
    select("themes", "2", true);
    assert.deepEqual(names("themes"), ["old", "new", "same-time", "unknown"]);
    const persisted = f.snapshot();
    const oldRoot = bazaar.element;
    await f.remount();
    assert.equal(oldRoot.isConnected, false);
    window.siyuan.config.bazaar = JSON.parse(JSON.stringify(persisted));
    await f.remount();
    assert.equal(input("plugins", version).checked, true);
    assert.equal(input("plugins", platform).checked, true);
    assert.equal(input("icons", version).checked, false);
    assert.equal(panel("themes").querySelector(".b3-select").value, "7");
    activate("plugins");
    response("plugins", packages);
    assert.deepEqual(names("plugins"), ["old", "new", "same-time", "unknown"]);
    stale.callback({code: 0, data: {packages: []}});
    assert.equal(names("plugins").length, 4, "unmounted search responses are ignored");
    await toggle("plugins", version);
    await toggle("plugins", platform);
    // 隐藏面板保持占位，可确定验证批渲染与筛选交替时的状态释放。
    const many = Array.from({length: 60}, (_, i) => ({...packages[0], name: `package-${i}`, bazaarVersionUnsupported: i % 2 === 1}));
    response("widgets", many);
    const container = panel("widgets").querySelector(".config-bazaar__content");
    const previousState = bazaar._bazaarCardRenderStates.get(container);
    assert.equal(container.querySelectorAll(".b3-card[data-name]").length, 24);
    assert.equal(container.querySelectorAll("[data-bazaar-index]").length, 36);
    await toggle("widgets", version);
    assert.equal(previousState.active, false);
    assert.equal(panel("widgets").querySelector(".counter").textContent, "30");
    assert.equal(container.querySelectorAll("[data-bazaar-index]").length, 6);
    const currentState = bazaar._bazaarCardRenderStates.get(container);
    assert.ok(currentState.packages.every(item => !item.bazaarVersionUnsupported));
    bazaar._fillBazaarCard(currentState, container.querySelector("[data-bazaar-index]"));
    assert.equal(names("widgets").at(-1), "package-48");
    assert.equal(currentState.cursor, 25);
    return {types: types.length, writes: writes.length, mobile: f.mobile};
};

const runPersistenceCases = async () => {
    const assert = require("node:assert/strict");
    const f = window.fixture;
    const {input, names, response, packages, persistence, bazaar} = f;
    const version = "hideUnsupportedVersion";
    const platform = "hideIncompatiblePlatform";
    const tick = () => new Promise(resolve => setTimeout(resolve, 0));
    f.activate("plugins");
    response("plugins", packages);
    persistence.paused = true;
    const initialSaves = persistence.saves.length;
    const versionInput = input("plugins", version);
    versionInput.focus();
    versionInput.click();
    assert.equal(versionInput.disabled, true);
    assert.equal(window.siyuan.config.bazaar.compatibilityFilters.plugins.hideUnsupportedVersion, false);
    versionInput.click();
    await tick();
    assert.equal(persistence.saves.length, initialSaves + 1, "rapid clicks cannot duplicate a pending save");
    response("plugins", packages);
    assert.equal(names("plugins").length, 7, "a search response uses confirmed configuration while saving");
    const platformInput = input("plugins", platform);
    platformInput.focus();
    platformInput.click();
    await tick();
    assert.equal(platformInput.disabled, true);
    assert.equal(persistence.saves.length, initialSaves + 1, "namespace writes serialize different switches");
    persistence.saves[initialSaves].finish();
    await tick();
    assert.equal(persistence.saves.length, initialSaves + 2);
    assert.equal(versionInput.disabled, false);
    assert.equal(versionInput.checked, true);
    assert.notEqual(document.activeElement, versionInput, "the earlier save cannot steal focus from a later pending switch");
    assert.equal(platformInput.checked, true, "refresh does not overwrite another pending checkbox");
    assert.equal(names("plugins").length, 5);
    const failed = f.settle().then(() => assert.fail("rejected save must fail"), () => {});
    persistence.saves[initialSaves + 1].finish(false);
    await failed;
    await tick();
    assert.equal(platformInput.disabled, false);
    assert.equal(platformInput.checked, false);
    assert.equal(document.activeElement, platformInput, "the last operated switch regains keyboard focus after failure");
    assert.equal(window.siyuan.config.bazaar.compatibilityFilters.plugins.hideIncompatiblePlatform, false);
    assert.equal(names("plugins").length, 5, "failed writes do not filter the list");
    assert.equal(persistence.messages.at(-1), "Save rejected");
    persistence.paused = false;
    platformInput.click();
    await f.settle();
    assert.equal(names("plugins").length, 4, "failed saves can be retried");
    persistence.paused = true;
    versionInput.click();
    await tick();
    const pending = persistence.saves.at(-1);
    const oldRoot = bazaar.element;
    await f.remount();
    f.activate("plugins");
    response("plugins", packages);
    assert.equal(oldRoot.isConnected, false);
    assert.equal(input("plugins", version).checked, true, "remount reads saved rather than pending state");
    assert.equal(input("plugins", version).disabled, false);
    const search = f.panel("plugins").querySelector(".b3-text-field");
    search.focus();
    pending.finish();
    await f.settle();
    assert.equal(input("plugins", version).checked, false, "late save refreshes the current mount");
    assert.equal(names("plugins").length, 5);
    assert.equal(document.activeElement, search, "a save on an old mount cannot steal the current search focus");
    persistence.paused = false;
    input("plugins", platform).click();
    await f.settle();
    assert.equal(names("plugins").length, 7);
    assert.ok(persistence.saves.every(({patch}) => Object.keys(patch).join() === "bazaar"));
    return {saves: persistence.saves.length, rejected: persistence.messages.length};
};

const checkLayout = () => {
    const assert = require("node:assert/strict");
    const {panel, types} = window.fixture;
    for (const type of types) {
        const element = panel(type);
        if (element.classList.contains("fn__none")) continue;
        const title = element.querySelector(".config-bazaar__title");
        const bounds = title.getBoundingClientRect();
        assert.ok(bounds.left >= -1 && bounds.right <= innerWidth + 1, `${type}: title fits the viewport`);
        assert.ok(element.scrollWidth <= element.clientWidth + 1, `${type}: no horizontal panel overflow`);
        const controls = title.querySelectorAll("select, .config-bazaar__filter-row, .config-bazaar__compatibility > label");
        for (const control of controls) {
            const rect = control.getBoundingClientRect();
            assert.ok(rect.width > 0 && rect.height >= 16, `${type}: visible control`);
            assert.ok(rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1, `${type}: control fits title`);
            assert.ok(rect.top >= bounds.top - 1 && rect.bottom <= bounds.bottom + 1, `${type}: control is not clipped`);
            assert.ok(control.scrollWidth <= control.clientWidth + 1, `${type}: control content does not overflow`);
        }
        const labels = Array.from(title.querySelectorAll(".config-bazaar__compatibility > label"));
        const rectangles = Array.from(controls, control => control.getBoundingClientRect());
        rectangles.forEach((a, index) => rectangles.slice(index + 1).forEach(b => {
            assert.ok(a.right <= b.left + 1 || b.right <= a.left + 1 || a.bottom <= b.top + 1 || b.bottom <= a.top + 1,
                `${type}: toolbar controls do not overlap`);
        }));
        for (const label of labels) {
            const input = label.querySelector("input");
            assert.equal(Math.round(input.getBoundingClientRect().width), 26, "shared switches keep their width");
            assert.notEqual(getComputedStyle(input).backgroundColor, "rgba(0, 0, 0, 0)");
        }
    }
    return {width: innerWidth, height: innerHeight};
};

const runElectron = async () => {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", process.argv.at(-1));
    app.disableHardwareAcceleration();
    await app.whenReady();
    const watchdog = setTimeout(() => app.exit(1), 90000);
    const win = new BrowserWindow({show: false, width: 1100, height: 900,
        webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true}});
    let code = 0;
    try {
        const sources = compileSources();
        const sass = require("sass");
        const styles = {
            desktop: sass.compile(path.join(__dirname, "../src/assets/scss/base.scss"), {logger: sass.Logger.silent}).css,
            mobile: sass.compile(path.join(__dirname, "../src/assets/scss/mobile.scss"), {logger: sass.Logger.silent}).css,
        };
        const languages = Object.fromEntries(["en", "de", "zh-CN"].map(lang => [lang, JSON.parse(read(`appearance/langs/${lang}.json`))]));
        const evaluate = (fn, argument) => win.webContents.executeJavaScript(`(async () => {
            try { return {value: await (${fn.toString()})(${JSON.stringify(argument)})}; }
            catch (error) { return {error: error.stack}; }
        })()`).then(result => { assert.equal(result.error, undefined); return result.value; });
        let layouts = 0;
        for (const mobile of [false, true]) {
            await win.loadURL("data:text/html,<html><head><meta name='viewport' content='width=device-width, initial-scale=1'></head><body></body></html>");
            await win.webContents.insertCSS(styles[mobile ? "mobile" : "desktop"]);
            const theme = await win.webContents.insertCSS(read("appearance/themes/daylight/theme.css"));
            await evaluate(setupFixture, {sources, languages: languages.en, mobile});
            console.log("Interaction coverage", await evaluate(runInteractionCases));
            console.log("Persistence coverage", await evaluate(runPersistenceCases));
            win.webContents.debugger.attach("1.3");
            // 通过 Chromium 的输入通道发送空格和 Tab，验证浏览器原生键盘行为。
            await evaluate(() => {
                window.fixture.activate("plugins");
                window.fixture.input("plugins", "hideUnsupportedVersion").focus();
                require("node:assert/strict").equal(document.activeElement, window.fixture.input("plugins", "hideUnsupportedVersion"));
            });
            win.webContents.sendInputEvent({type: "keyDown", keyCode: "Space"});
            win.webContents.sendInputEvent({type: "keyUp", keyCode: "Space"});
            await new Promise(resolve => setTimeout(resolve, 50));
            await evaluate(async () => {
                const assert = require("node:assert/strict");
                await window.fixture.settle();
                assert.equal(window.fixture.input("plugins", "hideUnsupportedVersion").checked, true);
                assert.equal(document.activeElement, window.fixture.input("plugins", "hideUnsupportedVersion"),
                    "keyboard focus returns after the save without needing another Tab");
                assert.deepEqual(window.fixture.names("plugins"), ["old", "new", "same-time", "platform", "unknown"]);
            });
            win.webContents.sendInputEvent({type: "keyDown", keyCode: "Tab"});
            win.webContents.sendInputEvent({type: "keyUp", keyCode: "Tab"});
            await new Promise(resolve => setTimeout(resolve, 50));
            await evaluate(() => require("node:assert/strict").equal(document.activeElement, window.fixture.input("plugins", "hideIncompatiblePlatform")));
            await win.webContents.removeInsertedCSS(theme);
            for (const appearance of ["daylight", "midnight"]) {
                const themeID = await win.webContents.insertCSS(read(`appearance/themes/${appearance}/theme.css`));
                for (const [width, font, language] of mobile ? [[320, 14, "en"], [390, 24, "de"], [768, 24, "zh-CN"]] :
                    [[1100, 14, "en"], [600, 24, "de"], [400, 24, "zh-CN"]]) {
                    await win.webContents.debugger.sendCommand("Emulation.setDeviceMetricsOverride", {
                        width, height: 900, deviceScaleFactor: 1, mobile,
                    });
                    await evaluate(async ({font, languages, appearance}) => {
                        document.documentElement.style.setProperty("--b3-font-size", `${font}px`);
                        document.body.style.fontSize = `${font}px`;
                        document.documentElement.dataset.themeMode = appearance === "midnight" ? "dark" : "light";
                        window.siyuan.languages = languages;
                        await window.fixture.remount();
                        for (const type of window.fixture.types) window.fixture.response(type, window.fixture.packages);
                    }, {font, languages: languages[language], appearance});
                    for (const type of ["plugins", "themes"]) {
                        await evaluate(type => window.fixture.activate(type), type);
                        await evaluate(checkLayout);
                        layouts++;
                    }
                    if (process.env.SIYUAN_BAZAAR_SCREENSHOTS) {
                        await new Promise(resolve => setTimeout(resolve, 100));
                        mkdirSync(process.env.SIYUAN_BAZAAR_SCREENSHOTS, {recursive: true});
                        const file = `${mobile ? "mobile" : "desktop"}-${appearance}-${width}-${font}-${language}.png`;
                        writeFileSync(path.join(process.env.SIYUAN_BAZAAR_SCREENSHOTS, file), (await win.webContents.capturePage()).toPNG());
                    }
                }
                await win.webContents.removeInsertedCSS(themeID);
            }
            win.webContents.debugger.detach();
        }
        console.log(`Verified marketplace compatibility interactions and ${layouts} production-style layouts`);
    } catch (error) {
        console.error(error);
        code = 1;
    } finally {
        win.destroy();
        clearTimeout(watchdog);
        app.exit(code);
    }
};

if (process.versions.electron && process.type === "browser") {
    runElectron().catch(error => {console.error(error); require("electron").app.exit(1);});
} else {
    require("node:test").test("marketplace compatibility controls compose with search, sorting, remounts and responsive layouts", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY && !process.env.SIYUAN_ELECTRON_HEADLESS,
        timeout: 100000,
    }, async () => {
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-bazaar-compatibility-"));
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const headless = process.env.SIYUAN_ELECTRON_HEADLESS ?
            ["--ozone-platform=headless", "--ozone-override-screen-size=1920,1080"] : [];
        try {
            const {stdout} = await promisify(execFile)(require("electron"), [...headless, __filename, profile], {
                env, windowsHide: true, timeout: 95000, maxBuffer: 1024 * 1024,
            });
            assert.match(stdout, /Verified marketplace compatibility interactions and 24 production-style layouts/);
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(profile).startsWith("siyuan-bazaar-compatibility-"));
            rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
