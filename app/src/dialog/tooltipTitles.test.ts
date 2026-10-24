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
    document.body.innerHTML = "<style>#carrier{width:200px}span{display:inline-block;min-height:20px}</style>" +
        '<div id="carrier"></div><div id="tooltip" class="fn__none"></div>';
    window.siyuan = {languages: {findInDoc: "${x}/${y}", _kernel: {16: "Untitled"}}, notebooks: []} as unknown as typeof window.siyuan;
    window.DOMPurify = {sanitize: (value: string) => value} as typeof window.DOMPurify;
    let mobile = false;
    let hPath = "";
    const modules: Record<string, any> = {};
    const load = (name: string) => {
        const exports: Record<string, unknown> = {};
        new Function("exports", "require", "Lute", sources[name])(exports, (id: string) => {
            const key = id.split("/").pop();
            if (modules[key]) return modules[key];
            return {isMobile: () => mobile, isInIOS: () => false, emitToPlugins() {}, forEachPluginSubscriber() {},
                getIconByType: () => "iconFile", getTreeItemTailHTML: () => "", getAttr: () => "",
                unicode2Emoji: () => "", getNotebookName: () => "", getDisplayName: (value: string) => value,
                getArticle() {}, fetchPost: (_url: string, _data: unknown, callback: (value: unknown) => void) => callback({
                    data: {pageCount: 1, blocks: [{id: "doc", rootID: "doc", type: "d", hPath, content: "", ial: {}}]},
                })};
        }, {BlockDOM2Content: (value: string) => {
            const content = document.createElement("div");
            content.innerHTML = value;
            return content.textContent;
        }});
        modules[name] = exports;
        return exports;
    };
    load("escape");
    load("hoverInput");
    const tooltip = load("tooltip") as typeof import("./tooltip");
    const treeModule = load("Tree") as unknown as {Tree: {prototype: object}};
    const tree = Object.create(treeModule.Tree.prototype);
    tree.titleTooltipPosition = "parentE";
    const search = load("search") as {render: (config: {hPath: string}) => string, results: (title: string) => string[]};
    load("config");
    const searchPath = load("path") as typeof import("../search/path");
    const unRef = load("unRef") as typeof import("../search/unRef");
    const carrier = document.getElementById("carrier");
    const tip = document.getElementById("tooltip");
    tooltip.initTooltips();
    const escape = modules.escape as typeof import("../util/escape");
    for (const title of ["A%2FB", "A%3Ctag%3E.sy", "100%25/Incomplete%2", "A&copy;B", "A&amp;B",
        "A&lt;tag&gt;", 'A<tag> & "quotes"', "A&#47;B", "A&#x2f;B"]) {
        // Search result/tree paths are rendered HTML; search scopes from getFullHPathByID are plain text.
        hPath = escape.escapeHtmlTextAndAttr(title);
        const fragments = [
            tree.genHTML([{id: "doc", type: "backlink", depth: 0, name: title, hPath}]),
            tree.genHTML([{id: "doc", type: "outline", depth: 0, name: hPath}]),
            tree.genBlockHTML([{id: "doc", depth: 0, content: hPath}], true, "outline"),
            search.render({hPath: title}),
            ...search.results(hPath),
        ];
        carrier.innerHTML = '<div id="searchUnRefResult"></div><div id="searchUnRefList"></div>' +
            '<div data-type="unRefPrevious"></div><div data-type="unRefNext"></div><div class="fn__loading"></div>';
        unRef.getUnRefList(carrier, {protyle: {element: document.createElement("div")}} as unknown as import("../protyle").Protyle);
        fragments.push(carrier.querySelector("#searchUnRefList").innerHTML);
        for (const fragment of fragments) {
            carrier.innerHTML = fragment;
            const target = carrier.querySelector(".ariaLabel");
            check.equal(target.getAttribute("data-tooltip-encoding"), "none");
            check.equal(target.getAttribute("aria-label"), escape.escapeHtmlTextAndAttr(title));
            target.dispatchEvent(new PointerEvent("pointerover", {bubbles: true, pointerType: "mouse"}));
            target.dispatchEvent(new MouseEvent("mouseover", {bubbles: true}));
            check.equal(tip.textContent, title, fragment);
            check.equal(tip.querySelector("tag"), null);
            if (target.id === "searchPathInput") {
                await searchPath.refreshCurrentSearchPath({element: carrier, config: {idPath: ["doc"]} as Config.IUILayoutTabSearchConfig,
                    resolveHPath: async () => title});
                target.dispatchEvent(new MouseEvent("mouseover", {bubbles: true}));
                check.equal(tip.textContent, title, "refreshed search path matches the initial tooltip");
            }
        }
        mobile = true;
        carrier.innerHTML = tree.genHTML([{id: "doc", type: "backlink", depth: 0, name: title, hPath}]);
        check.equal(carrier.querySelector(".ariaLabel").getAttribute("aria-label"), escape.escapeHtmlTextAndAttr(title));
        mobile = false;
    }
    carrier.innerHTML = '<span class="ariaLabel" aria-label="A%2FB">Legacy encoded tooltip</span>';
    carrier.firstElementChild.dispatchEvent(new MouseEvent("mouseover", {bubbles: true}));
    check.equal(tip.textContent, "A/B");
    return "Title tooltip cases passed";
};

