import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {resolve} from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {compile} from "sass";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const browserCases = async (sources: Record<string, string>) => {
    const check: typeof assert = require("node:assert/strict");
    document.head.innerHTML = `<style>${sources.css}</style>`;
    document.body.style.cssText = "--b3-font-size:16px;--b3-font-size-editor:32px;--b3-font-family:Arial;--b3-font-family-protyle:Georgia";
    document.body.innerHTML = `<div class="toolbar mobile-topbar"><button class="toolbar__button">L</button>
<input id="toolbarName" class="toolbar__title"><span id="toolbarNameReadonly" class="toolbar__title toolbar__title--readonly"></span>
<button class="toolbar__button">R</button></div><div id="editor"></div>`;
    const input = document.getElementById("toolbarName") as HTMLInputElement;
    const label = document.getElementById("toolbarNameReadonly");
    const protyle: any = {element: document.getElementById("editor"), block: {rootID: "document"}, notebookId: "box", options: {render: {}},
        disabled: false, preview: {element: document.createElement("div")}};
    protyle.preview.element.className = "fn__none";
    const runtime = {siyuan: {mobile: {editor: {protyle}}, config: {readonly: false, editor: {autoDirection: false}}}};
    const pending: Array<{id: string, reply: (response: unknown) => void}> = [];
    const modules: Record<string, any> = {
        "../../util/fetch": {fetchPost: (_url: string, data: {id: string}, reply: (response: unknown) => void) =>
            pending.push({id: data.id, reply})},
        "../../util/pathName": {getDocDisplayName: (text: string, empty: boolean) => empty ? "Untitled" : text},
        "../../util/hostCapabilities": {sanitizeKernelHTML: (html: string) => html},
        "../render/mathRender": {mathRender: () => Promise.resolve()},
        "../../protyle/render/autoDirection": {setTitleAutoDirection: () => {}},
    };
    const load = (source: string) => {
        const exports: Record<string, any> = {};
        new Function("exports", "require", "window", source)(exports, (name: string) => modules[name] || {}, runtime);
        return exports;
    };
    modules["../../protyle/header/documentTitlePreview"] = load(sources.preview);
    const {updateMobileDocumentTitle: update} = load(sources.title);
    modules["../../mobile/util/mobileDocumentTitle"] = {updateMobileDocumentTitle: update};
    const {updateMobileTitleReadonly: readonly} = load(sources.readonly);
    const response = (html: string) => ({code: 0, data: {id: protyle.block.rootID, notebook: protyle.notebookId,
        format: "inline-ast", text: "Summary", empty: false,
        blockDOM: `<div data-node-id="paragraph" data-type="NodeParagraph" class="p"><div contenteditable="true" spellcheck="false">${html}</div></div>`}});
    input.value = "Summary";
    update(protyle);
    readonly(protyle);
    check.equal(input.classList.contains("fn__none"), true);
    check.equal(label.classList.contains("fn__none"), false);
    check.equal(label.tabIndex, 0);
    check.equal(label.textContent, "Summary");
    pending.shift().reply(response('<span data-type="strong">Bold</span> <span data-type="em">Italic</span>' +
        '<span class="img"><img width="100" height="200" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="></span>' +
        '<span data-type="inline-math" data-content="x^2">x²</span>' +
        '<span style="font-size:72px">Large</span> ' + "Long title ".repeat(30)));
    check.ok(label.querySelector('[data-type="strong"]'));
    check.ok(label.querySelector("img"));
    check.ok(label.querySelector('[data-type="inline-math"]'));
    check.equal(input.value, "Summary", "the plain summary stays available to tabs and API callers");
    check.ok(label.getBoundingClientRect().height <= 48, "inline content cannot expand the navigation bar");
    check.ok(label.firstElementChild.getBoundingClientRect().width <= label.getBoundingClientRect().width + 1);
    const richHTML = label.innerHTML;
    for (const className of ["b3-list-item__text", "item__text", "mobile-tabs__item-title"]) {
        const compact = document.createElement("span");
        compact.className = className;
        document.body.append(compact);
        modules["../../protyle/header/documentTitlePreview"].renderDocumentTitlePreview(compact, "document", "box", () => true,
            response('<span style="font-size:72px">Large preview</span><span class="img"><img height="200" width="100"></span>').data);
        check.ok(compact.getBoundingClientRect().height <= parseFloat(getComputedStyle(compact).fontSize) * 1.625 + 1,
            "rich previews preserve compact tree and tab heights: " + className);
        compact.remove();
    }
    for (const mode of ["readonly", "preview", "editing"]) {
        protyle.disabled = mode === "readonly";
        protyle.preview.element.classList.toggle("fn__none", mode !== "preview");
        readonly(protyle);
        check.equal(label.innerHTML, richHTML, "mode switching preserves the rich preview");
        check.equal(label.tabIndex, mode === "editing" ? 0 : -1);
    }
    let opens = 0;
    let saves = 0;
    const editingHTML = '<span>123</span><span data-type="strong">Bold</span> <span data-type="em">Italic</span>' +
        '<span data-type="code">Code with spaces long enough to exceed the title width</span><span data-type="mark">Mark</span>';
    label.style.maxWidth = "120px";
    modules["../../protyle/header/documentTitlePreview"].renderDocumentTitlePreview(label.firstElementChild, "document", "box",
        () => true, response(editingHTML).data);
    const textBounds = (element: Element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        return range.getBoundingClientRect();
    };
    const previewBounds = textBounds(label.querySelector(".document-title-preview > span"));
    const previewWeight = getComputedStyle(label.querySelector(".document-title-preview > span")).fontWeight;
    modules["../../util/fetch"].fetchSyncPost = async () => ({code: 0, data: {...response(editingHTML).data, revision: "r0"}});
    modules["../render/autoDirection"] = {setTitleAutoDirection: () => {}};
    modules["../util/normalizeText"] = {nbsp2space: (text: string) => text};
    modules["../../util/escape"] = {escapeHtmlTextAndAttr: (text: string) => text};
    let keyboards = 0;
    modules["../../mobile/util/mobileAppUtil"] = {callMobileAppShowKeyboard: () => keyboards++};
    modules["./documentTitleEditor"] = {DocumentTitleEditor: class {
        element = document.createElement("div");
        fragment: any;
        constructor(_owner: unknown, host: HTMLElement, value: {blockDOM: string}, onEditable: (element: HTMLElement) => void) {
            host.classList.add("protyle", "protyle-lite-fragment", "protyle-title__rich");
            host.innerHTML = '<div class="protyle-content"><div class="protyle-wysiwyg">' + value.blockDOM + "</div></div>";
            this.element = host.querySelector("[contenteditable]");
            this.element.classList.add("protyle-title__input");
            this.fragment = {protyle: {element: host}};
            onEditable(this.element);
        }
        focus() { opens++; this.element.focus(); }
        flush() { saves++; return Promise.resolve(); }
        refresh() { return Promise.resolve(); }
        setReadonly(disabled: boolean) { this.element.contentEditable = String(!disabled); }
        destroy() { this.element.remove(); }
    }};
    modules["../../constants"] = {Constants: {}};
    const {Title} = load(sources.editorTitle);
    const title = Object.assign(Object.create(Title.prototype), {protyle, summary: "Summary", sourceRequest: 0,
        element: document.createElement("div")});
    protyle.title = title;
    title.element.dataset.nodeId = "document";
    title.element.innerHTML = '<div class="protyle-attr"></div>';
    protyle.preview.element.classList.remove("fn__none");
    await title.openEditor();
    check.equal(label.querySelector(".mobile-document-title-editor"), null, "preview mode does not enter inline editing");
    protyle.preview.element.classList.add("fn__none");
    await title.openEditor();
    const inline = label.querySelector<HTMLElement>(".mobile-document-title-editor");
    check.ok(inline, "the complete title editor mounts directly in the navigation bar");
    check.equal(document.activeElement, title.editElement);
    check.equal(label.getAttribute("role"), null);
    check.ok(label.getBoundingClientRect().height <= 48);
    check.equal(getComputedStyle(title.editElement).fontSize, "17px");
    const editable = title.editElement;
    const editingBounds = textBounds(editable.firstElementChild);
    check.ok(Math.abs(editingBounds.top - previewBounds.top) <= 1,
        "opening the top-bar editor preserves the preview text position: " + JSON.stringify({preview: previewBounds.top, editing: editingBounds.top}));
    check.ok(Math.abs(editingBounds.left - previewBounds.left) <= 1, "opening the top-bar editor preserves horizontal alignment");
    check.equal(getComputedStyle(editable.firstElementChild).fontWeight, previewWeight, "ordinary text keeps its preview weight");
    check.equal(getComputedStyle(editable).fontFamily, getComputedStyle(label).fontFamily, "the top-bar editor uses the navigation font");
    check.equal(getComputedStyle(editable.querySelector('[data-type="strong"]')).fontWeight, "700", "explicit bold marks remain bold");
    check.equal(editable.querySelector('[data-type="code"]').getClientRects().length, 1,
        "inline title editing does not wrap code when the toolbar is narrow");
    Object.assign(runtime.siyuan, {zIndex: 10, languages: {}});
    Object.assign(runtime, {innerHeight: window.innerHeight, innerWidth: window.innerWidth, visualViewport: window.visualViewport});
    modules["../layout/getTopBarHeight"] = {getTopBarHeight: () => 0};
    modules["../../util/setPosition"] = load(sources.position);
    modules["./selectionElementPosition"] = load(sources.selectionPosition);
    modules["../ui/hideElements"] = {hideElements: () => {}};
    modules["../util/inlineElementMarker"] = {stripSemanticMarkersFromRangeText: (range: Range) => range.toString()};
    modules["../util/hasClosest"] = {hasClosestByClassName: (element: Element, name: string) => element.closest("." + name)};
    modules["../util/selection"] = {getSelectionPosition: (_element: Element, range: Range) => {
        const rect = range.getBoundingClientRect();
        return {left: rect.left, top: rect.top};
    }};
    const {Toolbar} = load(sources.toolbar);
    const contentToolbar = Object.assign(Object.create(Toolbar.prototype), {subElement: document.createElement("div"),
        element: document.createElement("div"), LINE_HEIGHT: 30, clearSubElement() { this.subElement.replaceChildren(); }});
    contentToolbar.subElement.className = "protyle-util protyle-util--mobile";
    document.body.append(contentToolbar.subElement);
    const breadcrumb = document.createElement("div");
    breadcrumb.className = "protyle-breadcrumb";
    breadcrumb.style.cssText = "position:absolute;top:48px;left:0;width:100%;height:42px;z-index:5";
    document.body.append(breadcrumb);
    const selectedRange = document.createRange();
    selectedRange.selectNodeContents(editable.firstElementChild);
    const menuOwner = {element: inline, wysiwyg: {element: inline.querySelector(".protyle-wysiwyg")}, disabled: false};
    contentToolbar.showContent(menuOwner, selectedRange, editable.parentElement);
    for (const action of [undefined, "more", "back"]) {
        if (action) contentToolbar.subElement.querySelector(`[data-action="${action}"]`).click();
        check.ok(contentToolbar.subElement.getBoundingClientRect().top >= selectedRange.getBoundingClientRect().bottom + 4,
            "top-bar selection actions stay below the selected title, including More and Back: " +
            JSON.stringify({action, menu: contentToolbar.subElement.getBoundingClientRect().toJSON(),
                range: selectedRange.getBoundingClientRect().toJSON(), style: contentToolbar.subElement.style.cssText}));
        const menuRect = contentToolbar.subElement.getBoundingClientRect();
        check.ok(contentToolbar.subElement.contains(document.elementFromPoint(menuRect.left + 20, menuRect.top + 25)),
            "top-bar selection actions receive hits above the transformed breadcrumb bar");
    }
    const bodySelection = document.createElement("div");
    bodySelection.style.cssText = "position:fixed;top:220px;left:40px";
    bodySelection.textContent = "Body selection";
    menuOwner.wysiwyg.element.append(bodySelection);
    selectedRange.selectNodeContents(bodySelection);
    contentToolbar.showContent(menuOwner, selectedRange, bodySelection);
    check.ok(contentToolbar.subElement.getBoundingClientRect().bottom <= selectedRange.getBoundingClientRect().top - 4,
        "body selections retain actions above the selected text when space is available");
    bodySelection.remove();
    contentToolbar.subElement.remove();
    breadcrumb.remove();
    title.setTitle("Saved summary");
    check.equal(title.editElement, editable, "summary refresh keeps the inline editor and caret");
    check.equal(label.querySelector(".mobile-document-title-editor"), inline);
    await title.flushPendingInput();
    check.equal(saves, 1);
    await title.openEditor();
    check.equal(opens, 2, "repeated editing reuses the mounted title editor");
    check.equal(keyboards, 2, "inline opening uses the native keyboard bridge after source loading");
    protyle.disabled = true;
    readonly(protyle);
    check.equal(editable.contentEditable, "false");
    check.notEqual(document.activeElement, editable);
    protyle.disabled = false;
    readonly(protyle);
    check.equal(editable.contentEditable, "true");
    protyle.wysiwyg = {renderCustom: () => {}};
    protyle.block.rootID = "next";
    title.render(protyle, {data: {ial: {title: "Next"}, name: "Next", refCount: 0}});
    check.equal(label.querySelector(".mobile-document-title-editor"), null, "document switches destroy the previous inline source");
    check.equal(title.editElement, undefined);
    check.equal(label.textContent, "Next");
    title.destroy();
    protyle.title = undefined;
    protyle.block.rootID = "document";
    pending.length = 0;
    update(protyle);
    const stale = pending.shift();
    protyle.block.rootID = "next";
    input.value = "Next";
    update(protyle);
    stale.reply({code: 0, data: {id: "document", notebook: "box", format: "plain", text: "Stale secret"}});
    check.equal(label.textContent, "Next");
    label.replaceChildren();
    pending.shift().reply(response("Late locked title"));
    check.equal(label.textContent, "", "clearing the title prevents late plaintext restoration");
    input.value = "";
    update(protyle);
    check.equal(label.textContent, "Untitled");
    protyle.block.rootID = "box";
    input.value = "Notebook / literal **title**";
    update(protyle);
    readonly(protyle);
    check.equal(input.classList.contains("fn__none"), true);
    check.equal(label.classList.contains("fn__none"), false);
    check.equal(input.readOnly, true);
    const notebookRequest = pending.find(request => request.id === "box");
    check.ok(notebookRequest, "notebook documents load their complete title source");
    notebookRequest.reply(response('<span data-type="strong">Notebook</span> <span class="img"><img alt="Picture"></span>'));
    check.equal(label.querySelector('[data-type="strong"]').textContent, "Notebook");
    check.ok(label.querySelector("img"));
    return "Mobile document title cases passed";
};

