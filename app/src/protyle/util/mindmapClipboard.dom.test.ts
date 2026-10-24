import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import * as ts from "typescript";

const compile = (source: string) => ts.transpileModule(source
    .replace(/^import [\s\S]*?;\r?\n/gm, "").replace(/^export /gm, ""), {
    compilerOptions: {target: ts.ScriptTarget.ES2021},
}).outputText;

const browserCases = async (source: string, copyBinding: string, cutBinding: string, css: string, lutePath: string) => {
    const check = require("node:assert/strict");
    require(lutePath);
    const identity = (value: string) => value;
    const noop = (): void => undefined;
    let clipboardFailed = false;
    let cutCount = 0;
    let cutData: {textSiyuan: string};
    const errors: string[] = [];
    window.addEventListener("unhandledrejection", event => errors.push(String(event.reason?.stack || event.reason)));
    const closestBlock = (node: Node) => (node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement)
        ?.closest("[data-node-id]");
    const dependencies = {
        isIOSPlatform: () => false,
        Constants: {ZWSP: "\u200b"},
        getTextWithoutSemanticMarkers: (element: Element) => element?.textContent || "",
        getAVTemplateInteractiveElement: () => false,
        getEditorRange: () => getSelection().getRangeAt(0),
        stripSemanticMarkersFromRangeText: (range: Range) => range.toString(),
        hasClosestBlock: closestBlock,
        hasClosestByTag: (): null => null,
        hasClosestByClassName: (): null => null,
        isInEmbedBlock: (): false => false,
        getTopAloneElement: (element: Element) => element,
        getNextBlock: (): false => false,
        confirmBlockRef: async () => true,
        focusBlock: noop,
        showMessage: noop,
        writeClipboardData: async (data: {textSiyuan: string}) => {
            cutData = data;
            return {status: clipboardFailed ? "failed" : "success"};
        },
        removeBlockPreservingSelectionMode: async (_owner: IProtyle, element: Element) => {
            cutCount++;
            element.remove();
            return true;
        },
        getBlockSelectionModeElement: (): null => null,
        getAVSelectedCells: (): Element[] => [],
        isTableLikeView: () => false,
        BLOCK_SELECTION_CLASS: "protyle-wysiwyg--select",
        removeEmbed: (element: Element) => element.outerHTML,
        preserveCopiedTabTask: (_element: Element, html: string) => html,
        cleanBlockSelectionModeHTML: identity, sanitizeViewFoldHTML: identity,
        expandQueryEmbedsForClipboard: identity, transformSemanticInlineHTML: identity,
        normalizeSemanticInlineHTML: identity, removeZWJ: identity, nbsp2space: identity,
        enableLuteMarkdownSyntax: noop, restoreLuteMarkdownSyntax: noop,
        prepareExternalClipboardHTML: identity,
        prepareRichClipboardHTML: (html: string) => ({html, source: html}),
        encodeBase64: (value: string) => btoa(unescape(encodeURIComponent(value))),
        enhanceRichClipboard: noop,
    };
    const api = new Function(...Object.keys(dependencies), source +
        "return {copyBlockSelection, getPlainText, cutSingle, cutMultiple, bindCopy: function(protyle) {" +
        copyBinding + "}, bindCut: function(protyle) {" + cutBinding + "}};")(
        ...Object.values(dependencies));
    window.siyuan = {ctrlIsPressed: false, languages: {clipboardPermissionDenied: "Clipboard denied"}} as unknown as typeof window.siyuan;
    const style = document.createElement("style");
    style.textContent = css;
    document.head.append(style);
    const editor = document.createElement("div");
    editor.className = "protyle-wysiwyg";
    editor.contentEditable = "true";
    document.body.append(editor);
    const outside = document.createElement("textarea");
    document.body.append(outside);
    const lute = Lute.New();
    lute.SetKramdownIAL(true);
    lute.SetProtyleWYSIWYG(true);
    const wysiwyg = {element: editor, copyAsRichText: false};
    api.bindCopy.call(wysiwyg, {lute, wysiwyg, disabled: false});
    api.bindCut.call(wysiwyg, {lute, wysiwyg, disabled: false, hint: {render: noop}, options: {render: {breadcrumb: false}}});
    for (const exported of [false, true]) {
        editor.innerHTML = lute.Md2BlockDOM("- Root\n  - Child\n{: custom-sy-list-mindmap=\"1\"}\n");
        const map = editor.firstElementChild as HTMLElement;
        map.dataset.type = "NodeMindmap";
        map.classList.add("protyle-wysiwyg--select");
        map.querySelectorAll('[data-type="NodeListItem"]').forEach(item => {
            item.setAttribute("data-type", "NodeMindmapItem");
            item.classList.toggle("mindmap-item", !exported);
            item.classList.toggle("li", exported);
        });
        const host = document.createElement("div");
        host.className = "mindmap-view";
        host.contentEditable = "false";
        host.tabIndex = 0;
        host.innerHTML = '<div data-node-id="derived" data-type="NodeParagraph"><div spellcheck="false">Derived duplicate</div></div>';
        host.addEventListener("copy", event => event.stopPropagation());
        map.append(host);
        map.dataset.mindmapViewRendered = "true";
        const before = map.outerHTML;
        check.equal(getComputedStyle(map.firstElementChild).display, "none", "image export must hide source items too");
        check.notEqual(getComputedStyle(host).display, "none");
        check.equal(api.getPlainText(map).trimEnd(), "Root\nChild");
        check.equal(api.getPlainText(map.firstElementChild).trimEnd(), "Root\nChild");
        for (const rich of [false, true]) {
            outside.focus();
            const saved = document.createRange();
            saved.selectNodeContents(outside);
            getSelection().removeAllRanges();
            getSelection().addRange(saved);
            wysiwyg.copyAsRichText = rich;
            const data = new DataTransfer();
            let consumed = false;
            api.copyBlockSelection(map, () => {
                check.equal(document.activeElement, editor, "whole-map copy must reach the outer editor");
                const event = new ClipboardEvent("copy", {bubbles: true, cancelable: true, clipboardData: data});
                document.activeElement.dispatchEvent(event);
                consumed = event.defaultPrevented;
            });
            check.equal(consumed, true);
            check.match(data.getData("text/siyuan"), /NodeMindmap/);
            check.match(data.getData("text/siyuan"), /Child/);
            check.doesNotMatch(data.getData("text/siyuan"), /mindmap-view|Derived duplicate/);
            check.match(data.getData("text/html"), /Child/);
            check.match(data.getData("text/plain"), /Root/);
            check.equal(map.outerHTML, before, "copy must preserve the source and rendered view");
        }
    }
    for (const cut of [api.cutSingle, api.cutMultiple]) {
        for (const fail of [true, false]) {
            editor.innerHTML = lute.Md2BlockDOM("- Root\n  - Child\n{: custom-sy-list-mindmap=\"1\"}\n");
            const map = editor.firstElementChild as HTMLElement;
            map.dataset.type = "NodeMindmap";
            map.classList.add("protyle-wysiwyg--select");
            map.querySelectorAll('[data-type="NodeListItem"]').forEach(item => item.setAttribute("data-type", "NodeMindmapItem"));
            map.dataset.mindmapViewRendered = "true";
            map.insertAdjacentHTML("beforeend", '<div class="mindmap-view" contenteditable="false" tabindex="0">Rendered map</div>');
            outside.focus();
            getSelection().removeAllRanges();
            const saved = document.createRange();
            saved.selectNodeContents(outside);
            getSelection().addRange(saved);
            clipboardFailed = fail;
            cutData = undefined;
            const before = cutCount;
            cut(map);
            await new Promise(resolve => setTimeout(resolve, 20));
            check.deepEqual(errors, []);
            check.ok(cutData, "menu cut reaches the editor even when native cutting has no editable target");
            check.equal(cutCount, before + (fail ? 0 : 1), "menu cut deletes only after clipboard success");
            check.equal(map.isConnected, fail, "clipboard failure preserves the whole map");
            check.match(cutData.textSiyuan, /NodeMindmap/);
            check.match(cutData.textSiyuan, /Child/);
            check.doesNotMatch(cutData.textSiyuan, /mindmap-view|Rendered map/);
        }
    }
    editor.remove();
    outside.remove();
    return "mindmap-clipboard-ok";
};

