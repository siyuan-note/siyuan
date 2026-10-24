import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import * as ts from "typescript";

const browserCases = async (sources: Record<string, string>) => {
    const check: typeof assert = require("node:assert/strict");
    document.body.innerHTML = "<style>.fn__none{display:none}li{width:200px;height:28px}#tooltip{position:fixed}</style>" +
        '<ul id="pinned"></ul><ul id="ordinary"></ul><div id="tooltip" class="fn__none"></div>';
    window.siyuan = {config: {readonly: false, fileTree: {docIconClickMode: 1}}, notebooks: [], languages: {
        bookmark: "Bookmark", name: "Name", alias: "Alias", memo: "Memo", includeSubFile: " (x children)",
        modifiedAt: "Modified", createdAt: "Created", closeNotebook: "Closed notebook", _kernel: {16: "Untitled"},
    }} as unknown as typeof window.siyuan;
    window.DOMPurify = {sanitize: (value: string) => value} as typeof window.DOMPurify;
    let mobile = false;
    const modules: Record<string, Record<string, unknown>> = {};
    const load = (name: string) => {
        const exports: Record<string, unknown> = {};
        new Function("exports", "require", sources[name])(exports, (id: string) => {
            const key = id.split("/").pop();
            if (key === "path") { return require("node:path"); }
            return modules[key] || {isInIOS: () => false, isMobile: () => mobile,
                emitToPlugins: () => {}, forEachPluginSubscriber: () => {}, getFileTreeIconHTML: () => ""};
        });
        modules[name] = exports;
        return exports;
    };
    load("escape");
    const names = load("pathName") as typeof import("../../util/pathName");
    const helper = load("fileTreeTooltip");
    const input = load("hoverInput") as typeof import("../../util/hoverInput");
    const tooltip = load("tooltip") as typeof import("../../dialog/tooltip");
    const Pinned = load("PinnedDocs") as unknown as {PinnedDocs: {prototype: object}};
    const panel = Object.create(Pinned.PinnedDocs.prototype);
    panel.expanded = new Set();
    const regular: {render?: (item: unknown) => string, renderExpanded?: (item: unknown) => string} = {};
    const dependencies = {...modules.escape, ...helper, getDocDisplayName: names.getDocDisplayName,
        FILE_TREE_CHILDREN_SORT_MODE: "data-children-sort-mode", getFileTreeDefaultIconAttr: () => "",
        getFileTreeIconHTML: () => "", getPublishAccessOptionByLevel: () => ({iconHTML: ""})};
    new Function("exports", ...Object.keys(dependencies), sources.regular)(regular, ...Object.values(dependencies));
    const pinned = document.getElementById("pinned");
    const ordinary = document.getElementById("ordinary");
    const expanded = document.createElement("ul");
    document.body.append(expanded);
    const tip = document.getElementById("tooltip");
    tooltip.initTooltips();
    const doc = {id: "doc", notebook: "box", name: 'A//%2F/%3Ctag%3E/Title "quotes" <tag> & text &amp; &copy; &lt;tag&gt;.sy', path: "/doc.sy", subFileCount: 2,
        hSize: "2 KB", hMtime: "2026-10-17 11:00:00", hCtime: "2026-09-01 10:00:00",
        bookmark: 'Mark "quoted"', name1: "Named <tag>", alias: "Alias & text", memo: "Memo <img src=x>"};
    for (const depth of [0, 1]) {
        pinned.replaceChildren();
        await panel.appendDoc(pinned, doc, "doc", depth, 0);
        ordinary.innerHTML = regular.render.call({element: ordinary}, doc);
        expanded.innerHTML = regular.renderExpanded(doc);
        const title = pinned.querySelector(".b3-list-item__text");
        check.equal(title.textContent, doc.name);
        check.equal(ordinary.querySelector(".b3-list-item__text").textContent, doc.name);
        check.equal(title.getAttribute("aria-label"), ordinary.querySelector(".b3-list-item__text").getAttribute("aria-label"));
        check.equal(title.getAttribute("aria-label"), expanded.querySelector(".b3-list-item__text").getAttribute("aria-label"));
        title.dispatchEvent(new PointerEvent("pointerover", {bubbles: true, pointerType: "mouse"}));
        title.dispatchEvent(new MouseEvent("mouseover", {bubbles: true}));
        await new Promise(resolve => setTimeout(resolve, 260));
        check.equal(tip.classList.contains("fn__none"), false);
        for (const value of [doc.name, doc.hSize, doc.hMtime, doc.hCtime, doc.bookmark, doc.name1, doc.alias, doc.memo, "2 children"]) {
            check.ok(tip.textContent.includes(value), `missing tooltip detail: ${value}`);
        }
        check.equal(tip.querySelector("img, tag"), null, "metadata remains plain text");
        expanded.querySelector(".b3-list-item__text").dispatchEvent(new MouseEvent("mouseover", {bubbles: true}));
        check.ok(tip.textContent.includes(doc.name), "expanded documents preserve the same title");
        title.setAttribute("aria-label", (helper as typeof import("../../util/fileTreeTooltip")).genFileTreeDocAriaLabel(doc));
        title.dispatchEvent(new MouseEvent("mouseover", {bubbles: true}));
        check.ok(tip.textContent.includes(doc.name), "dynamic tooltip updates preserve literal entities");
        tooltip.hideTooltip();
    }
    pinned.replaceChildren();
    await panel.appendDoc(pinned, {...doc, unavailable: true}, "doc", 0, 0);
    const closed = pinned.querySelector(".b3-list-item__text");
    closed.dispatchEvent(new MouseEvent("mouseover", {bubbles: true}));
    check.equal(tip.textContent, doc.name + " (Closed notebook)");
    tooltip.hideTooltip();
    closed.dispatchEvent(new PointerEvent("pointerdown", {bubbles: true, pointerType: "touch"}));
    closed.dispatchEvent(new MouseEvent("mouseover", {bubbles: true}));
    check.equal(input.isTouchHoverInput(), true);
    check.equal(tip.classList.contains("fn__none"), true);
    mobile = true;
    closed.dispatchEvent(new PointerEvent("pointerover", {bubbles: true, pointerType: "mouse"}));
    closed.dispatchEvent(new MouseEvent("mouseover", {bubbles: true}));
    check.equal(tip.classList.contains("fn__none"), true);
    return "Pinned tooltip details passed";
};

