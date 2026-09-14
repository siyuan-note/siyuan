const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {test} = require("node:test");
const vm = require("node:vm");

const appDir = path.join(__dirname, "..");
const source = fs.readFileSync(path.join(__dirname, "main.js"), "utf8");
const startup = source.slice(source.indexOf("const setStartupApplicationMenu ="), source.indexOf("const applyMacAppMenuForWindow ="));
const loader = source.slice(source.indexOf("const appMenuLanguages ="), source.indexOf("const applyMacAppMenu ="));
const languageResolver = source.slice(source.indexOf("const resolveAppLanguage ="), source.indexOf("const loadAppleSiliconWarningLanguages ="));

test("startup editing menu uses requested or system language and preserves native roles", () => {
    for (const [requested, system, expected] of [["zh-CN", "en", "zh-CN"], ["", "zh-Hant", "zh-TW"], ["", "en-US", "en"]]) {
        let menu;
        const context = vm.createContext({
            fs, path, appDir,
            app: {getPreferredSystemLanguages: () => [system]},
            getArg: name => name === "--lang" ? requested : "",
            lastWorkspacePath: "", remoteKernelTarget: undefined,
            writeLog: message => assert.fail(message),
            Menu: {buildFromTemplate: template => template, setApplicationMenu: value => { menu = value; }},
        });
        vm.runInContext(languageResolver + loader + startup + "setStartupApplicationMenu();", context);
        for (const group of menu) {
            assert.ok(group.label, group.role);
            for (const item of group.submenu.filter(item => item.role)) {
                assert.ok(item.label, item.role);
            }
        }
        const languages = JSON.parse(fs.readFileSync(path.join(appDir, "appearance", "langs", `${expected}.json`), "utf8"));
        const edit = menu.find(item => item.role === "editMenu");
        assert.equal(edit.label, languages.edit);
        for (const role of ["undo", "redo", "cut", "copy", "paste", "selectAll"]) {
            assert.equal(edit.submenu.find(item => item.role === role).label, languages[role]);
        }
        assert.equal(edit.submenu.find(item => item.role === "pasteAndMatchStyle").label, languages.pasteAsPlainText);
    }
});

test("startup menu honors saved workspace language and command-line precedence", () => {
    for (const [requested, remote, expected] of [["", false, "en"], ["zh-TW", false, "zh-TW"], ["", true, "zh-CN"]]) {
        let menu;
        const context = vm.createContext({
            fs: {readFileSync: (file, encoding) => file === path.join("workspace", "conf", "conf.json")
                ? JSON.stringify({appearance: {lang: "en"}, lang: "en"}) : fs.readFileSync(file, encoding)},
            path, appDir,
            app: {getPreferredSystemLanguages: () => ["zh-CN"]},
            getArg: name => name === "--lang" ? requested : "",
            lastWorkspacePath: "workspace", remoteKernelTarget: remote ? {} : undefined,
            writeLog: message => assert.fail(message),
            Menu: {buildFromTemplate: template => template, setApplicationMenu: value => { menu = value; }},
        });
        vm.runInContext(languageResolver + loader + startup + "setStartupApplicationMenu();", context);
        const languages = JSON.parse(fs.readFileSync(path.join(appDir, "appearance", "langs", `${expected}.json`), "utf8"));
        assert.equal(menu.find(item => item.role === "editMenu").label, languages.edit);
    }
});

test("macOS menu loads translations from language identifiers without an i18n payload", () => {
    let menu;
    const context = vm.createContext({
        fs, path, appDir, process: {platform: "darwin"}, app: {name: "SiYuan"},
        withHotkey: key => ({accelerator: key}),
        writeLog: message => assert.fail(message),
        Menu: {buildFromTemplate: template => template, setApplicationMenu: value => { menu = value; }},
    });
    const apply = source.slice(source.indexOf("const applyMacAppMenu ="), source.indexOf("const setStartupApplicationMenu ="));
    vm.runInContext(languageResolver + loader + apply, context);
    for (const lang of ["zh-CN", "en", "zh-CN"]) {
        vm.runInContext(`applyMacAppMenu({lang: "${lang}", hotkey: {undo: "custom-undo"}});`, context);
        const languages = JSON.parse(fs.readFileSync(path.join(appDir, "appearance", "langs", `${lang}.json`), "utf8"));
        const edit = menu.find(item => item.role === "editMenu");
        assert.equal(edit.label, languages.edit);
        assert.equal(edit.submenu.find(item => item.role === "copy").label, languages.copy);
        assert.equal(edit.submenu.find(item => item.role === "undo").accelerator, "custom-undo");
    }
});
