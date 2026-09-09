import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {runInNewContext} from "node:vm";
import * as ts from "typescript";

// 执行粘贴入口，替换剪贴板和上传接口，检查图片不会在受限片段中被丢弃。
const source = ts.transpileModule(readFileSync(join(process.cwd(), "src/protyle/util/paste.ts"), "utf8"), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
}).outputText;

const createHarness = (disabled = false) => {
    const uploads: Array<{files: unknown; options: {document: {rootID: string}; insertPosition: unknown}}> = [];
    const position = {range: {startContainer: {}}};
    let available = true;
    let localFiles: unknown[] = [];
    const restrictedFallback = new Error("restricted fallback");
    const mocks: Record<string, unknown> = {
        "../../constants": {Constants: {SIYUAN_ASSETS_IMAGE: [".png", ".jpg"]}},
        "../runtimeCapabilities": {
            getProtyleBlockDOMSanitizer: () => (html: string) => html,
            isProtyleUploadDisabled: () => disabled,
            areProtylePluginExtensionsEnabled: () => false,
            getProtyleUnsupportedPasteBlocks: () => { throw restrictedFallback; },
        },
        "../upload/insertPosition": {
            createUploadInsertPosition: () => position,
            captureUploadDocument: () => ({rootID: "document", notebookID: "notebook"}),
            isUploadInsertPositionAvailable: () => available,
        },
        "./selection": {getEditorRange: () => position.range},
        "./hasClosest": {hasClosestBlock: (): undefined => undefined},
        "./wpsPresentation": {extractWPSPresentationClipboard: (): undefined => undefined},
        "./compatibility": {getLocalFiles: async () => localFiles},
        "../upload": {
            uploadFiles: (_protyle: unknown, files: unknown, _element: unknown, _success: unknown,
                          _complete: unknown, options: typeof uploads[number]["options"]) => uploads.push({files, options}),
            uploadLocalFiles: (files: unknown, _protyle: unknown, _upload: boolean,
                               options: typeof uploads[number]["options"]) => uploads.push({files, options}),
        },
    };
    const module = {exports: {}};
    runInNewContext(source, {module, exports: module.exports, require: (id: string) => mocks[id] || {}});
    const api = module.exports as typeof import("./paste");
    const paste = (files: unknown[] = [], siyuanHTML = "") => api.paste({wysiwyg: {element: {}}} as IProtyle, {
        target: {}, stopPropagation() {}, preventDefault() {},
        clipboardData: {files, types: [], getData: (type: string) => type === "text/siyuan" ? siyuanHTML : ""},
    } as unknown as ClipboardEvent & {target: HTMLElement});
    return {paste, uploads, position, restrictedFallback,
        setLocalFiles: (files: unknown[]) => { localFiles = files; },
        invalidate: () => { available = false; }};
};

describe("restricted cell image paste", () => {
    it("uploads screenshot clipboard files with the captured document and cursor", async () => {
        const harness = createHarness();
        const files = [{name: "image.png", type: "image/png"}];
        await harness.paste(files);
        assert.equal(harness.uploads.length, 1);
        assert.equal(harness.uploads[0].files, files);
        assert.equal(harness.uploads[0].options.document.rootID, "document");
        assert.equal(harness.uploads[0].options.insertPosition, harness.position);
    });

    it("uploads image files copied from the desktop clipboard", async () => {
        const harness = createHarness();
        const files = [{path: "C:/images/photo.JPG", size: 10}];
        harness.setLocalFiles(files);
        await harness.paste();
        assert.equal(harness.uploads.length, 1);
        assert.equal(harness.uploads[0].files, files);
    });

    it("does not upload after the paste target disappears", async () => {
        const harness = createHarness();
        harness.setLocalFiles([{path: "C:/image.png"}]);
        harness.invalidate();
        await harness.paste();
        assert.equal(harness.uploads.length, 0);
    });

    for (const [name, disabled, files, siyuanHTML] of [
        ["disabled uploads", true, [{name: "image.png"}], ""],
        ["unsupported files", false, [{name: "movie.mp4"}], ""],
        ["internal block content", false, [{name: "image.png"}], "internal"],
    ] as const) {
        it(`preserves restricted handling for ${name}`, async () => {
            const harness = createHarness(disabled);
            await assert.rejects(harness.paste([...files], siyuanHTML), harness.restrictedFallback);
            assert.equal(harness.uploads.length, 0);
        });
    }
});