test("mind map block copy and cut reach the editor and preserve content on clipboard failure", {timeout: 30000}, async () => {
    const model = readFileSync("src/protyle/render/listMindmap/model.ts", "utf8");
    const paste = ts.createSourceFile("paste.ts", readFileSync("src/protyle/util/paste.ts", "utf8"), ts.ScriptTarget.Latest, true);
    const plain = paste.statements.find(statement => ts.isVariableStatement(statement) &&
        statement.declarationList.declarations.some(item => item.name.getText(paste) === "getPlainText"));
    const wysiwyg = ts.createSourceFile("index.ts", readFileSync("src/protyle/wysiwyg/index.ts", "utf8"), ts.ScriptTarget.Latest, true);
    let binding: ts.CallExpression;
    let cutBinding: ts.CallExpression;
    const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node) && node.expression.getText(wysiwyg) === "this.element.addEventListener" &&
            node.arguments[0]?.getText(wysiwyg) === '"copy"') {
            binding = node;
        }
        if (ts.isCallExpression(node) && node.expression.getText(wysiwyg) === "this.element.addEventListener" &&
            node.arguments[0]?.getText(wysiwyg) === '"cut"') {
            cutBinding = node;
        }
        node.forEachChild(visit);
    };
    visit(wysiwyg);
    assert.ok(binding);
    assert.ok(cutBinding);
    const gutter = ts.createSourceFile("gutter.ts", readFileSync("src/protyle/gutter/index.ts", "utf8"), ts.ScriptTarget.Latest, true);
    const cutMenus: string[] = [];
    const visitMenu = (node: ts.Node) => {
        if (ts.isObjectLiteralExpression(node) && node.properties.some(property =>
            property.name?.getText(gutter) === "id" && ts.isPropertyAssignment(property) && property.initializer.getText(gutter) === '"cut"')) {
            const click = node.properties.find(property => property.name?.getText(gutter) === "click") as ts.PropertyAssignment;
            const text = click.initializer.getText(gutter);
            cutMenus.push(`function ${text.includes("selectsElement") ? "cutMultiple(selectsElement)" : "cutSingle(nodeElement)"} { (${text})(); }`);
        }
        node.forEachChild(visitMenu);
    };
    visitMenu(gutter);
    assert.equal(cutMenus.length, 2);
    cutMenus[0] = cutMenus[0].replace("cutMultiple(selectsElement)", "cutMultiple(element)").replace("{ (", "{ const selectsElement = [element]; (");
    const source = compile(model.slice(model.indexOf("const cleanListMindmapDOM ="),
        model.indexOf("// 转换前将思维导图块"))) + compile(plain.getText(paste)) +
        compile(readFileSync("src/protyle/util/blockClipboard.ts", "utf8")) + compile(cutMenus.join("\n"));
    const css = require("sass").compile("src/assets/scss/protyle/_mindmap-view.scss").css;
    const directory = mkdtempSync(path.join(tmpdir(), "siyuan-mindmap-copy-"));
    const script = path.join(directory, "main.cjs");
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(directory, "profile"))});
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true}});
    try {
        await win.loadURL("about:blank");
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(
        `const __name = value => value; (() => {try {return (${browserCases.toString()})(${JSON.stringify(source)},
${JSON.stringify(compile(binding.getText(wysiwyg)))}, ${JSON.stringify(compile(cutBinding.getText(wysiwyg)))}, ${JSON.stringify(css)},
${JSON.stringify(path.resolve("stage/protyle/js/lute/lute.min.js"))});} catch (error) {return error.stack;}})()`)}));
        app.exit(0);
    } catch (error) { console.error(error); app.exit(1); }
});`);
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron") as unknown as string, [script],
            {env, timeout: 25000, windowsHide: true});
        assert.match(result.stdout, /mindmap-clipboard-ok/);
    } finally {
        assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
        rmSync(directory, {recursive: true, force: true});
    }
});
