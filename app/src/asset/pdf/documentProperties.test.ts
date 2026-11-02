import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

test("PDF document properties resolve localized linearization before rendering and reopening", async () => {
    const code = transpileModule(readFileSync("src/asset/pdf/pdf_document_properties.js", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
    }).outputText;
    const exports: Record<string, new (...args: unknown[]) => {
        setDocument: (value: unknown) => void, open: () => Promise<void>, close: () => Promise<void>,
    }> = {};
    runInNewContext(code, {exports, Promise, Date, console, require: () => ({internalOpt: {},
        PDFDateString: {toDateObject: (): null => null}, getPageSizeInches: () => ({width: 8.5, height: 11}),
        isPortraitOrientation: () => true})});
    const dialog = {dataset: {}};
    const linearized = {textContent: "", removeAttribute() {}, setAttribute() {}};
    const overlay = {active: null as unknown, register() {}, open: async (value: unknown) => { overlay.active = value; },
        close: async () => { overlay.active = null; }};
    const properties = new exports.PDFDocumentProperties({dialog, fields: {linearized}, closeButton: {addEventListener() {}}},
        overlay, {on() {}}, {get: async () => "Localized no", getLanguage: () => "en-us"}, () => "fixture.pdf", () => "Fixture");
    properties.setDocument({numPages: 1, getMetadata: async () => ({info: {IsLinearized: false}, contentLength: 1024}),
        getPage: async () => ({}), getDownloadInfo: async () => ({length: 1024})});
    await properties.open();
    assert.equal(linearized.textContent, "Localized no");
    await properties.close();
    await properties.open();
    assert.equal(linearized.textContent, "Localized no");
});
