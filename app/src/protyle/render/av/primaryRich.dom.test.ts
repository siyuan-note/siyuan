import * as assert from "node:assert/strict";
import test from "node:test";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve, dirname} from "node:path";
import {promisify} from "node:util";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const cases = (sources: Record<string, string>) => {
    const check: typeof assert = require("node:assert/strict");
    const modules: Record<string, any> = {};
    const dependencies = {escapeHtml: (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"),
        escapeHtmlTextAndAttr: (value: string) => dependencies.escapeHtml(value), escapeAttr: (value: string) => dependencies.escapeHtml(value),
        sanitizeKernelHTML: (html: string) => html, restoreInlineElementBoundaries() {},
        getAVBlockRefSubtype: (value: IAVCellValue) => value.block?.refSubtype || "d",
        hasAVRenderTemplateResult: (value: IAVCellValue) => Boolean(value.hasRenderTemplate),
        cloneAVCellValueSnapshot: (value: IAVCellValue) => JSON.parse(JSON.stringify(value)), renderAVBlockIcon: () => "",
        getAVTemplateHTML: (html: string) => html, getHostCapabilities: () => ({remoteKernel: false}),
        usesAVRollupCellRenderer: () => false, isAVTextType: () => false, isAVDateType: () => false, isAVTimestampType: () => false};
    const load = (name: string) => {
        const exports = {};
        new Function("exports", "require", sources[name])(exports, (path: string) => modules[path.split("/").at(-1)] || dependencies);
        modules[name] = exports;
        return exports as any;
    };
    (window as any).siyuan = {languages: {empty: "Empty", untitled: "Untitled", openBy: "Open", bind: "Bind", rebind: "Rebind", more: "More", block: "Block", documentTitleInlineOnly: "Inline only"}, config: {editor: {}}};
    load("documentTitleDOM");
    const primary = load("primaryRich");
    const attribute = load("attributeValue");
    Object.assign(dependencies, attribute);
    const cell = load("cell");
    const dom = (html: string) => `<div data-type="NodeParagraph" data-node-id="20000101000000-primary"><div contenteditable="true">${html}</div></div>`;
    const source: IAVCellValue = {type: "block", id: "value", blockID: "row", isDetached: true,
        block: {content: "Summary", rich: {spec: 1, format: "inline-ast", content: "full source"}, richBlockDOM: dom(
            '<span data-type="strong em">Styled</span><span data-type="inline-math" data-subtype="math" data-content="x^2" contenteditable="false"></span><span class="img"><img src="assets/a.png" alt="Image"></span><span data-type="block-ref" data-id="target" data-subtype="d">Ref</span>')}};
    for (const detached of [true, false]) {
        const value = {...source, isDetached: detached, block: {...source.block, id: detached ? "" : "bound"}};
        for (const view of ["table", "gallery", "kanban", "list", "calendar"]) {
            const host = document.createElement("div");
            host.innerHTML = cell.renderCell(value, 0, false, view);
            const preview = host.querySelector<HTMLElement>(".av__celltext");
            check.equal(preview.querySelector('[data-type~="strong"]').textContent, "Styled");
            check.equal(preview.querySelector("img").getAttribute("alt"), "Image");
            check.equal(preview.querySelector('[data-type="inline-math"]').getAttribute("data-content"), "x^2");
            check.equal(preview.querySelector("[contenteditable]"), null);
            check.equal(cell.getCellText(host), "Summary");
            check.equal(cell.getCellValueText(value), "Summary");
            check.equal(detached ? preview.hasAttribute("data-id") : preview.dataset.id === "bound", !detached);
        }
        for (const html of [attribute.genAVValueHTML(value), attribute.genAVRelationHTML(value, "row", false),
            cell.renderCell({type: "rollup", rollup: {contents: [value]}}, 0, false)]) {
            const host = document.createElement("div"); host.innerHTML = html;
            check.equal(host.querySelector('[data-type~="strong"]').textContent, "Styled");
            check.equal(host.querySelector("[contenteditable]"), null);
        }
    }
    const plain: IAVCellValue = {type: "block", isDetached: true, block: {content: "**literal** <tag> &"}};
    const initial = primary.getAVPrimaryInitialDOM(plain);
    const template = document.createElement("template"); template.innerHTML = initial;
    check.equal(template.content.querySelector('[data-type="strong"]'), null);
    check.equal(template.content.querySelector("[contenteditable]").textContent, plain.block.content);
    const edit = primary.createAVPrimaryEditValue(dom('<span data-type="strong">Changed</span>'), source);
    check.equal(edit.block.content, "Changed");
    check.equal(edit.block.rich, null);
    check.equal(edit.isDetached, source.isDetached);
    check.equal(source.block.content, "Summary");
    check.throws(() => primary.createAVPrimaryEditValue(dom("a") + dom("b"), source), /Inline only/);
};

test("primary rich text preserves title inline elements across views, details, relations and rollups with literal legacy editing", async () => {
    const profile = mkdtempSync(join(tmpdir(), "siyuan-primary-rich-"));
    const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE;
    try {
        const sources = Object.fromEntries([
            ["primaryRich", "src/protyle/render/av/primaryRich.ts"], ["documentTitleDOM", "src/protyle/header/documentTitleDOM.ts"],
            ["cell", "src/protyle/render/av/cell.ts"], ["attributeValue", "src/protyle/render/av/attributeValue.ts"],
        ].map(([name, path]) => [name, transpileModule(readFileSync(path, "utf8"), {
            compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
        }).outputText]));
        const runner = join(profile, "run.cjs");
        writeFileSync(runner, `const {app,BrowserWindow}=require("electron");app.setPath("userData",${JSON.stringify(join(profile,"data"))});
app.whenReady().then(async()=>{let win;try{win=new BrowserWindow({show:false,webPreferences:{nodeIntegration:true,contextIsolation:false}});
await win.loadURL("about:blank");
await win.webContents.executeJavaScript('require('+${JSON.stringify(JSON.stringify(resolve("stage/protyle/js/lute/lute.min.js")))}+');void 0;');
const result=await win.webContents.executeJavaScript('(()=>{const __name=value=>value;try{('+${JSON.stringify(cases.toString())}+')('+${JSON.stringify(JSON.stringify(sources))}+');return "ok";}catch(error){return String(error.stack);}})()');
if(result!=="ok")throw new Error(result);
win.destroy();app.exit(0);}catch(error){console.error(error);win?.destroy();app.exit(1);}});`);
        await promisify(execFile)(require("electron"), [runner], {env, windowsHide: true, timeout: 45000});
    } finally {
        assert.equal(dirname(resolve(profile)), resolve(tmpdir()));
        rmSync(profile, {recursive: true, force: true, maxRetries: 5});
    }
});
