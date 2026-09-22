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
        "; return {CopyEditor, expandQueryEmbedsForClipboard, getPlainText};")(...Object.values(dependencies));
    window.siyuan = {config: {editor: {}}, ctrlIsPressed: false} as unknown as typeof window.siyuan;
    const lute = Lute.New();
    lute.SetTextMark(true);
    lute.SetSuperBlock(true);
    lute.SetKramdownIAL(true);
    lute.SetProtyleWYSIWYG(true);
    lute.SetUnorderedListMarker("-");
    const paragraph = (text: string) => lute.Md2BlockDOM(text);
    const result = (html: string) => `<div class="protyle-wysiwyg__embed" data-id="result">
<div class="protyle-icons">BUTTON</div><div class="protyle-breadcrumb">BREADCRUMB</div>${html}</div>`;
    const embed = (html: string) => `<div data-type="NodeBlockQueryEmbed" data-node-id="${Lute.NewNodeID()}"
class="render-node" data-content="select * from blocks"><div class="protyle-icons">RELOAD</div>${html}
<div class="protyle-attr">ATTRIBUTE</div></div>`;
    const root = document.createElement("div");
    root.className = "protyle-wysiwyg";
    document.body.append(root);
    const editor = new api.CopyEditor();
    editor.element = root;
    editor.bindCopy({wysiwyg: editor, lute, toolbar: {getCurrentType: (): string[] => []}, notebookId: "notebook"});

    const copy = async (html: string, blocks = false, rich = false, select?: (root: HTMLElement, range: Range) => void) => {
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
        root.dispatchEvent(new ClipboardEvent("copy", {bubbles: true, cancelable: true, clipboardData}));
        await new Promise(resolve => setTimeout(resolve, 0));
        check.equal(root.innerHTML, before, "copy must preserve the live document and rendered results");
        const external = clipboardData.getData("text/html").replace(/<!--data-siyuan='[^']*'-->/, "");
        check.doesNotMatch(external, /select \*|BUTTON|BREADCRUMB|RELOAD|ATTRIBUTE|QUERY ERROR/);
        check.doesNotMatch(clipboardData.getData("text/plain"), /select \*|BUTTON|BREADCRUMB|RELOAD|ATTRIBUTE|QUERY ERROR/);
        return {plain: clipboardData.getData("text/plain"), html: external, siyuan: clipboardData.getData("text/siyuan")};
    };

    const mixed = paragraph("Before") + embed(result(paragraph("Embedded **bold**"))) + paragraph("After");
    const mixedCopy = await copy(mixed);
    check.equal(mixedCopy.plain, "Before\nEmbedded bold\nAfter");
    check.match(mixedCopy.html, /bold<\/(?:span|strong)>/);
    check.match(mixedCopy.siyuan, /NodeBlockQueryEmbed/);
    check.match(mixedCopy.siyuan, /select \* from blocks/);
    check.match(lute.BlockDOM2StdMd(mixedCopy.siyuan), /select \* from blocks/);
    const selected = await copy(mixed, true);
    check.equal(selected.plain, "Before\n\nEmbedded **bold**\n\nAfter");
    check.match(selected.siyuan, /NodeBlockQueryEmbed/);
    const rich = await copy(mixed, true, true);
    check.match(rich.html, /<strong>bold<\/strong>/);
    check.match(rich.siyuan, /NodeBlockQueryEmbed/);

    const multiple = embed(result(paragraph("First")) + result(paragraph("Second")));
    check.equal((await copy(multiple, true)).plain, "First\n\nSecond");
    check.equal((await copy(multiple)).plain, "First\nSecond", "selection across result wrappers excludes breadcrumbs");
    const nested = embed(result(paragraph("Outer") + embed(result(paragraph("Inner")))));
    check.equal((await copy(nested, true)).plain, "Outer\n\nInner");
    const list = lute.Md2BlockDOM("- List item");
    const holder = document.createElement("div");
    holder.innerHTML = list;
    holder.querySelector('[data-type="NodeListItem"]').insertAdjacentHTML("beforeend", nested);
    check.equal(api.getPlainText(holder.firstElementChild), "List item\nOuter\nInner\n");
    check.equal((await copy(holder.innerHTML, true)).plain.match(/Inner/g)?.length, 1);

    const partial = await copy(mixed, false, false, (element, range) => {
        range.setStart(element.querySelector("[spellcheck]").firstChild, 2);
        range.setEnd(element.querySelector(".protyle-wysiwyg__embed [spellcheck]").firstChild, 5);
    });
    check.equal(partial.plain, "fore\nEmbed");
    check.doesNotMatch(partial.html, /After|bold/);
    const partialEnd = await copy(mixed, false, false, (element, range) => {
        range.setStart(element.querySelector(".protyle-wysiwyg__embed [spellcheck]").firstChild, 3);
        range.setEnd(element.lastElementChild.querySelector("[spellcheck]").firstChild, 2);
    });
    check.equal(partialEnd.plain, "edded bold\nAf");
    check.doesNotMatch(partialEnd.html, /Before|After/);
    const within = await copy(mixed, false, false, (element, range) => {
        const text = element.querySelector(".protyle-wysiwyg__embed [spellcheck]").firstChild;
        range.setStart(text, 1);
        range.setEnd(text, 4);
    });
    check.equal(within.plain, "mbe");

    const formatted = embed(result(paragraph("### Heading\n\n- Item\n\n```js\nconst answer = 42;\n```\n\n![Image](assets/image.png)")));
    const formattedCopy = await copy(formatted, true);
    check.match(formattedCopy.plain, /### Heading/);
    check.match(formattedCopy.plain, /- Item/);
    check.match(formattedCopy.plain, /```js\nconst answer = 42;/);
    check.match(formattedCopy.plain, /!\[Image\]\(assets\/image.png\)/);

    for (const content of ["", '<div class="protyle-wysiwyg__embed">QUERY ERROR</div>']) {
        const empty = embed(content);
        check.equal((await copy(empty, true)).plain, "");
        check.match((await copy(empty, true)).siyuan, /NodeBlockQueryEmbed/);
        check.equal((await copy(paragraph("Before") + empty + paragraph("After"))).plain, "Before\nAfter");
    }
    const ordinary = paragraph("Ordinary **bold**");
    check.equal(api.expandQueryEmbedsForClipboard(ordinary), ordinary);
    check.equal((await copy(ordinary, true)).plain, "Ordinary **bold**");
    root.remove();
    return "Query embed clipboard cases passed";
};

test("query embed copy exports selected results while preserving internal embeds", {
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
    const source = ["queryEmbedClipboard.ts", "hasClosest.ts", "normalizeText.ts", "inlineElementBoundary.ts",
        "inlineElementMarker.ts", "../wysiwyg/removeEmbed.ts"].map(compileModule).join("\n") +
        extract("paste.ts", ["getPlainText", "normalizeVirtualBlockRef"]) +
        compile(`class CopyEditor {${methods.map(method => method.getText(sourceFile)).join("\n")}
bindCopy(protyle) {${copy}}}`);
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-query-embed-clipboard-"));
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
        assert.match(result.stdout, /Query embed clipboard cases passed/);
    } finally {
        if (path.dirname(path.resolve(temporary)) === path.resolve(tmpdir()) &&
            path.basename(temporary).startsWith("siyuan-query-embed-clipboard-")) {
            rmSync(temporary, {recursive: true, force: true});
        }
    }
});
