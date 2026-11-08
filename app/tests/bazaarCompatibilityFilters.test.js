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
        "config/setting/pending", "config/bazaar/filterMenu", "menus/Menu", "menus/menuToggle",
        "menus/menuPosition", "menus/menuMouseScroll", "menus/menuGroup", "menus/menuKeyboard",
        "menus/sheetOpen", "menus/sheetActions", "mobile/util/mobileSheetGesture", "mobile/util/keyboardSheetState", "util/setPosition", "util/zIndex"]) {
        modules[file] = compile(read(`src/${file}.ts`));
    }
    assert.match(read("src/config/setting/tabs.ts"), /mount:\s*mountBazaarTab/);
    return {modules, icons: read("appearance/icons/litheness/icon.js"),
        controller: compile(body) + "\nreturn {bazaar, mountBazaarTab, unmountBazaarTab, bindBazaarEvents, openSettingTab};"};
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
    }}, config: {bazaar: JSON.parse(JSON.stringify(serverConfig)), appearance: {}}, zIndex: 10,
    mobile: {size: {portrait: {height1: innerHeight}}}, menus: {}};
    const overrides = {
        "protyle/util/compatibility": {getEventName: () => "click", isInMobileApp: () => false,
            updateHotkeyTip: value => value},
        "util/functions": {isMobile: () => mobile},
        "layout/getTopBarHeight": {getTopBarHeight: () => 0},
        constants: {Constants: {TIMEOUT_DBLCLICK: 10, ATTRIBUTE_MENU_KEYMAP: "data-keymap",
            KEYCODELIST: {13: "↩", 27: "Escape", 32: " ", 37: "←", 38: "↑", 39: "→", 40: "↓"}}},
        "protyle/undo": {electronUndo() {}},
        "plugin/EventBusCore": {forEachPluginSubscriber() {}},
        "mobile/util/keyboardToolbar": {activeBlur() {}},
        "block/popoverLifecycle": {setPopoverMenuOpen() {}},
        "config/entryVisibility/runtime": {applyMenuEntryVisibility() {}},
        "dialog/message": {showMessage: message => persistence.messages.push(message)},
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
    document.addEventListener("keydown", event => {
        if (load("menus/Menu").bindMenuKeydown(event)) {
            event.preventDefault();
        } else if (event.key === "Escape") {
            window.siyuan.menus.menu.remove(true);
        }
    });
    const createMenu = () => {
        if (window.siyuan.menus.menu) {
            document.body.append(window.siyuan.menus.menu.element);
            return;
        }
        const element = document.createElement("div");
        element.id = "commonMenu";
        element.className = "b3-menu fn__none";
        element.innerHTML = '<div class="b3-menu__title fn__none"><span class="b3-menu__label"></span></div>' +
            '<div class="b3-menu__items"></div>';
        document.body.append(element);
        window.siyuan.menus.menu = new (load("menus/Menu").Menu)(element);
    };
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
            createMenu();
            options.bindEvent(host);
        },
    });
    api = new Function(...Object.keys(dependencies), sources.controller)(...Object.values(dependencies));
    const {bazaar} = api;
    // 批量更新控件由独立用例覆盖，此夹具仅挂载兼容性筛选。
    bazaar._refreshBatchUpdatePreferences = () => {};
    const remount = async () => {
        if (bazaar.element) load("config/bazaarTab").unmountBazaarTab(bazaar.element);
        if (mobile) {
            api.openSettingTab({}, {id: "bazaar", title: languages.bazaar});
            await mounted;
            assert.ok(bazaar.element.classList.contains("config--mobile"));
        } else {
            document.body.innerHTML = '<div class="config" style="height:100%;width:100%"></div>';
            createMenu();
            await bind(document.body.firstElementChild);
        }
        const installed = [{name: "installed-incompatible", bazaarIncompatible: true, bazaarVersionUnsupported: true}];
        bazaar._data.downloaded = installed;
        bazaar.element.querySelector("#configBazaarDownloaded").textContent = "Installed packages stay visible";
        new Function(sources.icons)();
    };
    const panel = type => bazaar.element.querySelector(`.config-bazaar__panel[data-type="${dependencies.BAZAAR_PACKAGE_CONFIG[type].tabType}"]`);
    const button = type => panel(type).querySelector("[data-bazaar-filter-menu]");
    const input = (type, filter) => {
        const menu = window.siyuan.menus.menu;
        if (menu.data !== button(type) || menu.element.classList.contains("fn__none")) button(type).click();
        return menu.element.querySelector(`[data-bazaar-filter="${filter}"]`);
    };
    const checked = (type, filter) => window.siyuan.config.bazaar.compatibilityFilters?.[type]?.[filter] === true;
    const waitForMenu = async () => {
        const menu = window.siyuan.menus.menu.element;
        const deadline = performance.now() + 2000;
        while (performance.now() < deadline) {
            const transform = getComputedStyle(menu).transform;
            if (!menu.classList.contains("b3-menu--sheet") ||
                (menu.style.transform === "translateY(0px)" &&
                    (transform === "none" || Math.abs(new DOMMatrixReadOnly(transform).m42) < .5))) return;
            await new Promise(resolve => setTimeout(resolve, 25));
        }
        assert.fail("shared menu opening animation did not settle");
    };
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
    window.fixture = {api, bazaar, remount, panel, button, input, checked, waitForMenu, names, response, select, activate,
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
    const toggle = async (type, filter) => {
        input(type, filter).click();
        await f.settle();
    };
    const installedHTML = bazaar.element.querySelector("#configBazaarDownloaded").innerHTML;
    for (const type of types) {
        activate(type);
        response(type, packages);
        assert.equal(panel(type).querySelectorAll("[data-bazaar-filter]").length, 0);
        assert.equal(panel(type).querySelectorAll("[data-bazaar-filter-menu]").length, 1);
        assert.equal(f.button(type).getAttribute("aria-haspopup"), "menu");
        for (const filter of [version, platform]) {
            const element = input(type, filter);
            assert.equal(element.getAttribute("role"), "menuitemcheckbox");
            assert.equal(element.getAttribute("aria-checked"), "false");
            assert.ok(element.textContent.trim().length > 0);
            assert.equal(element.tabIndex, 0);
        }
        f.button(type).click();
        await new Promise(resolve => setTimeout(resolve, 30));
        assert.equal(f.button(type).getAttribute("aria-expanded"), "false", "repeated trigger closes the owned menu");
        assert.equal(window.siyuan.menus.menu.element.classList.contains("fn__none"), true);
        assert.equal(panel(type).querySelector(".counter").textContent, "7");
        await toggle(type, version);
        assert.equal(f.checked(type, version), true);
        assert.equal(f.button(type).classList.contains("block__icon--active"), false, "enabled filters do not add a persistent background");
        assert.equal(input(type, version).getAttribute("aria-checked"), "true", "reopened menu shows saved state");
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
        assert.equal(f.button(type).classList.contains("block__icon--active"), false);
    }
    assert.equal(bazaar.element.querySelector('[data-type="downloaded"] [data-bazaar-filter-menu]'), null);
    activate("plugins");
    await toggle("plugins", version);
    assert.equal(f.checked("themes", version), false, "types do not share preferences");
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
    assert.equal(f.checked("plugins", version), true);
    assert.equal(f.checked("plugins", platform), true);
    assert.equal(f.checked("icons", version), false);
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
    const {input, button, checked, names, response, packages, persistence, bazaar} = f;
    const version = "hideUnsupportedVersion";
    const platform = "hideIncompatiblePlatform";
    const tick = () => new Promise(resolve => setTimeout(resolve, 0));
    f.activate("plugins");
    response("plugins", packages);
    persistence.paused = true;
    const initialSaves = persistence.saves.length;
    const trigger = button("plugins");
    const assertReady = () => {
        assert.equal(trigger.disabled, false);
        assert.equal(trigger.hasAttribute("aria-disabled"), false);
        assert.equal(trigger.hasAttribute("aria-busy"), false);
    };
    assertReady();
    const firstItem = input("plugins", version);
    firstItem.focus();
    firstItem.click();
    assert.equal(trigger.disabled, false, "saving preserves native focusability");
    assert.equal(trigger.getAttribute("aria-disabled"), "true");
    assert.equal(trigger.getAttribute("aria-busy"), "true");
    assert.equal(document.activeElement, trigger, "closing the menu immediately restores focus while saving");
    await new Promise(resolve => setTimeout(resolve, 350));
    assert.equal(getComputedStyle(trigger).opacity, "1", "saving must not dim the filter trigger");
    assert.equal(checked("plugins", version), false);
    trigger.click();
    firstItem.click();
    assert.equal(trigger.dispatchEvent(new MouseEvent("click", {bubbles: true, cancelable: true})), false);
    await tick();
    assert.equal(persistence.saves.length, initialSaves + 1, "rapid trigger clicks cannot duplicate a pending save");
    assert.equal(window.siyuan.menus.menu.element.classList.contains("fn__none"), true);
    response("plugins", packages);
    assert.equal(names("plugins").length, 7, "a search response uses confirmed configuration while saving");
    persistence.saves[initialSaves].finish();
    await f.settle();
    await tick();
    assertReady();
    assert.equal(checked("plugins", version), true);
    assert.equal(document.activeElement, trigger, "keyboard focus returns to the trigger after saving");
    assert.equal(names("plugins").length, 5);
    input("plugins", platform).focus();
    input("plugins", platform).click();
    await tick();
    const failed = f.settle().then(() => assert.fail("rejected save must fail"), () => {});
    persistence.saves.at(-1).finish(false);
    await failed;
    await tick();
    assertReady();
    assert.equal(checked("plugins", platform), false);
    assert.equal(document.activeElement, trigger, "failed saves release the trigger and restore keyboard focus");
    assert.equal(names("plugins").length, 5, "failed writes do not filter the list");
    assert.equal(getComputedStyle(trigger).opacity, "1", "failed saves keep the trigger visible");
    assert.equal(persistence.messages.at(-1), "Save rejected");
    input("plugins", platform).focus();
    input("plugins", platform).click();
    await tick();
    f.activate("icons");
    input("icons", version).focus();
    input("icons", version).click();
    await tick();
    const firstConcurrent = persistence.saves.at(-1);
    firstConcurrent.finish();
    await tick();
    assert.notEqual(document.activeElement, trigger, "the earlier package save cannot steal the later operation's focus");
    const lastConcurrent = persistence.saves.at(-1);
    assert.notEqual(lastConcurrent, firstConcurrent, "different package saves remain serialized");
    lastConcurrent.finish();
    await f.settle();
    await tick();
    assert.equal(document.activeElement, button("icons"));
    persistence.paused = false;
    input("icons", version).click();
    await f.settle();
    f.activate("plugins");
    input("plugins", platform).click();
    await f.settle();
    input("plugins", platform).click();
    await f.settle();
    assert.equal(names("plugins").length, 4, "failed saves can be retried");
    persistence.paused = true;
    input("plugins", version).click();
    await tick();
    const pending = persistence.saves.at(-1);
    f.activate("icons");
    input("icons", version);
    const iconMenu = window.siyuan.menus.menu.element;
    pending.finish();
    await f.settle();
    assert.equal(iconMenu.classList.contains("fn__none"), false,
        "an earlier save cannot close another package type's menu");
    assert.equal(window.siyuan.menus.menu.data, button("icons"));
    window.siyuan.menus.menu.remove();
    f.activate("plugins");
    input("plugins", version).click();
    await tick();
    const pendingRemount = persistence.saves.at(-1);
    const oldRoot = bazaar.element;
    await f.remount();
    f.activate("plugins");
    response("plugins", packages);
    assert.equal(oldRoot.isConnected, false);
    assert.equal(checked("plugins", version), false, "remount reads saved rather than pending state");
    assert.equal(button("plugins").disabled, false);
    const search = f.panel("plugins").querySelector(".b3-text-field");
    search.focus();
    pendingRemount.finish();
    await f.settle();
    assert.equal(checked("plugins", version), true, "late save refreshes the current mount");
    assert.equal(names("plugins").length, 4);
    assert.equal(document.activeElement, search, "a save on an old mount cannot steal the current search focus");
    persistence.paused = false;
    input("plugins", version).click();
    await f.settle();
    input("plugins", platform).click();
    await f.settle();
    assert.equal(names("plugins").length, 7);
    persistence.paused = true;
    input("plugins", version).focus();
    input("plugins", version).click();
    await tick();
    f.activate("icons");
    button("icons").dispatchEvent(new MouseEvent("click", {bubbles: true, detail: 1}));
    document.activeElement.blur();
    input("icons", version).dispatchEvent(new MouseEvent("click", {bubbles: true, detail: 1}));
    await tick();
    persistence.saves.at(-1).finish();
    await tick();
    assert.equal(document.activeElement, document.body,
        "a keyboard-started save cannot reclaim focus after a later non-focusing touch selection");
    persistence.saves.at(-1).finish();
    await f.settle();
    await tick();
    assert.equal(document.activeElement, document.body, "touch selection does not force keyboard focus");
    persistence.paused = false;
    input("icons", version).click();
    await f.settle();
    f.activate("plugins");
    input("plugins", version).click();
    await f.settle();
    input("plugins", version);
    const oldMenu = window.siyuan.menus.menu.element;
    await f.remount();
    assert.equal(oldMenu.classList.contains("fn__none"), true, "unmount closes the owned filter menu");
    assert.ok(persistence.saves.every(({patch}) => Object.keys(patch).join() === "bazaar"));
    return {saves: persistence.saves.length, rejected: persistence.messages.length};
};

