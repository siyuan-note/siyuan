import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {test} from "node:test";
import * as path from "node:path";
import {promisify} from "node:util";
import {compile as compileSass} from "sass";
import {createSourceFile, isIfStatement, Node, ScriptTarget, transpileModule} from "typescript";

const browserCases = async () => {
    const check = require("node:assert/strict");
    const api = (window as unknown as {focusTest: {
        tabsRender: (root: HTMLElement, options: {readonly: () => boolean}) => void;
        destroyTabsRender: (root: HTMLElement) => void;
        restorePendingFocus: (root: HTMLElement, id: string, range: Range, restored: boolean, removed: boolean) => number;
        canRestoreEditorFocus: (root: HTMLElement) => boolean;
        getEditorFocusRange: (root: HTMLElement, range: Range) => Range;
        restoreEditorFocusRange: (root: HTMLElement, range: Range) => boolean;
    }}).focusTest;
    for (const wrapped of [false, true]) {
        for (const empty of [false, true]) {
            const editor = document.createElement("div");
            editor.className = "protyle-wysiwyg";
            editor.contentEditable = "true";
            document.body.append(editor);
            const title = '<span class="tab-item-title callout-title" contenteditable="true">' +
                (empty ? "" : "11") + "</span>";
            editor.innerHTML = '<div class="tabs" data-type="NodeTabs" data-node-id="tabs">' +
                '<div class="tab-item" data-type="NodeTabItem" data-node-id="item">' +
                '<div class="tab-item-info" contenteditable="false">' + (wrapped ?
                    '<div data-node-id="title" data-type="NodeParagraph" tabs-title="true">' + title + "</div>" : title) +
                '</div><div class="tab-item-content"><div contenteditable="true">Body</div></div></div></div>';
            try {
                const titleElement = editor.querySelector<HTMLElement>(".tab-item-title");
                const item = editor.querySelector<HTMLElement>(".tab-item");
                item.dataset.tabsEditing = "true";
                api.tabsRender(editor, {readonly: () => false});
                titleElement.focus();
                const range = document.createRange();
                range.selectNodeContents(titleElement);
                range.collapse(false);
                getSelection().removeAllRanges();
                getSelection().addRange(range);
                // 删除引用的异步收集项预检会暂时清空选区并使编辑器 inert。
                for (let repeat = 0; repeat < 2; repeat++) {
                    const saved = api.getEditorFocusRange(editor, getSelection().getRangeAt(0));
                    getSelection().removeAllRanges();
                    editor.inert = true;
                    await new Promise(resolve => setTimeout(resolve, 60));
                    check.equal(item.dataset.tabsEditing, "false");
                    check.equal(titleElement.getClientRects().length, 0);
                    editor.inert = false;
                    check.equal(api.restoreEditorFocusRange(editor, saved), true);
                    check.equal(document.activeElement, titleElement, "restore must focus the visible title");
                    check.equal(item.dataset.tabsEditing, "true");
                    check.ok(titleElement.contains(getSelection().anchorNode));
                    // 原生插入验证恢复的选区可以继续编辑，而非仅返回 true。
                    document.execCommand("insertText", false, "x");
                    check.equal(titleElement.textContent, (empty ? "" : "11") + "x".repeat(repeat + 1));
                    check.equal(editor.querySelector(".tab-item-content").textContent, "Body");
                }
                const saved = api.getEditorFocusRange(editor, getSelection().getRangeAt(0));
                check.equal(api.canRestoreEditorFocus(editor), true);
                editor.style.display = "none";
                check.equal(api.canRestoreEditorFocus(editor), false, "hidden document must not regain focus");
                check.equal(api.restorePendingFocus(editor, "item", saved, true, false), 0);
                editor.style.display = "";
                const other = document.createElement("div");
                other.contentEditable = "true";
                document.body.append(other);
                other.focus();
                check.equal(api.canRestoreEditorFocus(editor), false, "another editor owns focus");
                check.equal(api.restorePendingFocus(editor, "item", saved, false, true), 0);
                other.remove();
                item.dataset.tabsHidden = "true";
                check.equal(api.restoreEditorFocusRange(editor, saved), false);
                for (const flags of [[true, false], [false, true], [false, false]]) {
                    check.equal(api.restorePendingFocus(editor, "item", saved, flags[0], flags[1]), 0);
                }
                item.dataset.tabsHidden = "false";
                api.tabsRender(editor, {readonly: () => true});
                check.equal(api.restoreEditorFocusRange(editor, saved), false, "readonly titles stay readonly");
                check.equal(api.restorePendingFocus(editor, "item", saved, true, false), 0);
                api.tabsRender(editor, {readonly: () => false});
                const ancestor = document.createElement("div");
                ancestor.className = "tab-item";
                ancestor.dataset.tabsHidden = "true";
                editor.before(ancestor);
                ancestor.append(editor);
                check.equal(api.restoreEditorFocusRange(editor, saved), false, "hidden ancestor stays hidden");
                ancestor.before(editor);
                ancestor.remove();
                api.destroyTabsRender(editor);
                editor.replaceChildren(item);
                item.querySelector(".tab-item-info").classList.remove("tabs-title-editor");
                saved.selectNodeContents(titleElement);
                saved.collapse(false);
                check.equal(api.restoreEditorFocusRange(editor, saved), true, "standalone focused item needs no controller");
                const replacement = item.cloneNode(true);
                item.replaceWith(replacement);
                check.equal(api.restorePendingFocus(editor, "item", saved, true, false), 1,
                    "reloaded item is resolved by stable ID");
                replacement.remove();
                check.equal(api.restorePendingFocus(editor, "item", saved, true, false), 0,
                    "removed item must not trigger fallback");
            } finally {
                api.destroyTabsRender(editor);
                editor.remove();
            }
        }
    }
    return "tab-title-focus-restored";
};

