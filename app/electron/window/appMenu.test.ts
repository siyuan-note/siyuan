import {test} from "node:test";
import {applyMacAppMenu, buildMacAppMenuTemplate, buildStartupMenuTemplate, resolveStartupMenuLanguage} from "./appMenu";
import {paths} from "../shared/runtime";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// 测试文件位于 electron/window/，app/ 在其上两级。
const appDir = path.join(__dirname, "..", "..");
paths.appDir = appDir;

const readLanguages = lang => JSON.parse(fs.readFileSync(path.join(appDir, "appearance", "langs", `${lang}.json`), "utf8"));

// 菜单项的 submenu 可能是 Electron 的 Menu 容器；用例构造的都是数组形态，这里统一取出。
type MenuItemNode = {role?: string; label?: string; accelerator?: string; submenu?: unknown};

const itemsOf = (item: {submenu?: unknown}): MenuItemNode[] => {
    const submenu = item.submenu;
    return Array.isArray(submenu) ? submenu as MenuItemNode[] : [];
};

const menuOf = (menu: unknown): MenuItemNode[] => menu as MenuItemNode[];


test("startup editing menu uses requested or system language and preserves native roles", () => {
    for (const [requested, system, expected] of [["zh-CN", "en", "zh-CN"], ["", "zh-Hant", "zh-TW"], ["", "en-US", "en"]]) {
        const language = resolveStartupMenuLanguage({
            argLang: requested, workspaceDir: "", isRemote: false, systemLanguages: [system],
        });
        assert.equal(language, expected);
        const menu = menuOf(buildStartupMenuTemplate(readLanguages(language), {platform: "win32"}));
        for (const group of menu) {
            assert.ok(group.label, group.role);
            for (const item of itemsOf(group).filter(item => item.role)) {
                assert.ok(item.label, item.role);
            }
        }
        const languages = readLanguages(expected);
        const edit = menu.find(item => item.role === "editMenu");
        assert.equal(edit.label, languages.edit);
        for (const role of ["undo", "redo", "cut", "copy", "paste", "selectAll"]) {
            assert.equal(itemsOf(edit).find(item => item.role === role).label, languages[role]);
        }
        assert.equal(itemsOf(edit).find(item => item.role === "pasteAndMatchStyle").label, languages.pasteAsPlainText);
        const windowMenu = menu.find(item => item.role === "windowMenu");
        assert.equal(itemsOf(windowMenu).find(item => item.accelerator === "Ctrl+Shift+I").label, languages.debug);
    }
});

test("startup menu honors saved workspace language and command-line precedence", () => {
    // 元组显式标注，避免混合字面量数组被推断成 string | boolean。
    const cases: [string, boolean, string][] = [["", false, "en"], ["zh-TW", false, "zh-TW"], ["", true, "zh-CN"]];
    for (const [requested, remote, expected] of cases) {
        const language = resolveStartupMenuLanguage({
            argLang: requested,
            workspaceDir: "workspace",
            isRemote: remote,
            systemLanguages: ["zh-CN"],
            readConfig: () => JSON.stringify({appearance: {lang: "en"}, lang: "en"}),
        });
        assert.equal(language, expected);
        const menu = menuOf(buildStartupMenuTemplate(readLanguages(language), {platform: "win32"}));
        assert.equal(menu.find(item => item.role === "editMenu").label, readLanguages(expected).edit);
    }
});

test("macOS menu loads translations from language identifiers without an i18n payload", () => {
    for (const lang of ["zh-CN", "en", "zh-CN"]) {
        const languages = readLanguages(lang);
        const menu = menuOf(buildMacAppMenuTemplate({lang, hotkey: {undo: "custom-undo"}}, languages,
            {platform: "darwin", appName: "SiYuan"}));
        const edit = menu.find(item => item.role === "editMenu");
        assert.equal(edit.label, languages.edit);
        assert.equal(itemsOf(edit).find(item => item.role === "copy").label, languages.copy);
        assert.equal(itemsOf(edit).find(item => item.role === "undo").accelerator, "custom-undo");
    }
});

test("macOS menu application is a no-op outside darwin", () => {
    const platform = Object.getOwnPropertyDescriptor(process, "platform");
    try {
        for (const value of ["win32", "linux"]) {
            Object.defineProperty(process, "platform", {...platform, value});
            assert.equal(applyMacAppMenu(undefined), undefined);
            assert.equal(applyMacAppMenu({lang: "", hotkey: {}}), undefined);
        }
    } finally {
        Object.defineProperty(process, "platform", platform);
    }
});
