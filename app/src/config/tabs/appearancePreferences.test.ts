import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";

const {parse} = require("ifdef-loader/preprocessor");

for (const mobile of [false, true]) {
    test(`confirmed preferences update open outlines, PDF readers and mobile controls in place (mobile=${mobile})`, async () => {
        const appearance = {mode: 0, outlineKeepCurrentExpand: true, pdfTheme: {light: "dark", dark: "light"}};
        const siyuan = {config: {appearance, readonly: false}, isPublish: false};
        const classes = (initial: string[] = []) => {
            const values = new Set(initial);
            return {contains: (key: string) => values.has(key), toggle: (key: string, enabled: boolean) => {
                if (enabled) values.add(key); else values.delete(key);
            }};
        };
        const outlines = [{classList: classes(["block__icon"])}, {classList: classes(["toolbar__icon"])}];
        const light = {classList: classes()};
        const dark = {classList: classes()};
        const pdf = {classList: classes(), querySelector: (selector: string) => selector === "#pdfLight" ? light : dark};
        const calls: string[] = [];
        const patches: unknown[][] = [];
        const exports = {} as typeof import("./appearancePreferences");
        const source = parse(readFileSync("src/config/tabs/appearancePreferences.ts", "utf8"), {MOBILE: mobile}, false, true);
        runInNewContext(transpileModule(source, {compilerOptions: {module: ModuleKind.CommonJS}}).outputText, {
            exports, window: {siyuan}, document: {querySelectorAll: (selector: string) =>
                selector === ".pdf__outer" ? [pdf] : outlines},
            require: () => ({
                applyCompactMode: () => calls.push("compact"), syncMenuMouseScroll: () => calls.push("scroll"),
                syncSidebarSetting: () => calls.push("sidebar"), syncMobileBarsSetting: () => calls.push("bars-controls"),
                updateSidebarButtons: () => calls.push("sidebar-buttons"), showMobileBars: () => calls.push("bars"),
                appearanceConfigApi: {patch: async (...args: unknown[]) => { patches.push(args); }},
            }),
        });
        exports.syncAppearancePreferences();
        assert.equal(outlines[0].classList.contains("block__icon--active"), true);
        assert.equal(outlines[1].classList.contains("toolbar__icon--active"), true);
        assert.equal(pdf.classList.contains("pdf__outer--dark"), true);
        assert.equal(light.classList.contains("toggled"), false);
        assert.equal(dark.classList.contains("toggled"), true);
        assert.equal(calls.includes("sidebar"), mobile);
        assert.equal(calls.includes("bars"), mobile);
        appearance.mode = 1;
        appearance.outlineKeepCurrentExpand = false;
        exports.syncAppearancePreferences();
        assert.equal(outlines[0].classList.contains("block__icon--active"), false);
        assert.equal(outlines[1].classList.contains("toolbar__icon--active"), false);
        assert.equal(pdf.classList.contains("pdf__outer--dark"), false);
        await exports.patchAppearancePreference("pdfTheme.light", "light");
        siyuan.config.readonly = true;
        await exports.patchAppearancePreference("pdfTheme.dark", "dark");
        siyuan.config.readonly = false;
        siyuan.isPublish = true;
        await exports.patchAppearancePreference("mobileBars.autoHide", false);
        assert.deepEqual(patches, [["pdfTheme.light", "light"]]);
    });
}
