const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {test} = require("node:test");
const vm = require("node:vm");

const appDir = path.join(__dirname, "..");
const source = fs.readFileSync(path.join(__dirname, "main.js"), "utf8");
const startup = source.slice(source.indexOf("const setStartupApplicationMenu ="), source.indexOf("const applyMacAppMenuForWindow ="));
const languageResolver = source.slice(source.indexOf("const resolveAppLanguage ="), source.indexOf("const loadAppleSiliconWarningLanguages ="));

test("startup editing menu uses requested or system language and preserves native roles", () => {
    for (const [requested, system, expected] of [["zh-CN", "en", "zh-CN"], ["", "zh-Hant", "zh-TW"], ["", "en-US", "en"]]) {
        let menu;
        const context = vm.createContext({
            fs, path, appDir,
            app: {getPreferredSystemLanguages: () => [system]},
            getArg: () => requested,
            writeLog: message => assert.fail(message),
            Menu: {buildFromTemplate: template => template, setApplicationMenu: value => { menu = value; }},
        });
        vm.runInContext(languageResolver + startup + "setStartupApplicationMenu();", context);
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