test("pinned roots and children show the same complete escaped tooltip as ordinary documents", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 30000,
}, async () => {
    const sources: Record<string, string> = {};
    const compile = (source: string) => ts.transpileModule(source, {
        compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021},
    }).outputText;
    for (const file of ["util/escape", "util/pathName", "util/fileTreeTooltip", "util/hoverInput", "dialog/tooltip", "layout/dock/PinnedDocs"]) {
        sources[file.split("/").pop()] = compile(readFileSync(`src/${file}.ts`, "utf8"));
    }
    const source = ts.createSourceFile("Files.ts", readFileSync("src/layout/dock/Files.ts", "utf8"), ts.ScriptTarget.Latest, true);
    const declaration = source.statements.find(ts.isClassDeclaration);
    const method = declaration.members.find(member => member.name?.getText(source) === "genFileHTML") as ts.MethodDeclaration;
    const pathNameSource = readFileSync("src/util/pathName.ts", "utf8");
    const start = pathNameSource.indexOf('<span class="b3-list-item__text ariaLabel" data-position="parentE" data-tooltip-encoding');
    const end = pathNameSource.indexOf("</span>", start) + "</span>".length;
    sources.regular = compile(`exports.render = function(item) ${method.body.getText(source)};` +
        "exports.renderExpanded = item => `" + pathNameSource.slice(start, end) + "`;");
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-pinned-tooltip-test-"));
    const script = path.join(temporary, "run.cjs");
    writeFileSync(script, `const {app,BrowserWindow}=require("electron");
app.setPath("userData",${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");app.whenReady().then(async()=>{
const win=new BrowserWindow({show:false,width:800,height:600,webPreferences:{nodeIntegration:true,contextIsolation:false,offscreen:true}});
try {await win.loadURL("data:text/html,<html><body></body></html>");
console.log(await win.webContents.executeJavaScript(${JSON.stringify("const __name = value => value; (" +
        browserCases.toString() + ")(" + JSON.stringify(sources) + ")")}));win.destroy();app.exit(0);
}catch(e){console.error(e);win.destroy();app.exit(1);}});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron") as unknown as string, [script],
            {env, windowsHide: true, timeout: 25000});
        assert.match(result.stdout, /Pinned tooltip details passed/);
    } finally {
        if (path.dirname(path.resolve(temporary)) === path.resolve(tmpdir()) &&
            path.basename(temporary).startsWith("siyuan-pinned-tooltip-test-")) {
            rmSync(temporary, {recursive: true, force: true});
        }
    }
});
