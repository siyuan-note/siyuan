import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {createSourceFile, isVariableStatement, ScriptTarget, transpileModule} from "typescript";

const compile = (source: string) => transpileModule(source
    .replace(/^import [\s\S]*?;\r?\n/gm, "").replace(/^export /gm, ""), {
    compilerOptions: {target: ScriptTarget.ES2021},
}).outputText;

const browserCases = (source: string) => {
    const check = require("node:assert/strict");
    const editor = document.createElement("div");
    editor.className = "protyle-wysiwyg";
    editor.contentEditable = "true";
    document.body.append(editor);
    const requests: string[] = [];
    const api = new Function("hasClosestBlock", "getAtomicVerticalNavigationOwner", source +
        "return {focusBlock, tabsRender, destroyTabsRender};")(
        (node: Node) => (node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement)?.closest("[data-node-id]"),
        (): undefined => undefined);
    api.tabsRender(editor, {readonly: () => false, select: (_tabs: Element, id: string) => requests.push(id)});
    const tab = (id: string, content: string) => `<div class="tab-item" data-type="NodeTabItem" data-node-id="${id}">` +
        '<div class="tab-item-info"><div class="tab-item-title">Title</div></div>' +
        `<div class="tab-item-content">${content}</div></div>`;
    const paragraph = (id: string) => `<div data-type="NodeParagraph" data-node-id="${id}">` +
        `<div contenteditable="true">${id}</div></div>`;
    const tabs = (active: string, nested = false) => `<div class="tabs" data-type="NodeTabs" data-node-id="group" tabs-active-id="${active}">` +
        tab("first", nested ? '<div class="tabs" data-type="NodeTabs" data-node-id="inner" tabs-active-id="inner-first">' +
            tab("inner-first", paragraph("nested-visible")) + tab("inner-last", paragraph("nested-hidden")) + "</div>" :
            paragraph("visible")) + tab("last", paragraph("hidden")) + "</div>";
    for (const [active, nested, expected] of [
        ["first", false, "visible"], ["last", false, "hidden"], ["missing", false, "visible"],
        ["first", true, "nested-visible"],
    ] as const) {
        editor.innerHTML = tabs(active, nested);
        const pasted = editor.firstElementChild;
        // 同步粘贴流程在 MutationObserver 执行前定位，所有正文此时都有布局宽度。
        check.ok(pasted.querySelector('[data-node-id="hidden"]').getBoundingClientRect().width > 0);
        api.focusBlock(pasted, undefined, false);
        const selected = getSelection().focusNode;
        check.ok(editor.querySelector(`[data-node-id="${expected}"]`).contains(selected));
        check.deepEqual(requests, [], "focusing a pasted group must not save attributes before insertion");
        check.equal(pasted.getAttribute("tabs-active-id"), active);
    }
    // 已渲染的阅读选择可以覆盖持久选择，定位继续遵循当前可见页。
    editor.innerHTML = tabs("first");
    editor.querySelector('[data-node-id="first"]').setAttribute("data-tabs-hidden", "true");
    editor.querySelector('[data-node-id="last"]').setAttribute("data-tabs-hidden", "false");
    api.focusBlock(editor.firstElementChild, undefined, false);
    check.ok(editor.querySelector('[data-node-id="hidden"]').contains(getSelection().focusNode));
    api.destroyTabsRender(editor);
    editor.remove();
    return "tabs-focus-ok";
};

test("pasted tabs keep their active page before rendering and do not persist premature switches", {timeout: 30000}, async () => {
    const selectionFile = "src/protyle/util/selection.ts";
    const ast = createSourceFile(selectionFile, readFileSync(selectionFile, "utf8"), ScriptTarget.Latest, true);
    const names = ["focusBlock", "getEditorRange", "setFirstNodeRange"];
    const selection = ast.statements.filter(statement => isVariableStatement(statement) &&
        statement.declarationList.declarations.some(declaration => names.includes(declaration.name.getText(ast))));
    assert.equal(selection.length, names.length);
    const source = ["src/util/escape.ts", "src/protyle/render/tabsState.ts", "src/protyle/render/tabsDrag.ts",
        "src/protyle/render/tabsAttributes.ts", "src/protyle/render/tabsRender.ts", "src/protyle/render/tabsVisibility.ts",
        "src/protyle/wysiwyg/getBlock.ts", "src/protyle/util/selectionOffsets.ts"]
        .map(file => compile(readFileSync(file, "utf8"))).join("\n") +
        compile(selection.map(statement => statement.getText(ast)).join("\n"));
    const directory = mkdtempSync(path.join(tmpdir(), "siyuan-tabs-focus-"));
    const script = path.join(directory, "main.cjs");
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(directory, "profile"))});
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true}});
    try {
        await win.loadURL("about:blank");
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(
        `const __name = value => value; (() => {try {return (${browserCases.toString()})(${JSON.stringify(source)});}
catch (error) {return error.stack;}})()`)}));
        app.exit(0);
    } catch (error) { console.error(error); app.exit(1); }
});`);
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron") as unknown as string, [script],
            {env, timeout: 25000, windowsHide: true});
        assert.match(result.stdout, /tabs-focus-ok/);
    } finally {
        assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
        rmSync(directory, {recursive: true, force: true});
    }
});
