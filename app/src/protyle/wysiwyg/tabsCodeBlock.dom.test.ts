import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {createSourceFile, isPropertyAssignment, Node, ScriptTarget, transpileModule} from "typescript";

const browserCases = async (source: string) => {
    const check = require("node:assert/strict");
    Object.assign(window, {siyuan: {config: {editor: {fontSize: 16, codeLineWrap: false,
        codeLigatures: false, codeSyntaxHighlightLineNum: true}}, languages: {}}});
    const api = new Function("Constants", "addScript", "setCodeTheme", "getContenteditableElement",
        "processRender", "avRender", "protyle", "measured", source +
        "\nreturn {highlightRender, tabsRender, destroyTabsRender, revealTabAncestors, shown};")(
        {PROTYLE_CDN: ""}, () => Promise.resolve(), () => {},
        (element: Element) => element.querySelector('[contenteditable="true"]'),
        () => {}, () => {}, {}, new WeakSet());
    const style = document.createElement("style");
    style.textContent = '.tab-item[data-tabs-hidden="true"] {display:none} ' +
        ".code-block {width:240px;font:16px/22px monospace} .hljs {position:relative;display:flex} " +
        '.hljs > [contenteditable="true"] {width:100%;box-sizing:border-box;white-space:pre} ' +
        ".protyle-linenumber__rows {position:absolute;font-size:85%} " +
        ".protyle-linenumber__rows > span {display:block;counter-increment:line} " +
        ".protyle-linenumber__rows > span::before {content:counter(line)} .fn__none {display:none}";
    document.head.append(style);
    const editor = document.createElement("div");
    editor.className = "protyle-wysiwyg";
    document.body.append(editor);
    const text = "const value = " + "1234567890".repeat(8) + ";\nvalue;\n";
    const code = (id: string, attrs = "") => `<div class="code-block" data-type="NodeCodeBlock" id="${id}" ${attrs}>` +
        '<div class="protyle-action"><span>javascript</span></div><div class="hljs">' +
        `<div contenteditable="false"></div><div contenteditable="true">${text}</div></div></div>`;
    const tab = (id: string, content: string) => `<div class="tab-item" data-node-id="${id}">` +
        `<div class="tab-item-info"><div class="tab-item-title">${id}</div></div>` +
        `<div class="tab-item-content">${content}</div></div>`;
    editor.innerHTML = '<div class="tabs" data-type="NodeTabs" data-node-id="outer">' +
        tab("first", code("first-code")) + tab("second", code("second-code") +
            code("wrapped-code", 'linewrap="true"') + code("disabled-code", 'linenumber="false"') +
            '<div class="tabs" data-type="NodeTabs" data-node-id="inner">' +
            tab("inner-first", code("inner-first-code")) + tab("inner-second", code("inner-second-code")) +
            "</div>") + "</div>";
    const waitForLayout = async () => {
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    };
    const rows = (id: string) => editor.querySelector<HTMLElement>(`#${id} .protyle-linenumber__rows`);
    try {
        api.tabsRender(editor, {readonly: () => true, shown: api.shown});
        api.highlightRender(editor);
        await waitForLayout();
        check.equal(rows("first-code").children.length, 2);
        // 隐藏代码已经高亮，但普通行号为空，换行行号的测量高度为零。
        check.equal(editor.querySelector("#second-code .hljs").getAttribute("data-render"), "true");
        check.equal(rows("second-code").children.length, 0);
        check.equal((rows("wrapped-code").firstElementChild as HTMLElement).style.height, "0px");
        const highlightedText = editor.querySelector('#second-code [contenteditable="true"]');
        const highlightedNode = highlightedText.firstChild;
        api.revealTabAncestors(editor, editor.querySelector("#second-code"), false);
        await waitForLayout();
        for (const id of ["second-code", "wrapped-code", "inner-first-code"]) {
            check.equal(rows(id).children.length, 2, id);
            check.ok(rows(id).clientHeight > 0, id);
            check.ok(parseFloat((rows(id).nextElementSibling as HTMLElement).style.paddingLeft) > 16, id);
        }
        check.ok((rows("wrapped-code").firstElementChild as HTMLElement).clientHeight > 22);
        check.equal(rows("inner-second-code").children.length, 0, "nested hidden content stays unmeasured");
        check.equal(editor.querySelector("#disabled-code .hljs").firstElementChild.className, "fn__none");
        check.equal(highlightedText.firstChild, highlightedNode, "switching preserves highlighted text nodes");
        check.equal(highlightedText.textContent, text);
        api.revealTabAncestors(editor, editor.querySelector("#inner-second-code"), false);
        await waitForLayout();
        check.equal(rows("inner-second-code").children.length, 2);
        // 同一帧连续切换时，仅为最后显示的页签更新布局。
        api.revealTabAncestors(editor, editor.querySelector("#first-code"), false);
        api.revealTabAncestors(editor, editor.querySelector("#second-code"), false);
        await waitForLayout();
        check.equal(rows("second-code").children.length, 2);
        check.equal(rows("inner-second-code").children.length, 2);
    } finally {
        api.destroyTabsRender(editor);
        editor.remove();
        style.remove();
    }
    return "tabs-code-lines-ok";
};

test("tab activation measures code line numbers after hidden content becomes visible", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 45000,
}, async () => {
    const compile = (source: string) => transpileModule(source.replace(/^import [\s\S]*?;\r?\n/gm, "")
        .replace(/^export /gm, ""), {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;
    const tabsFile = "src/protyle/wysiwyg/tabs.ts";
    const ast = createSourceFile(tabsFile, readFileSync(tabsFile, "utf8"), ScriptTarget.ES2021, true);
    let shown: string;
    const visit = (node: Node) => {
        if (isPropertyAssignment(node) && node.name.getText(ast) === "shown") {
            shown = node.initializer.getText(ast);
        }
        node.forEachChild(visit);
    };
    visit(ast);
    assert.ok(shown);
    const source = ["src/util/escape.ts", "src/protyle/util/selectionOffsets.ts",
        "src/protyle/render/foldedContent.ts", "src/protyle/render/highlightRender.ts",
        "src/protyle/render/tabsState.ts", "src/protyle/render/tabsDrag.ts",
        "src/protyle/render/tabsAttributes.ts", "src/protyle/render/tabsVisibility.ts",
        "src/protyle/render/tabsRender.ts"]
        .map(file => compile(readFileSync(file, "utf8"))).join("\n") + compile(`const shown = ${shown};`);
    const directory = mkdtempSync(path.join(tmpdir(), "siyuan-tabs-code-"));
    const script = path.join(directory, "main.cjs");
    const highlightPath = path.resolve("stage/protyle/js/highlight.js/highlight.min.js");
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(directory, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true}});
    try {
        await win.loadURL("about:blank");
        await win.webContents.executeJavaScript(require("node:fs").readFileSync(${JSON.stringify(highlightPath)}, "utf8"));
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(
        `const __name = value => value; (${browserCases.toString()})(${JSON.stringify(source)})`)}));
        app.exit(0);
    } catch (error) { console.error(error); app.exit(1); }
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron") as unknown as string, [script],
            {env, timeout: 40000, windowsHide: true});
        assert.match(result.stdout, /tabs-code-lines-ok/);
    } finally {
        assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
        assert.ok(path.basename(directory).startsWith("siyuan-tabs-code-"));
        rmSync(directory, {recursive: true, force: true});
    }
});
