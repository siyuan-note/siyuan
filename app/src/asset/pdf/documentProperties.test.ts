import * as assert from "node:assert/strict";
import {readFileSync, readdirSync} from "node:fs";
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

for (const file of readdirSync("appearance/langs").filter(file => file.endsWith(".json"))) {
    test(`PDF properties use bundled paper names and boolean labels (${file})`, async () => {
        const languages = JSON.parse(readFileSync(`appearance/langs/${file}`, "utf8"));
        const load = (name: string, dependencies = {}, globals = {}) => {
            const exports: Record<string, unknown> = {};
            const code = transpileModule(readFileSync(`src/asset/pdf/${name}.js`, "utf8"), {
                compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
            }).outputText;
            runInNewContext(code, {exports, Promise, Date, console, require: () => dependencies, ...globals});
            return exports;
        };
        const {GenericL10n} = load("genericl10n", load("l10n"), {window: {siyuan: {languages}}}) as {
            GenericL10n: new (lang: string) => {get: (id: string) => Promise<string>, getLanguage: () => string},
        };
        const l10n = new GenericL10n(file.replace(".json", ""));
        const {PDFDocumentProperties} = load("pdf_document_properties", {internalOpt: {},
            PDFDateString: {toDateObject: (): null => null}, getPageSizeInches: (page: unknown) => page,
            isPortraitOrientation: (size: {width: number, height: number}) => size.width <= size.height}) as {
            PDFDocumentProperties: new (...args: unknown[]) => {
                setDocument: (value: unknown) => void, open: () => Promise<void>, close: () => Promise<void>,
            },
        };
        for (const paper of [
            {width: 210 / 25.4, height: 297 / 25.4, key: "document_properties_page_size_name_a4"},
            {width: 297 / 25.4, height: 420 / 25.4, key: "document_properties_page_size_name_a3"},
            {width: 8.5, height: 11, key: "document_properties_page_size_name_letter"},
            {width: 8.5, height: 14, key: "document_properties_page_size_name_legal"},
            {width: 5, height: 7, key: ""},
        ]) {
            for (const isLinearized of [false, true]) {
                const field = () => ({textContent: "", removeAttribute() {}, setAttribute() {}});
                const fields = {pageSize: field(), linearized: field()};
                const dialog = {dataset: {}};
                const overlay = {active: null as unknown, register() {},
                    open: async () => { overlay.active = dialog; }, close: async () => { overlay.active = null; }};
                const events: Record<string, (event: {pagesRotation: number}) => void> = {};
                const properties = new PDFDocumentProperties({dialog, fields, closeButton: {addEventListener() {}}},
                    overlay, {on: (id: string, listener: typeof events[string]) => { events[id] = listener; }}, l10n,
                    () => "fixture.pdf", () => "Fixture");
                properties.setDocument({numPages: 1,
                    getMetadata: async () => ({info: {IsLinearized: isLinearized}, contentLength: 1024}),
                    getPage: async () => paper, getDownloadInfo: async () => ({length: 1024})});
                const expected = languages[isLinearized ? "pdfLinearizedYes" : "pdfLinearizedNo"];
                assert.ok(expected);
                await properties.open();
                assert.equal(fields.linearized.textContent, expected);
                assert.ok(!fields.pageSize.textContent.includes("pdfjs-"), fields.pageSize.textContent);
                if (paper.key) assert.ok(fields.pageSize.textContent.includes(languages[paper.key]), fields.pageSize.textContent);
                assert.ok(fields.pageSize.textContent.includes(languages.document_properties_page_size_orientation_portrait));
                await properties.close();
                events.rotationchanging({pagesRotation: 90});
                await properties.open();
                assert.equal(fields.linearized.textContent, expected);
                assert.ok(fields.pageSize.textContent.includes(languages.document_properties_page_size_orientation_landscape));
            }
        }
    });
}
