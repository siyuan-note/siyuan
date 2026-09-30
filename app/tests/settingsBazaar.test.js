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

for (const mode of ["settings-window", "main-window", "mobile"]) {
    test(`installed package cards use plugin ownership for setting buttons (${mode})`, () => {
        const packages = ["none", "configured", "custom"].map(name => ({name, preferredName: name, preferredDesc: ""}));
        const classList = {contains: () => false, add() {}, remove() {}};
        const activeButton = {classList, getAttribute: () => "myPlugins"};
        const content = {innerHTML: "", getAttribute() {}, setAttribute() {}, removeAttribute() {},
            previousElementSibling: {querySelector: selector => selector === ".b3-text-field" ? null :
                selector === ".counter" ? {classList} : activeButton}};
        const settingNames = [];
        const exports = {};
        runInNewContext(compiled, {exports,
            BAZAAR_PACKAGE_CONFIG: {plugins: {myType: "myPlugins", api: {installed: "/installed"}},
                themes: {myType: "myPlugins", api: {installed: "/installed"}}},
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
            escapeHtml: value => value, escapeAttr: value => value, genRatePackageActionHTML: () => "",
            loadDownloadedRatings() {}, loadDownloadedUserRatings() {},
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
            _genPackageIconHTML: () => "", _genUpdateButtonHTML: () => "", _genIncompatibleChipHTML: () => "",
            _genDeprecatedChipHTML: () => "", _genFundingHTML: () => "", _genOpenStorageHTML: () => "",
            _loadDownloadedDeprecations() {},
        });
        bazaar._genMyHTML("plugins", {plugins: packages});
        const cards = content.innerHTML.split('<div data-name="').slice(1);
        assert.equal(cards.length, 3);
        assert.deepEqual(cards.map(card => card.includes('data-type="setting"')), [false, true, true]);
        assert.deepEqual(settingNames, mode === "settings-window" ? ["none", "configured", "custom"] : []);
        settingNames.length = 0;
        bazaar._genMyHTML("themes", {plugins: packages});
        assert.ok(!content.innerHTML.includes('data-type="setting"'));
        assert.deepEqual(settingNames, []);
    });
}
