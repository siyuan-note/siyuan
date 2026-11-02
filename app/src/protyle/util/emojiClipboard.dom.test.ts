import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {promisify} from "node:util";
import test from "node:test";
import {createSourceFile, isClassDeclaration, isMethodDeclaration, isVariableStatement, ScriptTarget, transpileModule} from "typescript";

const compile = (source: string) => transpileModule(source.replace(/^import [\s\S]*?;\r?\n/gm, "")
    .replace(/^export /gm, ""), {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;

const read = (file: string) => readFileSync(path.join(__dirname, file), "utf8");
const compileModule = (file: string) => {
    const source = read(file);
    const names = Array.from(source.matchAll(/^export (?:const|function) (\w+)/gm), match => match[1]).join(", ");
    return `const {${names}} = (() => {${compile(source)}; return {${names}};})();`;
};
const extract = (file: string, names: string[]) => {
    const source = createSourceFile(file, read(file), ScriptTarget.Latest, true);
    const statements = source.statements.filter(statement => isVariableStatement(statement) &&
        statement.declarationList.declarations.some(declaration => names.includes(declaration.name.getText(source))));
    assert.equal(statements.length, names.length);
    return compile(statements.map(statement => statement.getText(source)).join("\n"));
};

const browserCases = async (source: string) => {
    const check = require("node:assert/strict");
    const identity = (html: string) => html;
    const dependencies = {
        getContenteditableElement: (element: Element) => element.querySelector('[contenteditable="true"]'),
        getUndoFocusContext: (): undefined => undefined,
        getSelectionOffset: () => ({end: 0}),
        fixAdjacentTags: () => {},
        focusByOffset: () => {},
        updateTransaction: () => {},
        dayjs: () => ({format: () => "20261101000000"}),
        getRangeBlockRefCheckTargets: (): {elements: HTMLElement[], exactIDs: string[], deletedIDs: string[]} =>
            ({elements: [], exactIDs: [], deletedIDs: []}),
        removeCrossBlockRange: async (_protyle: IProtyle, range: Range) => range.deleteContents(),
        Constants: {ZWSP: "\u200b"},
        BLOCK_SELECTION_CLASS: "protyle-wysiwyg--select",
        getEditorRange: () => getSelection().getRangeAt(0),
        getBlockSelectionModeElement: (): HTMLElement | null => null,
        getAVTemplateInteractiveElement: (): HTMLElement | null => null,
        getAVSelectedCells: (): HTMLElement[] => [],
        isTableLikeView: () => false,
        isNestedListCrossBlockSelection: () => false,
        cleanBlockSelectionModeHTML: identity,
        cleanListMindmapHTML: identity,
        sanitizeViewFoldHTML: identity,
        preserveCopiedTabTask: (_element: Element, html: string) => html,
        hasViewFoldContext: () => false,
        enableLuteMarkdownSyntax: () => {},
        restoreLuteMarkdownSyntax: () => {},
        prepareExternalClipboardHTML: identity,
        prepareRichClipboardHTML: (html: string) => ({html, source: html}),
        enhanceRichClipboard: () => {},
        encodeBase64: (value: string) => btoa(unescape(encodeURIComponent(value))),
        getTableCellPlainText: (element: Element) => element.textContent,
        countBlockWord: () => {},
    };
    const api = new Function(...Object.keys(dependencies), source +
        "; return {CopyEditor, pasteCrossBlockRange};")(...Object.values(dependencies));
    window.siyuan = {config: {editor: {}}, ctrlIsPressed: false} as unknown as typeof window.siyuan;
    const lute = Lute.New();
    lute.SetTextMark(true);
    lute.SetSuperBlock(true);
    lute.SetKramdownIAL(true);
    lute.SetProtyleWYSIWYG(true);
    lute.SetUnorderedListMarker("-");
    const paragraph = (text: string) => lute.Md2BlockDOM(text);
    const root = document.createElement("div");
    root.className = "protyle-wysiwyg";
    document.body.append(root);
    const editor = new api.CopyEditor();
    editor.element = root;
    const protyle = {wysiwyg: editor, lute, toolbar: {getCurrentType: (): string[] => []}, notebookId: "notebook",
        options: {render: {breadcrumb: false}}, hint: {render: () => {}}};
    editor.bindCopy(protyle);
    editor.bindCut(protyle);
    lute.PutEmojis({custom_clipboard: "/emojis/custom_clipboard.png"});

    const copy = async (html: string, blocks = false, rich = false, select?: (root: HTMLElement, range: Range) => void, cut = false) => {
        root.innerHTML = html;
        if (blocks) {
            Array.from(root.children).forEach(item => item.classList.add(dependencies.BLOCK_SELECTION_CLASS));
        }
        const range = document.createRange();
        const editables = root.querySelectorAll("[spellcheck]");
        if (select) {
            select(root, range);
        } else if (editables.length) {
            range.setStart(editables[0], 0);
            range.setEnd(editables[editables.length - 1], editables[editables.length - 1].childNodes.length);
        } else {
            range.selectNodeContents(root.firstElementChild);
        }
        getSelection().removeAllRanges();
        getSelection().addRange(range);
        const before = root.innerHTML;
        const clipboardData = new DataTransfer();
        editor.copyAsRichText = rich;
        root.dispatchEvent(new ClipboardEvent(cut ? "cut" : "copy", {bubbles: true, cancelable: true, clipboardData}));
        await new Promise(resolve => setTimeout(resolve, 0));
        if (!cut) {
            check.equal(root.innerHTML, before, "copy preserves the source document");
        } else {
            check.notEqual(root.innerHTML, before, "cut removes the selected contents after copying");
        }
        const external = clipboardData.getData("text/html").replace(/<!--data-siyuan='[^']*'-->/, "");
        return {plain: clipboardData.getData("text/plain"), html: external, siyuan: clipboardData.getData("text/siyuan")};
    };

    const imageCount = (html: string) => {
        const container = document.createElement("div");
        container.innerHTML = html;
        return container.querySelectorAll('img.emoji[src="/emojis/custom_clipboard.png"]').length;
    };
    const html = paragraph("First :custom_clipboard:") + paragraph("Second :custom_clipboard:");
    check.equal(imageCount(html), 2);
    const selected = await copy(html);
    check.equal(imageCount(selected.siyuan), 2, "cross-block copy preserves custom emoji nodes");
    check.equal(selected.plain, "First\nSecond", "plain text retains the existing cross-block selection semantics");
    check.equal(imageCount((await copy(html, true)).siyuan), 2, "whole-block copy keeps both emoji");
    check.equal(imageCount((await copy(html, false, true)).siyuan), 2, "rich copy also keeps internal emoji");
    const single = await copy(paragraph("First :custom_clipboard:"));
    check.equal(imageCount(single.siyuan), 1, "single-line copy keeps the image without needing reparsing");

    const partial = await copy(html, false, false, (element, range) => {
        const editables = element.querySelectorAll("[spellcheck]");
        range.setStart(editables[0].firstChild, 2);
        range.setEnd(editables[1], editables[1].childNodes.length);
    });
    check.equal(imageCount(partial.siyuan), 2, "partial boundary paragraphs keep both emoji");
    check.doesNotMatch(partial.siyuan, /First/);
    const cut = await copy(html, false, false, undefined, true);
    check.equal(imageCount(cut.siyuan), 2, "cross-block cut uses the same lossless copy path");

    for (const payload of [selected, partial, cut]) {
        root.innerHTML = paragraph("Target");
        const range = document.createRange();
        range.selectNodeContents(root.querySelector("[spellcheck]"));
        range.collapse(false);
        getSelection().removeAllRanges();
        getSelection().addRange(range);
        const fragment = document.createElement("div");
        fragment.innerHTML = Lute.Sanitize(payload.siyuan);
        check.equal(api.pasteCrossBlockRange(protyle, fragment, range, false), true);
        check.equal(imageCount(root.innerHTML), 2, "pasting immediately displays both custom emoji");
        check.doesNotMatch(root.textContent, /:custom_clipboard:/);
        check.equal(imageCount(lute.SpinBlockDOM(root.innerHTML)), 2, "subsequent editing preserves emoji");
    }
    root.remove();
    return "Emoji clipboard cases passed";
};

test("custom emoji survive cross-block copy, cut and paste", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 30000,
}, async () => {
    const sourceFile = createSourceFile("index.ts", read("../wysiwyg/index.ts"), ScriptTarget.Latest, true);
    const editor = sourceFile.statements.find(isClassDeclaration);
    const methods = editor.members.filter(member => isMethodDeclaration(member) &&
        ["emojiToMd", "clearAttrContent", "normalizeCrossBlockCopy"].includes(member.name.getText(sourceFile)));
    const bind = editor.members.find(member => isMethodDeclaration(member) &&
        member.name.getText(sourceFile) === "bindCommonEvent");
    assert.ok(bind && isMethodDeclaration(bind));
    const copy = bind.body.statements[0].getText(sourceFile);
    assert.match(copy, /addEventListener\("copy"/);
    let cut = "";
    const visit = (node: import("typescript").Node) => {
        if (node.getText(sourceFile).startsWith('this.element.addEventListener("cut",')) {
            cut = node.getText(sourceFile);
            return;
        }
        node.forEachChild(visit);
    };
    visit(sourceFile);
    assert.ok(cut);
    const source = ["queryEmbedClipboard.ts", "hasClosest.ts", "normalizeText.ts", "inlineElementBoundary.ts",
        "inlineElementMarker.ts", "../wysiwyg/removeEmbed.ts"].map(compileModule).join("\n") +
        extract("paste.ts", ["getPlainText", "normalizeVirtualBlockRef", "pasteCrossBlockRange"]) +
        compile(`class CopyEditor {${methods.map(method => method.getText(sourceFile)).join("\n")}
bindCopy(protyle) {${copy}} bindCut(protyle) {${cut}}}`);
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-emoji-clipboard-"));
    const script = path.join(temporary, "run.cjs");
    const lutePath = path.resolve(__dirname, "../../../stage/protyle/js/lute/lute.min.js");
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false}});
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        await win.webContents.executeJavaScript(require("node:fs").readFileSync(${JSON.stringify(lutePath)}, "utf8"));
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(
        `const __name = value => value; (${browserCases.toString()})(${JSON.stringify(source)})`)}));
        win.destroy();
        app.exit(0);
    } catch (error) {
        console.error(error);
        win.destroy();
        app.exit(1);
    }
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron") as unknown as string, [script],
            {env, timeout: 25000, windowsHide: true});
        assert.match(result.stdout, /Emoji clipboard cases passed/);
    } finally {
        if (path.dirname(path.resolve(temporary)) === path.resolve(tmpdir()) &&
            path.basename(temporary).startsWith("siyuan-emoji-clipboard-")) {
            rmSync(temporary, {recursive: true, force: true});
        }
    }
});