const checkLayout = async () => {
    const assert = require("node:assert/strict");
    const {panel, button, input, types, mobile} = window.fixture;
    const checkViewport = () => {
        assert.equal(innerWidth, window.fixture.viewportWidth, "layout viewport keeps the requested CSS width");
        assert.ok(Math.abs(visualViewport.width - window.fixture.viewportWidth) < 1,
            `visual viewport keeps the requested CSS width: ${visualViewport.width}, scale ${visualViewport.scale}`);
    };
    checkViewport();
    for (const type of types) {
        const element = panel(type);
        if (element.classList.contains("fn__none")) continue;
        const title = element.querySelector(".config-bazaar__title");
        const bounds = title.getBoundingClientRect();
        assert.ok(bounds.left >= -1 && bounds.right <= innerWidth + 1, `${type}: title fits the viewport`);
        assert.ok(element.scrollWidth <= element.clientWidth + 1, `${type}: no horizontal panel overflow`);
        const controls = title.querySelectorAll("select, .config-bazaar__filter-row");
        for (const control of controls) {
            const rect = control.getBoundingClientRect();
            assert.ok(rect.width > 0 && rect.height >= 16, `${type}: visible control`);
            assert.ok(rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1, `${type}: control fits title`);
            assert.ok(rect.top >= bounds.top - 1 && rect.bottom <= bounds.bottom + 1, `${type}: control is not clipped`);
            assert.ok(control.scrollWidth <= control.clientWidth + 1, `${type}: control content does not overflow`);
        }
        const rectangles = Array.from(controls, control => control.getBoundingClientRect());
        rectangles.forEach((a, index) => rectangles.slice(index + 1).forEach(b => {
            assert.ok(a.right <= b.left + 1 || b.right <= a.left + 1 || a.bottom <= b.top + 1 || b.bottom <= a.top + 1,
                `${type}: toolbar controls do not overlap`);
            if (Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top) + 1) {
                assert.ok(Math.abs(a.top + a.height / 2 - b.top - b.height / 2) < 1,
                    `${type}: controls on the same toolbar row share a vertical center`);
            }
        }));
        const trigger = button(type);
        const triggerRect = trigger.getBoundingClientRect();
        assert.equal(getComputedStyle(trigger).opacity, "1", "filter remains visible without toolbar hover");
        const search = title.querySelector(".b3-text-field").getBoundingClientRect();
        assert.ok(triggerRect.width >= 24 && triggerRect.height >= 24, "filter retains a shared icon-button hit target");
        if (matchMedia("(pointer: coarse)").matches) {
            assert.ok(triggerRect.width >= 44 && triggerRect.height >= 44, "touch filter retains its larger shared hit target");
            const style = getComputedStyle(trigger);
            assert.equal(style.backgroundClip, "padding-box", "touch highlight is inset inside the hit target");
            assert.ok(Math.abs(triggerRect.height - parseFloat(style.borderTopWidth) -
                parseFloat(style.borderBottomWidth) - search.height) < 1,
            "touch highlight matches the adjacent search field height");
            for (const [x, y] of [
                [triggerRect.left + 2, triggerRect.top + triggerRect.height / 2],
                [triggerRect.right - 2, triggerRect.top + triggerRect.height / 2],
                [triggerRect.left + triggerRect.width / 2, triggerRect.top + 2],
                [triggerRect.left + triggerRect.width / 2, triggerRect.bottom - 2],
            ]) {
                assert.equal(document.elementFromPoint(x, y)?.closest("[data-bazaar-filter-menu]"), trigger,
                    "transparent touch padding belongs to the filter button");
            }
        }
        assert.ok(triggerRect.right <= search.left && Math.abs(triggerRect.top + triggerRect.height / 2 -
            search.top - search.height / 2) < 1, "filter sits before the search field and is vertically centered");
        input(type, "hideUnsupportedVersion");
        await window.fixture.waitForMenu();
        checkViewport();
        const menu = window.siyuan.menus.menu.element;
        assert.equal(menu.classList.contains("b3-menu--sheet"), mobile, "mobile uses the shared bottom sheet");
        const menuRect = menu.getBoundingClientRect();
        assert.ok(menuRect.left >= -1 && menuRect.right <= innerWidth + 1,
            `menu fits viewport: ${JSON.stringify({type, mobile, viewport: innerWidth, left: menuRect.left,
                right: menuRect.right, width: menuRect.width})}`);
        assert.ok(menuRect.top >= -1 && menuRect.bottom <= innerHeight + 1,
            `menu fits viewport height: ${JSON.stringify({type, mobile, viewport: innerHeight,
                top: menuRect.top, bottom: menuRect.bottom, style: menu.getAttribute("style"),
                transform: getComputedStyle(menu).transform, visualHeight: window.visualViewport.height})}`);
        assert.equal(menu.querySelectorAll('[role="menuitemcheckbox"]').length, 2);
        for (const item of menu.querySelectorAll('[role="menuitemcheckbox"]')) {
            assert.ok(item.scrollWidth <= item.clientWidth + 1, "translated menu labels do not overflow");
        }
        window.siyuan.menus.menu.remove();
        assert.equal(menu.classList.contains("config-bazaar__filter-menu"), false,
            "closing removes filter-specific bounds from the shared menu");
    }
    return {width: innerWidth, height: innerHeight};
};

