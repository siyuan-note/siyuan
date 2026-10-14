import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

test("shared local OCR menu refreshes tooltip state after successful and failed requests", async () => {
    const api = {} as typeof import("./imageOCRMenu");
    const invalidated: string[] = [];
    let complete: () => void;
    let currentPath = "assets/image.png";
    runInNewContext(transpileModule(readFileSync("src/menus/imageOCRMenu.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText, {exports: api, window: {siyuan: {config: {ocr: {provider: "paddleocr"}}}}, require: () => ({
        getImageOCRAvailability: () => ({text: true, local: true, ai: true}),
        isDisabledFeature: () => false,
        createDeclaredMenu: (_declaration: unknown, context: unknown) => context,
        fetchPost: (url: string, body: {path: string}) => {
            assert.equal(url, "/api/asset/ocr");
            assert.equal(body.path, currentPath);
            return new Promise<void>(resolve => { complete = resolve; });
        },
        invalidateImageOCRStatus: (path: string) => invalidated.push(path),
    })});
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
    const api = {} as typeof import("./imageOCRMenu");
    let currentPath = "assets/image.png?box=first#preview";
    const cleared: string[] = [];
    runInNewContext(transpileModule(readFileSync("src/menus/imageOCRMenu.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText, {exports: api, window: {siyuan: {config: {ocr: {provider: "ai"}}}}, require: () => ({
        getImageOCRAvailability: () => ({text: true, local: true, ai: true}),
        isDisabledFeature: () => false,
        createDeclaredMenu: (_declaration: unknown, context: unknown) => context,
        clearImageOCRText: async (path: string) => { cleared.push(path); },
    })});
    const context = api.createImageOCRMenu({getAttribute: () => currentPath} as unknown as HTMLElement, "notebook") as unknown as {
        clearText: () => void;
    };
    currentPath = "assets/image.png?box=second#preview";
    context.clearText();
    assert.deepEqual(cleared, [currentPath]);
});