test("mobile navigation edits rich titles inline, keeps compact previews and clears stale or locked content", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 30000,
}, async () => {
    const source = (file: string) => transpileModule(readFileSync(resolve(__dirname, file), "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    const sources = {title: source("mobileDocumentTitle.ts"), preview: source("../../protyle/header/documentTitlePreview.ts"),
        toolbar: source("../../protyle/toolbar/index.ts"), position: source("../../util/setPosition.ts"),
        selectionPosition: source("../../protyle/toolbar/selectionElementPosition.ts"),
        readonly: source("../../protyle/util/setEditMode.ts"),
        editorTitle: transpileModule(require("ifdef-loader/preprocessor").parse(
            readFileSync(resolve(__dirname, "../../protyle/header/Title.ts"), "utf8"), {MOBILE: true, BROWSER: false}),
        {compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021}}).outputText,
        css: compile(resolve(__dirname, "../../assets/scss/mobile.scss"), {logger: {warn() {}, debug() {}}}).css};
    const directory = mkdtempSync(resolve(tmpdir(), "siyuan-mobile-title-"));
    const script = resolve(directory, "run.cjs");
    const code = "const __name = value => value; (" + browserCases.toString() + ")(" + JSON.stringify(sources) + ")";
    writeFileSync(script, `const {app,BrowserWindow}=require("electron");
app.setPath("userData", ${JSON.stringify(resolve(directory, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,width:390,height:800,webPreferences:{nodeIntegration:true,contextIsolation:false}});
 win.webContents.on("console-message",event=>console.error(event.message));
 try{await win.loadURL("data:text/html,<html><body></body></html>");
 console.log(await win.webContents.executeJavaScript(${JSON.stringify(code)}));win.destroy();app.exit(0);
 }catch(error){console.error(error);win.destroy();app.exit(1);}
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron") as unknown as string, [script],
            {env, windowsHide: true, timeout: 25000});
        assert.match(result.stdout, /Mobile document title cases passed/);
    } finally {
        if (resolve(directory, "..") === resolve(tmpdir()) && directory.startsWith(resolve(tmpdir(), "siyuan-mobile-title-"))) {
            rmSync(directory, {recursive: true, force: true});
        }
    }
});
