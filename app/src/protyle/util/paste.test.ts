import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {runInNewContext} from "node:vm";
import * as ts from "typescript";
import {getAVRichTextSafeURL} from "../render/av/richTextValue";

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
        "./compatibility": {getLocalFiles: async () => localFiles, isInHarmony: () => false},
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
    return {paste, uploads, position, restrictedFallback, api: module.exports as typeof import("./paste"),
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

describe("strip pasted IAL data attributes", () => {
    const harness = createHarness();

    it("removes data-* and on* keys from pasted block IAL", () => {
        assert.equal(harness.api.stripPastedIALDataAttributes(
            'x\n{: id="20240101000000-abc123" data-subtype="x&quot; autofocus" onmouseover="alert(1)" custom-foo="bar"}'),
            'x\n{: id="20240101000000-abc123" custom-foo="bar"}');
    });

    it("keeps data-assets for legacy asset references", () => {
        assert.equal(harness.api.stripPastedIALDataAttributes(
            'x\n{: data-assets="assets/a.png"}'),
            'x\n{: data-assets="assets/a.png"}');
    });

    it("leaves ordinary markdown and non-IAL lines untouched", () => {
        const markdown = "paragraph\n\n{: not an ial line\n\n# heading\n{: id=\"20240101000000-abc123\"}";
        assert.equal(harness.api.stripPastedIALDataAttributes(markdown), markdown);
    });
});

describe("restricted cell selected text paste", () => {
    const runPaste = async (text: string, options: {selected?: string, code?: boolean, inlineCode?: boolean,
        unsupported?: boolean} = {}) => {
        const selected = options.selected ?? "Selected & text";
        const marks: Array<{type: string, value: ITextOption}> = [];
        const inserted: string[] = [];
        const messages: string[] = [];
        const range = {startContainer: {parentElement: {tagName: "DIV"}}, toString: () => selected,
            selectNodeContents: () => {}};
        const block = {classList: {contains: () => false},
            getAttribute: () => options.code ? "NodeCodeBlock" : "NodeParagraph"};
        const mocks: Record<string, unknown> = {
            "../../constants": {Constants: {ZWSP: "\u200b"}},
            "../runtimeCapabilities": {
                getProtyleBlockDOMSanitizer: () => (html: string) => html,
                getProtyleUnsupportedPasteBlocks: () => () => options.unsupported ? ["Table"] : [],
                getProtyleRestrictedPlainTextHTML: (text: string) => "plain:" + text,
                isProtyleUploadDisabled: () => true,
                areProtylePluginExtensionsEnabled: () => false,
            },
            "../upload/insertPosition": {
                createUploadInsertPosition: () => ({range}),
                captureUploadDocument: () => ({}),
                getAvailableUploadInsertRange: () => range,
                isUploadInsertPositionAvailable: () => true,
            },
            "./selection": {getEditorRange: () => range},
            "./hasClosest": {hasClosestBlock: () => block},
            "./compatibility": {isInHarmony: () => false},
            "./officeMath": {extractOfficeMathHTML: () => ""},
            "../upload/htmlLocalAssets": {resolveHTMLAssetURLs: () => {}, getHTMLAssetSourceURL: () => ""},
            "./pasteSource": {extractCrossBlockPasteContext: (html: string) => ({html})},
            "../ui/hideElements": {hideElements: () => {}},
            "./inlineElementMarker": {stripSemanticMarkersFromRangeText: () => selected},
            "../../editor/pdfAssetLink": {getPdfAnnotationReference: (): undefined => undefined},
            "../../util/functions": {isDynamicRef: (value: string) => /^\(\(\d{14}-\w{7} '.*'\)\)$/.test(value)},
            "../toolbar/util": {resolveLinkDest: (value: string) => /^(https?:|file:|assets\/)/.test(value) ? value : ""},
            "../render/av/richTextValue": {getAVRichTextSafeURL},
            "./normalizeText": {removeZWJ: (value: string) => value},
            "./insertHTML": {insertHTML: (value: string) => inserted.push(value)},
            "../../dialog/message": {showMessage: (value: string) => messages.push(value)},
            "../../util/escape": {escapeHtml: (value: string) => value},
        };
        const module = {exports: {}};
        runInNewContext(source, {module, exports: module.exports, require: (id: string) => mocks[id] || {},
            DOMParser: class {parseFromString() {return {querySelector: (): null => null, body: {innerHTML: ""}};}},
            Lute: {Sanitize: (value: string) => value},
            window: {siyuan: {languages: {cellPasteUnsupported: "Unsupported: ${x}"}}},
        });
        const protyle = {
            lite: true,
            lute: {Md2BlockDOM: (value: string) => value},
            hint: {enableExtend: false},
            wysiwyg: {element: {querySelectorAll: (): Element[] => []}},
            toolbar: {range, getCurrentType: () => options.inlineCode ? ["code"] : [],
                setInlineMark: (_protyle: unknown, type: string, _action: string, value: ITextOption) => {
                    marks.push({type, value});
                    return [{}];
                }},
        } as unknown as IProtyle;
        await (module.exports as typeof import("./paste")).paste(protyle, {
            textPlain: text, textHTML: "", siyuanHTML: "", target: block as unknown as HTMLElement,
        });
        return {marks, inserted, messages};
    };

    it("applies a static reference with the selected anchor text", async () => {
        const result = await runPaste("((20260921000000-abcdefg 'Document title'))");
        assert.equal(result.marks.length, 1);
        assert.equal(result.marks[0].type, "block-ref");
        assert.equal(result.marks[0].value.color, "20260921000000-abcdefg\u200bs\u200bSelected & text");
        assert.deepEqual(result.inserted, []);
    });

    for (const url of ["https://example.com", "assets/document.pdf"]) {
        it(`attaches ${url} without replacing the selected text`, async () => {
            const result = await runPaste(url);
            assert.equal(result.marks[0].type, "a");
            assert.equal(result.marks[0].value.color, url);
            assert.deepEqual(result.inserted, []);
        });
    }

    for (const [text, options] of [
        ["ordinary text", {}],
        ["https://example.com", {selected: ""}],
        ["https://example.com", {code: true}],
        ["https://example.com", {inlineCode: true}],
        ["file:///private/document", {}],
    ] as const) {
        it(`retains plain text fallback for ${text} ${JSON.stringify(options)}`, async () => {
            const result = await runPaste(text, options);
            assert.deepEqual(result.marks, []);
            assert.deepEqual(result.inserted, ["plain:" + text]);
        });
    }

    it("rejects unsupported content before changing the selection", async () => {
        const result = await runPaste("https://example.com", {unsupported: true});
        assert.deepEqual(result.marks, []);
        assert.deepEqual(result.inserted, []);
        assert.equal(result.messages.length, 1);
    });
});
