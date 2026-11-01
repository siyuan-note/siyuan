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
                emitToPlugins: () => {}, forEachPluginSubscriber: () => {}, getFileTreeIconHTML: () => "", getFileTreeDefaultIconAttr: () => "",
                getPublishAccessOptionByLevel: () => ({iconHTML: ""}), getTreeItemTailHTML: (count: string, actions: string) => count + actions};
        });
        modules[name] = exports;
        return exports;
    };
    load("escape");
    load("pathName");
    const helper = load("fileTreeTooltip");
    const input = load("hoverInput") as typeof import("../../util/hoverInput");
    const tooltip = load("tooltip") as typeof import("../../dialog/tooltip");
    const iconHelper = load("fileTreeIcon");
    iconHelper.getFileTreeIconHTML = () => "";
    load("rowData");
    const rowRenderer = load("row") as typeof import("./docTree/row");
    const Pinned = load("PinnedDocs") as unknown as {PinnedDocs: {prototype: object}};
    const panel = Object.create(Pinned.PinnedDocs.prototype);
    const regular: {render?: (item: unknown) => string, renderExpanded?: (item: unknown) => string} = {};
    const render = (doc: IFile, options = {}) => rowRenderer.renderDocTreeRowHTML({
        id: doc.id, notebookId: "box", path: doc.path, name: doc.name, kind: "document", file: doc,
        subFileCount: doc.subFileCount, depth: 0, index: 0, setSize: 1, occurrenceKey: "doc",
        parentID: "", childrenSortMode: null, effectiveSortMode: 0,
    }, options);
    regular.render = doc => render(doc as IFile);
    regular.renderExpanded = doc => render(doc as IFile, {mobile: true});
    const pinned = document.getElementById("pinned");
    const ordinary = document.getElementById("ordinary");
    const expanded = document.createElement("ul");
    document.body.append(expanded);
    const tip = document.getElementById("tooltip");
    tooltip.initTooltips();
    const doc = {id: "doc", notebook: "box", name: 'A//%2F/%3Ctag%3E/Title "quotes" <tag> & text &amp; &copy; &lt;tag&gt;.sy', path: "/doc.sy", subFileCount: 2, icon: "", count: 0,
        hSize: "2 KB", hMtime: "2026-10-17 11:00:00", hCtime: "2026-09-01 10:00:00",
        bookmark: 'Mark "quoted"', name1: "Named <tag>", alias: "Alias & text", memo: "Memo <img src=x>"};
    const rowData = modules.rowData as typeof import("./docTree/rowData");
    ordinary.innerHTML = render({...doc, count: 3} as IFile);
    check.ok(ordinary.querySelector(".counter.popover__block.b3-tooltips"), "desktop reference counts retain backlink previews and tooltips");
    check.ok(ordinary.querySelector('[data-type="more-file"].b3-tooltips'), "document actions retain their tooltips");
    const notebook = {id: "box", name: "Notebook", closed: true, encrypted: true, sortMode: 0} as INotebook;
    window.siyuan.notebooks.push(notebook);
    const notebookItem = rowData.notebookTreeItem(notebook);
    ordinary.innerHTML = rowRenderer.renderDocTreeRowHTML(notebookItem);
    check.equal(rowData.getDocTreeItem(ordinary.firstElementChild)?.notebookId, "box", "closed notebook identity comes from its tree key");
    check.equal(rowData.isEncryptedDocTreeItem(ordinary.firstElementChild), true);
    check.equal(ordinary.firstElementChild.getAttribute("data-default-icon"), "lock");
    check.equal(ordinary.querySelector(".b3-list-item__switch").classList.contains("fn__none"), true, "encrypted notebooks cannot expose publish controls");
    notebook.closed = false;
    window.siyuan.config.readonly = true;
    ordinary.innerHTML = rowRenderer.renderDocTreeRowHTML(notebookItem);
    check.equal(ordinary.querySelector('[data-type="more-root"]').classList.contains("fn__none"), true);
    check.equal((ordinary.firstElementChild as HTMLElement).draggable, false);
    window.siyuan.config.readonly = false;
    for (const options of [{}, {mobile: true}, {pinned: true}, {mobile: true, pinned: true}]) {
        ordinary.innerHTML = render(doc as IFile, options);
        const row = ordinary.firstElementChild as HTMLElement;
        const dataNames = Array.from(row.attributes).filter(attribute => attribute.name.startsWith("data-"))
            .map(attribute => attribute.name).sort();
        check.deepEqual(dataNames, ["data-default-icon", "data-node-id", "data-tree-key", "data-type"]);
        check.equal(row.draggable, !options.mobile);
    }
    const detachedItem = {id: doc.id, notebookId: "box", path: doc.path, name: doc.name, kind: "document",
        file: doc, occurrenceKey: "detached", depth: 0, subFileCount: 2, parentID: "", childrenSortMode: null,
        effectiveSortMode: 0, index: 0, setSize: 1} as import("./docTree/types").IDocTreeItem;
    const detached = rowRenderer.renderDocTreeRow(detachedItem);
    check.equal(rowData.getDocTreeItem(detached), detachedItem, "detached menu rows retain their model without serialized fields");
    const mutations: string[] = [];
    const observer = new MutationObserver(entries => mutations.push(...entries.map(entry => entry.attributeName)));
    observer.observe(detached, {attributes: true});
    rowData.setDocTreeAttribute(detached, "aria-selected", "true");
    await Promise.resolve();
    check.deepEqual(mutations.splice(0), ["aria-selected"]);
    rowData.setDocTreeAttribute(detached, "aria-selected", "true");
    rowData.setDocTreeAttribute(detached, "aria-busy");
    await Promise.resolve();
    check.deepEqual(mutations, [], "unchanged attributes and absent loading state cause no DOM mutations");
    observer.disconnect();
    for (const depth of [0, 1]) {
        pinned.replaceChildren();
        pinned.append(panel.renderRow({id: doc.id, kind: "document", path: doc.path, name: doc.name, subFileCount: doc.subFileCount, file: doc, notebookId: doc.notebook, occurrenceKey: "pin:doc", depth}));
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
    pinned.append(panel.renderRow({id: doc.id, kind: "document", path: doc.path, name: doc.name, subFileCount: doc.subFileCount, file: doc, notebookId: doc.notebook, occurrenceKey: "pin:doc", depth: 0, unavailable: true}));
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
    for (const file of ["layout/dock/docTree/row", "layout/dock/docTree/rowData", "emoji/fileTreeIcon"]) {
        sources[file.split("/").pop()] = compile(readFileSync(`src/${file}.ts`, "utf8"));
    }
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
