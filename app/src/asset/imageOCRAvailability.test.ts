import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {ScriptTarget, transpileModule} from "typescript";

const source = transpileModule(readFileSync("src/asset/imageOCRAvailability.ts", "utf8")
    .replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, ""), {
    compilerOptions: {target: ScriptTarget.ES2020},
}).outputText;
const availability = new Function("isEncryptedBox", source + "\nreturn getImageOCRAvailability;")(
    (id: string) => id === "encrypted",
);

test("OCR recognition requires local unencrypted assets, including scoped notebook sources", () => {
    for (const path of ["assets/image.png", "assets/image.PNG?box=ordinary&style=thumb#preview"]) {
        assert.deepEqual(availability(path, "ordinary"), {text: true, local: true, ai: true});
    }
    for (const path of ["https://example.com/image.png", "file:///image.png", "data:image/png;base64,AA", "", null]) {
        assert.deepEqual(availability(path, "ordinary"), {text: true, local: false, ai: false});
    }
    for (const [path, notebookId] of [
        ["assets/image.png", "encrypted"],
        ["assets/image.png?style=thumb&box=encrypted#preview", "ordinary"],
        ["assets/image.png?box=%65ncrypted", "ordinary"],
    ]) {
        assert.deepEqual(availability(path, notebookId), {text: false, local: false, ai: false});
    }
});

test("AI OCR advertises only native or convertible image formats", () => {
    for (const extension of ["png", "jpg", "jpeg", "gif", "webp", "bmp", "tif", "tiff", "heic", "heif"]) {
        assert.equal(availability(`assets/image.${extension.toUpperCase()}?box=ordinary#preview`, "ordinary").ai, true);
    }
    for (const extension of ["svg", "avif", "ico", "pdf", "png.exe"]) {
        assert.deepEqual(availability(`assets/image.${extension}`, "ordinary"), {text: true, local: true, ai: false});
    }
});

test("shared image menus hide unavailable recognition and its separator while retaining text actions", () => {
    const menuSource = readFileSync("src/menus/protyle.ts", "utf8");
    const idPosition = menuSource.indexOf('id: "ocr",', menuSource.indexOf("export const imgMenu"));
    const start = menuSource.lastIndexOf("new MenuItem(", idPosition) + "new MenuItem(".length;
    const end = menuSource.indexOf("}).element);", start) + 1;
    const getMenu = new Function("window", "ocrAvailability", "canOCR", "canAIOCR",
        `return (${menuSource.slice(start, end)});`);
    const visibleItems = (path: string, notebookId: string, disabled = false, provider = "paddleocr") => {
        const status = availability(path, notebookId);
        const menu = getMenu({siyuan: {languages: {}}}, status,
            status.local && (provider !== "ai" || status.ai && !disabled), status.ai && !disabled);
        return menu.ignore ? [] : menu.submenu.filter((item: {ignore?: boolean}) => !item.ignore)
            .map((item: {id: string}) => item.id);
    };
    assert.deepEqual(visibleItems("https://example.com/image.png", "ordinary"), ["ocrResult", "copyOCRText"]);
    assert.deepEqual(visibleItems("assets/image.png?box=encrypted", "ordinary"), []);
    assert.deepEqual(visibleItems("assets/image.png", "encrypted"), []);
    assert.deepEqual(visibleItems("assets/image.svg", "ordinary"), ["ocrResult", "copyOCRText", "separator_reOCR", "reOCR"]);
    assert.deepEqual(visibleItems("assets/image.heic", "ordinary"), ["ocrResult", "copyOCRText", "separator_reOCR", "reOCR", "reAIOCR"]);
    assert.deepEqual(visibleItems("assets/image.png", "ordinary", true), ["ocrResult", "copyOCRText", "separator_reOCR", "reOCR"]);
    assert.deepEqual(visibleItems("assets/image.svg", "ordinary", false, "ai"), ["ocrResult", "copyOCRText"]);
    assert.deepEqual(visibleItems("assets/image.png", "ordinary", true, "ai"), ["ocrResult", "copyOCRText"]);
});