const checkSavingAppearance = async () => {
    const assert = require("node:assert/strict");
    const f = window.fixture;
    f.activate("plugins");
    const trigger = f.button("plugins");
    const filter = "hideUnsupportedVersion";
    const checked = f.checked("plugins", filter);
    f.persistence.paused = true;
    f.input("plugins", filter).click();
    const samples = [];
    for (let i = 0; i < 6; i++) {
        samples.push(Number(getComputedStyle(trigger).opacity));
        await new Promise(resolve => setTimeout(resolve, 75));
    }
    assert.ok(samples.every(opacity => opacity === 1), `pending trigger opacity: ${samples}`);
    assert.equal(trigger.disabled, false);
    assert.equal(trigger.getAttribute("aria-disabled"), "true");
    assert.equal(trigger.getAttribute("aria-busy"), "true");
    assert.equal(f.checked("plugins", filter), checked, "pending configuration is not applied optimistically");
    f.persistence.saves.at(-1).finish();
    await f.settle();
    assert.equal(f.checked("plugins", filter), !checked);
    assert.equal(trigger.hasAttribute("aria-disabled"), false);
    assert.equal(trigger.hasAttribute("aria-busy"), false);
    for (let i = 0; i < 6; i++) {
        samples.push(Number(getComputedStyle(trigger).opacity));
        await new Promise(resolve => setTimeout(resolve, 75));
    }
    assert.ok(samples.every(opacity => opacity === 1), `settled trigger opacity: ${samples}`);
    f.persistence.paused = false;
    f.input("plugins", filter).click();
    await f.settle();
    return {samples: samples.length, min: Math.min(...samples), max: Math.max(...samples)};
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
        const mobileViewport = read("src/mobile/index.ts").match(/setAttribute\("content", "([^"]*interactive-widget=resizes-content[^"]*)"\)/)[1];
        for (const mobile of [false, true]) {
            await win.loadURL(`data:text/html,<html><head><meta name='viewport' content='${mobile ? mobileViewport : "width=device-width, initial-scale=1"}'></head><body></body></html>`);
            await win.webContents.insertCSS(styles[mobile ? "mobile" : "desktop"]);
            const theme = await win.webContents.insertCSS(read("appearance/themes/daylight/theme.css"));
            await evaluate(setupFixture, {sources, languages: languages.en, mobile});
            console.log("Interaction coverage", await evaluate(runInteractionCases));
            console.log("Persistence coverage", await evaluate(runPersistenceCases));
            win.webContents.debugger.attach("1.3");
            await win.webContents.debugger.sendCommand("Emulation.setTouchEmulationEnabled", {enabled: mobile});
            await win.webContents.debugger.sendCommand("Emulation.setFocusEmulationEnabled", {enabled: true});
            await evaluate(() => {
                const assert = require("node:assert/strict");
                const f = window.fixture;
                f.activate("plugins");
                f.response("plugins", f.packages);
                window.siyuan.menus.menu.remove();
                for (let i = 0; i < 2; i++) {
                    f.button("plugins").dispatchEvent(new MouseEvent("click", {bubbles: true, detail: 1}));
                    assert.equal(window.siyuan.menus.menu.element.querySelector(".b3-menu__item--current"), null,
                        "pointer opening does not preselect the first filter");
                    assert.notEqual(document.activeElement, window.siyuan.menus.menu.element.querySelector(".b3-menu__item"));
                    window.siyuan.menus.menu.remove();
                }
            });
            if (mobile) {
                const position = await evaluate(() => {
                    const rect = window.fixture.button("plugins").getBoundingClientRect();
                    return {x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2)};
                });
                await win.webContents.debugger.sendCommand("Input.dispatchTouchEvent", {
                    type: "touchStart", touchPoints: [{...position, radiusX: 1, radiusY: 1}],
                });
                await evaluate(() => {
                    const assert = require("node:assert/strict");
                    const button = window.fixture.button("plugins");
                    for (const target of [button, button.querySelector("svg"), button.querySelector("use")]) {
                        assert.equal(getComputedStyle(target).webkitTapHighlightColor, "rgba(0, 0, 0, 0)",
                            "touch press does not paint a native highlight over the hit area");
                    }
                    assert.equal(getComputedStyle(button).backgroundColor, "rgba(0, 0, 0, 0)");
                });
                await win.webContents.debugger.sendCommand("Input.dispatchTouchEvent", {type: "touchEnd", touchPoints: []});
                await new Promise(resolve => setTimeout(resolve, 400));
                await evaluate(async () => {
                    const assert = require("node:assert/strict");
                    await window.fixture.waitForMenu();
                    assert.equal(window.fixture.button("plugins").getAttribute("aria-expanded"), "true");
                    assert.equal(window.siyuan.menus.menu.element.querySelector(".b3-menu__item--current"), null);
                    assert.equal(matchMedia("(hover: none)").matches, true);
                    assert.equal(getComputedStyle(window.fixture.button("plugins")).backgroundColor, "rgba(0, 0, 0, 0)",
                        "touch opening does not leave a sticky hover background");
                    window.siyuan.menus.menu.remove();
                });
                const hoverProbe = await win.webContents.insertCSS("[data-bazaar-filter-menu]:hover { --fixture-hover: 1; }");
                await win.webContents.debugger.sendCommand("DOM.enable");
                await win.webContents.debugger.sendCommand("CSS.enable");
                const {root} = await win.webContents.debugger.sendCommand("DOM.getDocument");
                const {nodeId} = await win.webContents.debugger.sendCommand("DOM.querySelector", {
                    nodeId: root.nodeId, selector: '[data-type="plugin"] [data-bazaar-filter-menu]',
                });
                await win.webContents.debugger.sendCommand("CSS.forcePseudoState", {nodeId, forcedPseudoClasses: ["hover"]});
                await new Promise(resolve => setTimeout(resolve, 400));
                await evaluate(() => {
                    const assert = require("node:assert/strict");
                    const button = window.fixture.button("plugins");
                    assert.equal(matchMedia("(hover: none)").matches, true);
                    assert.equal(getComputedStyle(button).getPropertyValue("--fixture-hover").trim(), "1",
                        "forced hover styling is active on a touch device");
                    assert.equal(getComputedStyle(button).backgroundColor, "rgba(0, 0, 0, 0)");
                });
                await win.webContents.debugger.sendCommand("CSS.forcePseudoState", {nodeId, forcedPseudoClasses: []});
                await win.webContents.removeInsertedCSS(hoverProbe);
            }
            if (!mobile) {
                for (const [keyCode, filter] of [["Down", "hideUnsupportedVersion"], ["Up", "hideIncompatiblePlatform"]]) {
                    const position = await evaluate(() => {
                        window.siyuan.menus.menu.remove();
                        const rect = window.fixture.button("plugins").getBoundingClientRect();
                        return {x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2)};
                    });
                    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
                        await win.webContents.debugger.sendCommand("Input.dispatchMouseEvent", {
                            type, ...position, button: "left", clickCount: 1,
                        });
                    }
                    await evaluate(() => {
                        const assert = require("node:assert/strict");
                        assert.equal(document.activeElement, window.fixture.button("plugins"));
                        assert.equal(window.siyuan.menus.menu.element.querySelector(".b3-menu__item--current"), null);
                    });
                    win.webContents.sendInputEvent({type: "keyDown", keyCode});
                    win.webContents.sendInputEvent({type: "keyUp", keyCode});
                    await new Promise(resolve => setTimeout(resolve, 50));
                    await evaluate(filter => {
                        require("node:assert/strict").equal(document.activeElement, window.fixture.input("plugins", filter));
                        window.siyuan.menus.menu.remove();
                    }, filter);
                }
            }
            // 通过 Chromium 的输入通道验证菜单导航、原生激活与退出焦点。
            await evaluate(() => {
                window.fixture.activate("plugins");
                window.fixture.response("plugins", window.fixture.packages);
                window.fixture.button("plugins").focus();
                require("node:assert/strict").equal(document.hasFocus(), true);
            });
            win.webContents.sendInputEvent({type: "keyDown", keyCode: "Space"});
            win.webContents.sendInputEvent({type: "keyUp", keyCode: "Space"});
            await new Promise(resolve => setTimeout(resolve, 100));
            await evaluate(() => {
                const assert = require("node:assert/strict");
                assert.equal(window.fixture.button("plugins").getAttribute("aria-expanded"), "true");
                window.fixture.input("plugins", "hideUnsupportedVersion").focus();
            });
            win.webContents.sendInputEvent({type: "keyDown", keyCode: "Down"});
            win.webContents.sendInputEvent({type: "keyUp", keyCode: "Down"});
            await new Promise(resolve => setTimeout(resolve, 50));
            await evaluate(() => {
                require("node:assert/strict").equal(document.activeElement,
                    window.fixture.input("plugins", "hideIncompatiblePlatform"), "ArrowDown focuses the second menu item");
            });
            win.webContents.sendInputEvent({type: "keyDown", keyCode: "Space"});
            win.webContents.sendInputEvent({type: "keyUp", keyCode: "Space"});
            await new Promise(resolve => setTimeout(resolve, 50));
            const pendingSaves = await evaluate(async () => {
                const assert = require("node:assert/strict");
                await window.fixture.settle();
                assert.equal(window.fixture.checked("plugins", "hideIncompatiblePlatform"), true);
                assert.equal(window.fixture.checked("plugins", "hideUnsupportedVersion"), false,
                    "Space activates the arrow-selected item, not the initially focused one");
                window.fixture.persistence.paused = true;
                window.fixture.input("plugins", "hideUnsupportedVersion").focus();
                return window.fixture.persistence.saves.length;
            });
            win.webContents.sendInputEvent({type: "keyDown", keyCode: "Return"});
            win.webContents.sendInputEvent({type: "char", keyCode: "\r"});
            win.webContents.sendInputEvent({type: "keyUp", keyCode: "Return"});
            await new Promise(resolve => setTimeout(resolve, 50));
            const pendingPoint = await evaluate(() => {
                const assert = require("node:assert/strict");
                const trigger = window.fixture.button("plugins");
                assert.equal(document.activeElement, trigger, "native activation restores focus before saving finishes");
                assert.equal(trigger.disabled, false);
                assert.equal(trigger.getAttribute("aria-disabled"), "true");
                assert.equal(trigger.getAttribute("aria-busy"), "true");
                const rect = trigger.getBoundingClientRect();
                return {x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2)};
            });
            win.webContents.sendInputEvent({type: "keyDown", keyCode: "Space"});
            win.webContents.sendInputEvent({type: "keyUp", keyCode: "Space"});
            win.webContents.sendInputEvent({type: "keyDown", keyCode: "Return"});
            win.webContents.sendInputEvent({type: "char", keyCode: "\r"});
            win.webContents.sendInputEvent({type: "keyUp", keyCode: "Return"});
            await win.webContents.debugger.sendCommand("Input.dispatchMouseEvent", {
                type: "mousePressed", button: "left", clickCount: 1, ...pendingPoint,
            });
            await win.webContents.debugger.sendCommand("Input.dispatchMouseEvent", {
                type: "mouseReleased", button: "left", clickCount: 1, ...pendingPoint,
            });
            await new Promise(resolve => setTimeout(resolve, 50));
            await evaluate(pendingSaves => {
                const assert = require("node:assert/strict");
                assert.equal(window.fixture.persistence.saves.length, pendingSaves + 1,
                    "native Space, Enter and pointer clicks cannot repeat a pending save");
                assert.equal(window.fixture.button("plugins").getAttribute("aria-expanded"), "false");
                assert.equal(window.siyuan.menus.menu.element.classList.contains("fn__none"), true);
            }, pendingSaves);
            win.webContents.sendInputEvent({type: "keyDown", keyCode: "Tab"});
            win.webContents.sendInputEvent({type: "keyUp", keyCode: "Tab"});
            await new Promise(resolve => setTimeout(resolve, 50));
            await evaluate(async () => {
                const assert = require("node:assert/strict");
                const search = window.fixture.panel("plugins").querySelector(".b3-text-field");
                assert.equal(document.activeElement, search, "Tab can leave the pending trigger");
                window.fixture.persistence.saves.at(-1).finish();
                await window.fixture.settle();
                window.fixture.persistence.paused = false;
                assert.equal(window.fixture.checked("plugins", "hideUnsupportedVersion"), true);
                assert.equal(document.activeElement, search, "completion does not reclaim focus after Tab");
                assert.deepEqual(window.fixture.names("plugins"), ["old", "new", "same-time", "unknown"]);
                window.fixture.input("plugins", "hideUnsupportedVersion").focus();
            });
            win.webContents.sendInputEvent({type: "keyDown", keyCode: "Tab"});
            win.webContents.sendInputEvent({type: "keyUp", keyCode: "Tab"});
            await new Promise(resolve => setTimeout(resolve, 50));
            await evaluate(() => {
                const assert = require("node:assert/strict");
                assert.equal(window.fixture.button("plugins").getAttribute("aria-expanded"), "false");
                assert.equal(document.activeElement, window.fixture.panel("plugins").querySelector(".b3-text-field"));
                window.fixture.input("plugins", "hideUnsupportedVersion").focus();
            });
            win.webContents.sendInputEvent({type: "keyDown", keyCode: "Escape"});
            win.webContents.sendInputEvent({type: "keyUp", keyCode: "Escape"});
            await new Promise(resolve => setTimeout(resolve, 50));
            await evaluate(() => {
                const assert = require("node:assert/strict");
                assert.equal(window.fixture.button("plugins").getAttribute("aria-expanded"), "false");
                assert.equal(document.activeElement, window.fixture.button("plugins"));
            });
            const point = await evaluate(() => {
                const rect = window.fixture.button("plugins").getBoundingClientRect();
                return {x: Math.round(rect.left + (matchMedia("(pointer: coarse)").matches ? 2 : rect.width / 2)),
                    y: Math.round(rect.top + rect.height / 2)};
            });
            await win.webContents.debugger.sendCommand("Input.dispatchMouseEvent", {
                type: "mousePressed", button: "left", clickCount: 1, ...point,
            });
            await win.webContents.debugger.sendCommand("Input.dispatchMouseEvent", {
                type: "mouseReleased", button: "left", clickCount: 1, ...point,
            });
            await new Promise(resolve => setTimeout(resolve, 100));
            await evaluate(() => require("node:assert/strict").equal(
                window.fixture.button("plugins").getAttribute("aria-expanded"), "true", "pointer opens filter menu"));
            win.webContents.sendInputEvent({type: "keyDown", keyCode: "Down"});
            win.webContents.sendInputEvent({type: "keyUp", keyCode: "Down"});
            win.webContents.sendInputEvent({type: "keyDown", keyCode: "Down"});
            win.webContents.sendInputEvent({type: "keyUp", keyCode: "Down"});
            await new Promise(resolve => setTimeout(resolve, 50));
            await evaluate(() => require("node:assert/strict").equal(document.activeElement,
                window.fixture.input("plugins", "hideIncompatiblePlatform")));
            win.webContents.sendInputEvent({type: "keyDown", keyCode: "Space"});
            win.webContents.sendInputEvent({type: "keyUp", keyCode: "Space"});
            await new Promise(resolve => setTimeout(resolve, 50));
            await evaluate(async () => {
                await window.fixture.settle();
                require("node:assert/strict").equal(window.fixture.checked("plugins", "hideIncompatiblePlatform"), false,
                    "pointer-opened menus support subsequent arrow navigation and native Space activation");
            });
            await win.webContents.removeInsertedCSS(theme);
            for (const appearance of ["daylight", "midnight"]) {
                const themeID = await win.webContents.insertCSS(read(`appearance/themes/${appearance}/theme.css`));
                for (const [width, font, language, coarse = mobile] of mobile ?
                    [[320, 14, "en"], [320, 16, "zh-CN"], [320, 24, "de"], [768, 24, "zh-CN"]] :
                    [[1100, 14, "en"], [600, 24, "de"], [400, 24, "zh-CN"],
                        [1100, 14, "en", true], [640, 14, "zh-CN", true], [400, 24, "zh-CN", true]]) {
                    await win.webContents.debugger.sendCommand("Emulation.setTouchEmulationEnabled", {enabled: coarse});
                    await win.webContents.debugger.sendCommand("Emulation.setDeviceMetricsOverride", {
                        width, height: 900, deviceScaleFactor: 1, mobile,
                    });
                    await evaluate(async ({font, languages, appearance, width}) => {
                        await new Promise(resolve => requestAnimationFrame(resolve));
                        window.fixture.viewportWidth = width;
                        document.documentElement.style.setProperty("--b3-font-size", `${font}px`);
                        document.body.style.fontSize = `${font}px`;
                        document.documentElement.dataset.themeMode = appearance === "midnight" ? "dark" : "light";
                        window.siyuan.languages = languages;
                        await window.fixture.remount();
                        for (const type of window.fixture.types) window.fixture.response(type, window.fixture.packages);
                    }, {font, languages: languages[language], appearance, width});
                    for (const type of await evaluate(() => window.fixture.types)) {
                        await evaluate(type => window.fixture.activate(type), type);
                        await evaluate(checkLayout);
                        layouts++;
                    }
                    console.log("Stable filter appearance", {mobile, appearance, width, coarse,
                        ...await evaluate(checkSavingAppearance)});
                    if (process.env.SIYUAN_BAZAAR_SCREENSHOTS) {
                        await new Promise(resolve => setTimeout(resolve, 100));
                        mkdirSync(process.env.SIYUAN_BAZAAR_SCREENSHOTS, {recursive: true});
                        const file = `${mobile ? "mobile" : "desktop"}-${appearance}-${width}-${font}-${language}${!mobile && coarse ? "-touch" : ""}.png`;
                        writeFileSync(path.join(process.env.SIYUAN_BAZAAR_SCREENSHOTS, file), (await win.webContents.capturePage()).toPNG());
                        await evaluate(() => window.fixture.input(window.fixture.types.at(-1), "hideUnsupportedVersion"));
                        await evaluate(() => window.fixture.waitForMenu());
                        writeFileSync(path.join(process.env.SIYUAN_BAZAAR_SCREENSHOTS, file.replace(".png", "-menu.png")),
                            (await win.webContents.capturePage()).toPNG());
                        await evaluate(() => window.siyuan.menus.menu.remove());
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
            assert.match(stdout, /Verified marketplace compatibility interactions and 100 production-style layouts/);
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(profile).startsWith("siyuan-bazaar-compatibility-"));
            rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