test("restores tab title editing after asynchronous collection-removal focus suspension", {timeout: 45000}, async () => {
    const files = ["src/util/escape.ts", "src/protyle/render/tabsState.ts", "src/protyle/render/tabsDrag.ts",
        "src/protyle/render/tabsAttributes.ts", "src/protyle/render/tabsVisibility.ts",
        "src/protyle/render/tabsRender.ts", "src/protyle/util/editorFocus.ts"];
    const transactionFile = "src/protyle/wysiwyg/transaction.ts";
    const ast = createSourceFile(transactionFile, readFileSync(transactionFile, "utf8"), ScriptTarget.ES2021, true);
    let restoreBranch: string;
    const visit = (node: Node) => {
        if (isIfStatement(node) && node.expression.getText(ast).includes("canRestoreEditorFocus(editor)")) {
            restoreBranch = node.getText(ast);
        }
        node.forEachChild(visit);
    };
    visit(ast);
    assert.ok(restoreBranch);
    const pendingSource = transpileModule(`const restorePendingFocus = (editor, focusTitleItemID, focusRange, sourceRestored, entriesRemoved) => {
        let calls = 0; const protyle = {disabled: false, wysiwyg: {element: editor}};
        const wasDisabled = false, wasInert = false, isCurrent = () => true;
        const focusContext = {undoFocusId: "item"}; const restoreUndoFocus = () => calls++;
        ${restoreBranch}
        return calls;
    };`, {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;
    const source = files.map(file => transpileModule(readFileSync(file, "utf8")
        .replace(/^import [\s\S]*?;\r?\n/gm, "").replace(/^export /gm, ""),
    {compilerOptions: {target: ScriptTarget.ES2021}}).outputText).join("\n");
    const css = compileSass("src/assets/scss/protyle/_tabs.scss").css;
    const directory = mkdtempSync(path.join(tmpdir(), "siyuan-tab-focus-"));
    const script = path.join(directory, "main.cjs");
    const renderer = `${source}\n${pendingSource}\nwindow.focusTest={tabsRender,destroyTabsRender,getEditorFocusRange,restoreEditorFocusRange,canRestoreEditorFocus,restorePendingFocus};
        const style=document.createElement('style');style.textContent=${JSON.stringify(css)};document.head.append(style);
        const __name=value=>value; (${browserCases.toString()})()`;
    writeFileSync(script, `const {app,BrowserWindow}=require('electron');
app.setPath('userData',${JSON.stringify(path.join(directory, "profile"))});app.disableHardwareAcceleration();
app.whenReady().then(async()=>{const win=new BrowserWindow({show:false,webPreferences:{nodeIntegration:true,
contextIsolation:false,offscreen:true,backgroundThrottling:false}});try{await win.loadURL('about:blank');
win.webContents.debugger.attach('1.3');await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true});
console.log(await win.webContents.executeJavaScript(${JSON.stringify(renderer)}));app.exit(0);
}catch(error){console.error(error);app.exit(1)}});`);
    const env: NodeJS.ProcessEnv = {...process.env, XDG_CACHE_HOME: path.join(directory, "cache")};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const args = process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY ?
            ["--no-sandbox", "--ozone-platform=headless", script] : [script];
        const result = await promisify(execFile)(require("electron") as unknown as string, args,
            {env, timeout: 40000, windowsHide: true});
        assert.match(result.stdout, /tab-title-focus-restored/);
    } finally {
        rmSync(directory, {recursive: true, force: true});
    }
});