test("document and heading tooltips preserve percent escapes and entities across trees and search", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 30000,
}, async () => {
    const sources: Record<string, string> = {};
    const compile = (source: string) => ts.transpileModule(source, {
        compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021},
    }).outputText;
    for (const file of ["util/escape", "util/hoverInput", "dialog/tooltip", "util/Tree", "search/unRef", "search/config", "search/path"]) {
        sources[file.split("/").pop()] = compile(readFileSync(`src/${file}.ts`, "utf8"));
    }
    const searchSource = readFileSync("src/search/util.ts", "utf8");
    const start = searchSource.indexOf('<span id="searchPathInput"');
    const end = searchSource.indexOf("</span>", start) + "</span>".length;
    const resultTemplates = [...searchSource.matchAll(
        /<span class="b3-list-item__(?:text|meta)[^\n]*aria-label="\$\{escapeHtmlTextAndAttr\(title\)}"[^\n]*<\/span>/g,
    )];
    assert.equal(resultTemplates.length, 2);
    sources.search = compile('const {escapeHtml, escapeHtmlTextAndAttr, escapeTooltipTextAttr} = require("escape"); exports.render = config => `' +
        searchSource.slice(start, end) + "`; exports.results = title => [" +
        resultTemplates.map(match => "`" + match[0] + "`").join(",") + "];");
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-title-tooltip-test-"));
    const script = path.join(temporary, "run.cjs");
    writeFileSync(script, `const {app,BrowserWindow}=require("electron");
app.setPath("userData",${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");app.whenReady().then(async()=>{
const win=new BrowserWindow({show:false,width:800,height:600,webPreferences:{nodeIntegration:true,contextIsolation:false,offscreen:true}});
try {await win.loadURL("data:text/html,<html><body></body></html>");
console.log(await win.webContents.executeJavaScript(${JSON.stringify("const __name = value => value; (() => {try {return (" +
        browserCases.toString() + ")(" + JSON.stringify(sources) + ");} catch (error) {return error.stack;}})()")}));win.destroy();app.exit(0);
}catch(e){console.error(e);win.destroy();app.exit(1);}});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron") as unknown as string, [script],
            {env, windowsHide: true, timeout: 25000});
        assert.match(result.stdout, /Title tooltip cases passed/);
    } finally {
        if (path.dirname(path.resolve(temporary)) === path.resolve(tmpdir()) &&
            path.basename(temporary).startsWith("siyuan-title-tooltip-test-")) {
            rmSync(temporary, {recursive: true, force: true});
        }
    }
});
