import * as assert from "node:assert/strict";
import {test} from "node:test";
import {ScriptTarget} from "typescript";
import {loadModule} from "../testSupport/loadModule";

test("shared local OCR menu refreshes tooltip state after successful and failed requests", async () => {
    const invalidated: string[] = [];
    let complete: () => void;
    let currentPath = "assets/image.png";
    const api = loadModule<typeof import("./imageOCRMenu")>("src/menus/imageOCRMenu.ts", {
        window: {siyuan: {config: {ocr: {provider: "paddleocr"}}}}, require: () => ({
        getImageOCRAvailability: () => ({text: true, local: true, ai: true}),
        isDisabledFeature: () => false,
        createDeclaredMenu: (_declaration: unknown, context: unknown) => context,
        fetchPost: (url: string, body: {path: string}) => {
            assert.equal(url, "/api/asset/ocr");
            assert.equal(body.path, currentPath);
            return new Promise<void>(resolve => { complete = resolve; });
        },
        invalidateImageOCRStatus: (path: string) => invalidated.push(path),
    })}, ScriptTarget.ES2021);
    const context = api.createImageOCRMenu({getAttribute: () => currentPath} as unknown as HTMLElement, "notebook") as unknown as {
        runLocal: () => void;
    };
    context.runLocal();
    complete();
    await Promise.resolve();
    assert.deepEqual(invalidated, ["assets/image.png"]);
    currentPath = "assets/another.png";
    context.runLocal();
    currentPath = "assets/replaced.png";
    complete();
    await Promise.resolve();
    assert.deepEqual(invalidated, ["assets/image.png", "assets/another.png"]);
});

test("shared image menu clears the current resource with its notebook identity", () => {
    let currentPath = "assets/image.png?box=first#preview";
    const cleared: string[] = [];
    const api = loadModule<typeof import("./imageOCRMenu")>("src/menus/imageOCRMenu.ts", {
        window: {siyuan: {config: {ocr: {provider: "ai"}}}}, require: () => ({
        getImageOCRAvailability: () => ({text: true, local: true, ai: true}),
        isDisabledFeature: () => false,
        createDeclaredMenu: (_declaration: unknown, context: unknown) => context,
        clearImageOCRText: async (path: string) => { cleared.push(path); },
    })}, ScriptTarget.ES2021);
    const context = api.createImageOCRMenu({getAttribute: () => currentPath} as unknown as HTMLElement, "notebook") as unknown as {
        clearText: () => void;
    };
    currentPath = "assets/image.png?box=second#preview";
    context.clearText();
    assert.deepEqual(cleared, [currentPath]);
});
