import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {escapeHtml} from "../../util/escape";

const createTooltip = (preferences: Record<string, boolean> = {}) => {
    const config = {ocr: preferences};
    const api = {} as typeof import("./imageTooltip");
    runInNewContext(transpileModule(readFileSync("src/protyle/render/imageTooltip.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText, {exports: api, window: {siyuan: {config,
        languages: {ocrResult: "OCR text", ocrNoText: "No OCR text", ocrFailed: "OCR recognition failed"}}},
    require: () => ({escapeHtml, getImageTitle: () => "", getAssetName: () => "image", getAssetExtension: () => ".png"})});
    const image = {getAttribute: () => "assets/image.png", alt: "", naturalWidth: 100, naturalHeight: 50} as unknown as HTMLImageElement;
    return {get: (text?: string, failed = false) => api.getImageTooltip(image, "1 KiB", text, failed), config};
};

test("OCR tooltip preferences default to text only and distinguish absent text from unread results", () => {
    const tip = createTooltip();
    assert.equal(tip.get(), "image.png<br>PNG · 100 × 50 · 1 KiB");
    assert.equal(tip.get(" \n "), tip.get());
    assert.equal(tip.get(undefined, true), tip.get());
    assert.match(tip.get("<script> & text\nline"), /OCR text:<br>&lt;script> &amp; text<br>line$/);
    tip.config.ocr.showEmpty = true;
    assert.match(tip.get(" \n "), /<br>No OCR text$/);
    assert.doesNotMatch(tip.get(), /No OCR text/);
});

test("all OCR tooltip options work independently of automatic recognition and preserve saved text after failure", () => {
    for (const auto of [false, true]) {
        for (const showText of [false, true]) {
            for (const showEmpty of [false, true]) {
                for (const showError of [false, true]) {
                    const tip = createTooltip({auto, showText, showEmpty, showError});
                    assert.equal(tip.get("saved text").includes("OCR text:<br>saved text"), showText);
                    assert.equal(tip.get("").includes("No OCR text"), showEmpty);
                    assert.equal(tip.get("", true).includes("OCR recognition failed"), showError);
                    assert.equal(tip.get("saved text", true).includes("OCR text:<br>saved text"), showText);
                    assert.equal(tip.get("saved text", true).includes("OCR recognition failed"), showError);
                    assert.doesNotMatch(tip.get("", true), /No OCR text/);
                    assert.doesNotMatch(tip.get(undefined), /No OCR text|OCR recognition failed/);
                }
            }
        }
    }
});

test("OCR tooltip rendering uses the latest preferences and retains preview limits", () => {
    const tip = createTooltip({showText: true, showEmpty: false, showError: false});
    assert.match(tip.get("x".repeat(201)), new RegExp("x{200}\\.\\.\\.$"));
    assert.match(tip.get("1\r\n2\r3\n4\n5\n6\n7"), /1<br>2<br>3<br>4<br>5<br>6\.\.\.$/);
    tip.config.ocr.showText = false;
    assert.doesNotMatch(tip.get("saved text"), /OCR text/);
    tip.config.ocr.showError = true;
    assert.match(tip.get("saved text", true), /OCR recognition failed$/);
});
