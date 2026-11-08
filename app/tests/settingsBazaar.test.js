const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const {test} = require("node:test");
const {runInNewContext} = require("node:vm");
const ts = require("typescript");

const source = ts.createSourceFile("bazaar.ts", readFileSync("src/config/bazaar.ts", "utf8"), ts.ScriptTarget.ES2021, true);
const declaration = source.statements.find(statement => ts.isVariableStatement(statement) &&
    statement.declarationList.declarations.some(item => item.name.getText(source) === "bazaar"));
const object = declaration.declarationList.declarations[0].initializer;
const render = object.properties.find(property => property.name?.getText(source) === "_genMyHTML");
const compiled = ts.transpileModule(`export const bazaar = {${render.getText(source)}};`, {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021},
}).outputText;

test("update cards keep rating before funding and updating as the final action", () => {
    const method = object.properties.find(property => property.name?.getText(source) === "_genUpdateItemHTML");
    const code = ts.transpileModule(`export const bazaar = {${method.getText(source)}};`, {
        compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021},
    }).outputText;
    for (const type of ["plugins", "themes", "icons", "templates", "widgets"]) {
        for (const localFileSystem of [false, true]) {
            const exports = {};
            runInNewContext(code, {exports, escapeAttr: value => value, escapeHtml: value => value,
                getRatingKey: () => "package", isBazaarPackageRatingLoaded: () => true,
                genRatePackageActionHTML: () => '<span data-type="rate-package"></span>',
                isBrowser: () => !localFileSystem, getHostCapabilities: () => ({localFileSystem}),
                window: {siyuan: {languages: {showInFolder: "Show in folder"}}},
            });
            Object.assign(exports.bazaar, {
                _data: {downloadedRatingKeys: new Set(), userRatings: new Map()},
                _genPackageIconHTML: () => "", _genIncompatibleChipHTML: () => "", _genDeprecatedChipHTML: () => "",
                _genFundingHTML: () => '<span data-type="funding"></span>',
                _genOpenStorageHTML: () => '<span data-type="open-storage"></span>',
                _genBatchUpdatePreferenceHTML: () => '<button data-type="skip-batch-update"></button>',
                _genUpdateButtonHTML: () => '<span data-type="install-t"></span>',
            });
            const html = exports.bazaar._genUpdateItemHTML({installed: {name: "package"}, available: {}}, type);
            assert.deepEqual(Array.from(html.matchAll(/data-type="([^"]+)"/g), match => match[1]),
                ["rate-package", "funding", "open", "open-storage", "skip-batch-update", "install-t"]);
        }
    }
});

test("directory actions delegate to the owner and preserve installed-package and storage eligibility", () => {
    const events = ts.createSourceFile("events.ts", readFileSync("src/config/bazaar/events.ts", "utf8"), ts.ScriptTarget.ES2021, true);
    const handlers = events.statements.find(statement => ts.isVariableStatement(statement) &&
        statement.declarationList.declarations.some(item => item.name.getText(events) === "ACTION_HANDLERS"));
    const actions = ts.transpileModule("export " + handlers.getText(events), {
        compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021},
    }).outputText;
    const pathCode = ts.transpileModule(readFileSync("src/config/bazaar/openPath.ts", "utf8"), {
        compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021},
    }).outputText;
    const opened = [];
    const delegated = [];
    let host = {openBazaarPath: (...args) => delegated.push(args)};
    const window = {siyuan: {config: {system: {dataDir: ""}}}};
    const exports = {};
    const path = require("node:path");
    runInNewContext(pathCode, {exports, window, require: name => ({path,
        "../../util/pathName": {useShell: (...args) => opened.push(args)},
        "../setting/windowContext": {getSettingsWindowHost: () => host},
    })[name]});
    const actionExports = {};
    runInNewContext(actions, {exports: actionExports, CONTINUE: {handled: false}, HANDLED: {handled: true},
        HANDLED_NATIVE: {handled: true}, openBazaarPath: exports.openBazaarPath});
    const context = {pkgType: "plugins", installedItem: {name: "installed", hasStorageData: true}, pkgItem: {name: "available"}};
    const {ACTION_HANDLERS} = actionExports;
    assert.equal(ACTION_HANDLERS.open(context).handled, true);
    assert.equal(ACTION_HANDLERS["open-storage"](context).handled, true);
    assert.deepEqual(delegated, [["plugins", "installed", false], ["plugins", "installed", true]]);
    assert.deepEqual(opened, []);
    assert.equal(ACTION_HANDLERS["open-storage"]({...context, pkgType: "themes"}).handled, false);
    assert.equal(ACTION_HANDLERS["open-storage"]({...context, installedItem: {name: "installed"}}).handled, false);
    host = undefined;
    exports.openBazaarPath("plugins", "installed");
    assert.deepEqual(opened, []);
    window.siyuan.config.system.dataDir = "D:/workspace/data";
    ACTION_HANDLERS.open(context);
    ACTION_HANDLERS["open-storage"](context);
    assert.deepEqual(opened, [["openPath", path.join("D:/workspace/data", "plugins", "installed")],
        ["openPath", path.join("D:/workspace/data", "storage", "petal", "installed")]]);
});

