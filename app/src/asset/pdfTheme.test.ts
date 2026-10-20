import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";

test("PDF theme changes patch only the selected mode and never mutate a stale captured configuration", () => {
    const captured = {light: "light", dark: "dark", annoColor: "red"};
    const appearance = {mode: 0, pdfTheme: captured};
    const siyuan = {config: {appearance, readonly: false}, isPublish: false};
    const saved: unknown[][] = [];
    const button = () => ({classList: {toggle() {}}, click: () => {},
        addEventListener(_event: string, listener: () => void) { this.click = listener; }});
    const light = button();
    const dark = button();
    const outer = {classList: {toggle() {}}};
    const exports = {} as typeof import("./pdfViewer");
    runInNewContext(transpileModule(readFileSync("src/asset/pdfViewer.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS},
    }).outputText, {exports, window: {siyuan}, require: () => ({
        patchAppearancePreference: (...args: unknown[]) => {saved.push(args);},
    })});
    exports.bindPdfTheme({firstElementChild: outer, querySelector: (selector: string) =>
        selector === "#pdfLight" ? light : dark} as unknown as HTMLElement);
    appearance.pdfTheme = {light: "light", dark: "light", annoColor: "blue"};
    dark.click();
    appearance.mode = 1;
    light.click();
    assert.deepEqual(saved, [["pdfTheme.light", "dark"], ["pdfTheme.dark", "light"]]);
    assert.deepEqual(captured, {light: "light", dark: "dark", annoColor: "red"});
    assert.equal(appearance.pdfTheme.annoColor, "blue");
    siyuan.config.readonly = true;
    dark.click();
    siyuan.config.readonly = false;
    siyuan.isPublish = true;
    light.click();
    assert.equal(saved.length, 2);
});
