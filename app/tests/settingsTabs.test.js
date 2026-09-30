const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const {test} = require("node:test");
const {runInNewContext} = require("node:vm");
const {ModuleKind, ScriptTarget, transpileModule} = require("typescript");
const preprocess = require("ifdef-loader/preprocessor").parse;

for (const mobile of [false, true]) {
    test(`settings tabs wait for cyclic dependencies and retain their instances (mobile=${mobile})`, () => {
        const source = preprocess(readFileSync("src/config/setting/tabs.ts", "utf8"), {MOBILE: mobile, BROWSER: false});
        const code = transpileModule(source, {
            compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
        }).outputText;
        let initialized = false;
        let builders = 0;
        const tabs = [];
        const patches = new Map();
        class SettingBuilder {
            constructor() {
                builders++;
            }
            tab(options, register) {
                const tab = {...options, register};
                tabs.push(tab);
                return tab;
            }
            panel(options) {
                tabs.push(options);
                return options;
            }
        }
        const modules = new Map();
        const exports = {};
        const siyuan = {};
        runInNewContext(code, {exports, window: {siyuan}, require: name => {
            if (!modules.has(name)) {
                modules.set(name, new Proxy({}, {get: (_target, key) => {
                    // 模拟模块循环引用：入口执行期间可以导入模块，但不能读取尚未初始化的导出。
                    if (!initialized) throw new ReferenceError(`Cannot access '${String(key)}' before initialization`);
                    if (key === "SettingBuilder") return SettingBuilder;
                    if (key === "getHostCapabilities") return () => ({documentImportExport: true});
                    if (key === "isDisabledFeature") return () => false;
                    if (key === "isBazaarAvailable") return () => true;
                    if (String(key).endsWith("ConfigApi")) {
                        if (!patches.has(key)) patches.set(key, () => {});
                        return {patch: patches.get(key)};
                    }
                    return () => {};
                }}));
            }
            return modules.get(name);
        }});
        assert.equal(builders, 0);
        assert.equal(tabs.length, 0);
        initialized = true;
        siyuan.languages = new Proxy({}, {get: (_target, key) => String(key)});
        const appearance = exports.getSettingTab("appearance");
        assert.equal(appearance.defaultSave, patches.get("appearanceConfigApi"));
        const shells = exports.getSettingTabDefs();
        assert.deepEqual(Array.from(shells, shell => shell.id), [
            "editor", "file", "appearance", "bazaar", "flashcard", "ai", "secretsVariables", "assets",
            "export", "search", ...(mobile ? [] : ["keymap"]), "sync", "access", "app", "about",
        ]);
        assert.equal(exports.getSettingTab("appearance"), appearance);
        assert.equal(exports.getSettingTabDefs(), shells);
        assert.equal(builders, 1);
        assert.equal(tabs.length, shells.length);
        for (const shell of shells) {
            const tab = exports.getSettingTab(shell.id);
            assert.equal(shell.title, tab.title());
            assert.equal(shell.hidden, tab.hidden?.());
        }
    });
}