for (const mode of ["settings-window", "main-window", "mobile"]) {
    test(`installed cards omit batch exclusion controls and preserve plugin ownership (${mode})`, () => {
        const packages = ["none", "configured", "custom"].map(name => ({name, preferredName: name, preferredDesc: ""}));
        const classList = {contains: () => false, add() {}, remove() {}};
        const activeButton = {classList, getAttribute: () => "myPlugins"};
        const content = {innerHTML: "", getAttribute() {}, setAttribute() {}, removeAttribute() {},
            previousElementSibling: {querySelector: selector => selector === ".b3-text-field" ? null :
                selector === ".counter" ? {classList} : activeButton}};
        const settingNames = [];
        const exports = {};
        runInNewContext(compiled, {exports,
            BAZAAR_PACKAGE_CONFIG: Object.fromEntries(["plugins", "themes", "icons", "templates", "widgets"]
                .map(type => [type, {myType: "myPlugins", api: {installed: "/installed"}}])),
            fetchPost: (_url, _data, callback) => {callback({data: {packages}}); return Promise.resolve();},
            getFrontend: () => "desktop", isMobile: () => mode === "mobile", isBrowser: () => false,
            getHostCapabilities: () => ({localFileSystem: true}),
            getSettingsWindowHost: () => mode === "settings-window" ? {hasPluginSetting: name => {
                settingNames.push(name);
                return name !== "none";
            }} : undefined,
            hasPluginSetting: plugin => {
                assert.notEqual(mode, "settings-window");
                return plugin.name !== "none";
            },
            isBazaarPluginEnabledInPublish: () => false, getRatingKey: (_type, name) => name,
            escapeHtml: value => value, escapeAttr: value => value,
            genRatePackageActionHTML: () => '<span data-type="rate-package"></span>',
            loadDownloadedRatings() {}, loadDownloadedUserRatings() {}, renderBazaarInstall() {},
            window: {siyuan: {config: {publish: {enable: false}, bazaar: {petalDisabled: false}},
                languages: {config: "Settings", uninstall: "Uninstall", disable: "Disable", enable: "Enable"}}},
        });
        const {bazaar} = exports;
        Object.assign(bazaar, {
            element: {querySelector: selector => selector === "#configBazaarDownloaded" ? content : null},
            _data: {downloadedRatingKeys: new Set(), userRatings: new Map()},
            _syncPluginGlobalSwitch() {}, _updateDownloadedToolbar() {}, _updateDownloadedSortSelect() {},
            _getDownloadedSortValue: () => "", _captureMount: () => 0, _isMountCurrent: () => true,
            _applyDownloadedDeprecations() {}, _sortDownloadedPackages: items => items, _getUpdatedItem() {},
            _shouldKeepDownloadedOrder: () => false,
            _genPackageIconHTML: () => "", _genUpdateButtonHTML: () => '<span data-type="install-t"></span>',
            _genIncompatibleChipHTML: () => "", _genDeprecatedChipHTML: () => "",
            _genFundingHTML: () => '<span data-type="funding"></span>',
            _genOpenStorageHTML: () => '<span data-type="open-storage"></span>',
            _loadDownloadedDeprecations() {},
        });
        bazaar._genMyHTML("plugins", {plugins: packages});
        const cards = content.innerHTML.split('<div data-name="').slice(1);
        assert.equal(cards.length, 3);
        assert.deepEqual(cards.map(card => card.includes('data-type="setting"')), [false, true, true]);
        assert.deepEqual(settingNames, mode === "settings-window" ? ["none", "configured", "custom"] : []);
        settingNames.length = 0;
        for (const type of ["plugins", "themes", "icons", "templates", "widgets"]) {
            bazaar._genMyHTML(type, {plugins: packages});
            for (const card of content.innerHTML.split('<div data-name="').slice(1)) {
                const commonActions = ["rate-package", "funding", "open", "open-storage", "install-t"];
                const actions = Array.from(card.matchAll(/data-type="([^"]+)"/g), match => match[1]);
                assert.deepEqual(actions.filter(action => commonActions.includes(action)), commonActions);
                assert.ok(!actions.includes("skip-batch-update"));
                assert.ok(actions.indexOf("install-t") < actions.indexOf("plugin-enable"));
            }
            if (type !== "plugins") assert.ok(!content.innerHTML.includes('data-type="setting"'));
        }
    });
}
