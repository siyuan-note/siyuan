import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {ScriptTarget, transpileModule} from "typescript";

const browserCases = async (source: string) => {
    const check: typeof assert = require("node:assert/strict");
    const {ipcRenderer} = require("electron");
    const api = new Function("Constants", "addScript", "setCodeTheme", "getContenteditableElement",
        "revealTabsForTarget", "isFoldedRenderContent", source + "\nreturn {highlightRender, renderLongTextRuns};")(
        {PROTYLE_CDN: "", ZWSP: "\u200b"}, () => Promise.resolve(), () => {},
        (element: Element) => element.querySelector('[contenteditable="true"]'), () => {}, () => false);
    Object.assign(window, {siyuan: {config: {editor: {codeLineWrap: false, codeLigatures: false,
        codeSyntaxHighlightLineNum: false}}, languages: {}}});
    const editor = document.createElement("div");
    editor.className = "protyle-wysiwyg";
    editor.contentEditable = "true";
    document.body.append(editor);
    const makeCode = (html: string) => {
        editor.innerHTML = '<div data-type="NodeCodeBlock" class="code-block">' +
            '<div class="protyle-action"><span>sh</span></div><div class="hljs">' +
            '<div contenteditable="false"></div><div contenteditable="true" style="white-space: pre">' +
            html + "</div></div></div>";
        return editor.querySelector<HTMLElement>('[contenteditable="true"]');
    };
    const render = async () => {
        editor.querySelector(".hljs").removeAttribute("data-render");
        api.highlightRender(editor);
        await new Promise(resolve => setTimeout(resolve, 0));
    };
    const offset = (code: Element, node = getSelection().focusNode, position = getSelection().focusOffset) => {
        check.ok(code.contains(node));
        const range = document.createRange();
        range.selectNodeContents(code);
        range.setEnd(node, position);
        return range.toString().length;
    };
    const select = (node: Node, position: number) => {
        editor.focus();
        getSelection().setBaseAndExtent(node, position, node, position);
    };

    // 使用真实 Delete 删除高亮词首字符，覆盖短文本及连续长文本。
    for (const length of [0, 31, 32, 80]) {
        const text = "sss\nsss\ncat\n" + "1".repeat(length) + "\n";
        const code = makeCode(window.hljs.highlight(text, {language: "sh", ignoreIllegals: true}).value);
        const keyword = code.querySelector(".hljs-built_in");
        check.ok(keyword);
        select(keyword.firstChild, 0);
        let inputType: string;
        const atInput = (event: InputEvent) => {
            inputType = event.inputType;
            const range = getSelection().getRangeAt(0);
            api.renderLongTextRuns(editor);
            range.insertNode(document.createElement("wbr"));
            api.highlightRender(editor);
            // 输入结束时恢复折行，正文规范化发生在异步高亮重绘之前。
            api.renderLongTextRuns(editor);
        };
        editor.addEventListener("input", atInput, {once: true});
        await ipcRenderer.invoke("code-delete");
        await new Promise(resolve => setTimeout(resolve, 0));
        check.equal(inputType, "deleteContentForward");
        check.equal(code.textContent, text.replace("cat", "at"));
        check.equal(offset(code), 8, `Delete with ${length} trailing characters`);
        check.equal(code.querySelector("wbr"), null);
    }

    // 标记位于高亮节点首部时，也要计入外层及嵌套节点前面的正文。
    for (const html of [
        'sss\nsss\n<span class="hljs-built_in"><wbr>at</span>\n' + "1".repeat(80) + "\n",
        'sss\n<span class="hljs-string">sss\n<span class="hljs-built_in"><wbr>at</span></span>\n',
        'sss\n<span class="hljs-built_in">c<wbr>at</span>\n',
        "<wbr>cat\n",
    ]) {
        const code = makeCode(html);
        const marker = code.querySelector("wbr");
        const range = document.createRange();
        range.setStartBefore(marker);
        const expected = offset(code, range.startContainer, range.startOffset);
        const text = code.textContent;
        select(range.startContainer, range.startOffset);
        await render();
        check.equal(code.textContent, text);
        check.equal(offset(code), expected, html);
        check.equal(code.querySelector("wbr"), null);
    }

    // 不含标记的反向选区在重新高亮后保留起止位置和方向。
    const code = makeCode('sss\n<span class="hljs-built_in">cat</span>\n');
    editor.focus();
    getSelection().setBaseAndExtent(code.lastChild, 1, code.firstChild, 2);
    const selected = getSelection().toString();
    await render();
    check.equal(getSelection().toString(), selected);
    check.equal(offset(code, getSelection().anchorNode, getSelection().anchorOffset), 8);
    check.equal(offset(code), 2);
    editor.remove();
    return "Code highlight caret cases passed";
};

test("code highlighting preserves the caret after forward deletion at highlighted boundaries", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 45000,
}, async () => {
    const compile = (source: string) => transpileModule(source.replace(/^import [\s\S]*?;\r?\n/gm, "")
        .replace(/^export /gm, ""), {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;
    const source = compile(readFileSync(path.join(__dirname, "../util/selectionOffsets.ts"), "utf8")) + "\n" +
        compile(readFileSync(path.join(__dirname, "../wysiwyg/compositionInput.ts"), "utf8")) + "\n" +
        compile(readFileSync(path.join(__dirname, "../util/longTextWrap.ts"), "utf8")) + "\n" +
        compile(readFileSync(path.join(__dirname, "highlightRender.ts"), "utf8"));
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-code-highlight-test-"));
    const script = path.join(temporary, "run.cjs");
    const highlightPath = path.resolve(__dirname, "../../../stage/protyle/js/highlight.js/highlight.min.js");
    writeFileSync(script, `const {app, BrowserWindow, ipcMain} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true}});
    ipcMain.handle("code-delete", async () => {
        for (const type of ["keyDown", "keyUp"]) {
            win.webContents.sendInputEvent({type, keyCode: "Delete"});
            await new Promise(resolve => setTimeout(resolve, 20));
        }
    });
    try {
        await win.loadURL("about:blank");
        await win.webContents.executeJavaScript(require("node:fs").readFileSync(${JSON.stringify(highlightPath)}, "utf8"));
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
            {env, timeout: 40000, windowsHide: true});
        assert.match(result.stdout, /Code highlight caret cases passed/);
    } finally {
        assert.equal(path.dirname(path.resolve(temporary)), path.resolve(tmpdir()));
        assert.ok(path.basename(temporary).startsWith("siyuan-code-highlight-test-"));
        rmSync(temporary, {recursive: true, force: true});
    }
});
