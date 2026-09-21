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
    const {renderLongTextRuns, suspendLongTextRuns} = new Function(source +
        "\nreturn {renderLongTextRuns, suspendLongTextRuns};")() as typeof import("./longTextWrap");
    const lute = Lute.New();
    const style = document.createElement("style");
    style.textContent = '[contenteditable="true"] {min-height: 1.625em; white-space: break-spaces;}' +
        ".protyle-attr {display: none;}";
    document.head.append(style);
    const editor = document.createElement("div");
    editor.className = "protyle-wysiwyg";
    editor.contentEditable = "true";
    document.body.append(editor);
    const long = "a".repeat(40);
    const paragraph = (id: string, html: string) => `<div data-type="NodeParagraph"><div id="${id}" ` +
        `contenteditable="true">${html}</div><div class="protyle-attr" contenteditable="false">\u200b</div></div>`;
    const content = (id: string) => editor.querySelector<HTMLElement>(`#${id}`);
    const select = (anchor: Node, anchorOffset: number, focus = anchor, focusOffset = anchorOffset) => {
        editor.focus();
        getSelection().setBaseAndExtent(anchor, anchorOffset, focus, focusOffset);
    };
    const checkPoint = (node: Node, offset: number, container: Element, textOffset: number) => {
        check.ok(container.contains(node), `caret left ${container.id}: ${node.parentElement?.outerHTML}`);
        const range = document.createRange();
        range.selectNodeContents(container);
        range.setEnd(node, offset);
        check.equal(range.toString().length, textOffset);
    };
    const checkCaret = (container: Element, offset: number) => {
        check.equal(getSelection().isCollapsed, true);
        checkPoint(getSelection().anchorNode, getSelection().anchorOffset, container, offset);
    };
    const nativeInput = (events: {type: string, keyCode: string}[]) => ipcRenderer.invoke("long-text-input", events);
    const type = (text: string) => nativeInput([{type: "char", keyCode: text}]);
    const backspace = () => nativeInput([{type: "keyDown", keyCode: "Backspace"},
        {type: "keyUp", keyCode: "Backspace"}]);
    const renderAtInput = () => renderLongTextRuns(editor);
    editor.addEventListener("input", renderAtInput);

    // 空列表项前后的长文本、列表标记和属性文本不能改变其编辑位置。
    for (const marker of ["-", "1.", "- [ ]"]) {
        for (const preceding of [true, false]) {
            const list = lute.Md2BlockDOM(marker + " item");
            editor.innerHTML = preceding ? paragraph("other", long) + list : list + paragraph("other", long);
            const item = editor.querySelector<HTMLElement>('[data-type="NodeListItem"] [contenteditable="true"]');
            check.ok(item, marker);
            item.id = "item";
            item.textContent = "";
            select(item, 0);
            renderLongTextRuns(editor);
            checkCaret(item, 0);
            check.equal(editor.querySelectorAll('[data-inline-wrap="token"]').length, 1);
            await type("x");
            check.equal(item.textContent, "x", editor.innerHTML);
            checkCaret(item, 1);
            await backspace();
            check.equal(item.textContent, "");
            checkCaret(item, 0);
            await type("y");
            check.equal(item.textContent, "y");
            checkCaret(item, 1);
        }
    }

    // 空段落与空表格单元格保留原始容器，单元格之间也不能共享字符偏移。
    for (const html of [paragraph("empty", ""),
        '<table contenteditable="false"><tbody><tr><td><div id="empty" data-table-cell-content ' +
        'contenteditable="true"></div></td><td><div data-table-cell-content>' + long + "</div></td></tr></tbody></table>"]) {
        editor.innerHTML = paragraph("other", long) + html;
        select(content("empty"), 0);
        renderLongTextRuns(editor);
        checkCaret(content("empty"), 0);
    }

    // 空行边界和行内格式的起止位置不能被折算到相邻文本中。
    editor.innerHTML = paragraph("lines", long + "<br><br>");
    const lines = content("lines");
    select(lines, 3);
    renderLongTextRuns(editor);
    check.equal(getSelection().anchorNode, lines);
    check.equal(getSelection().anchorOffset, 3);
    editor.innerHTML = paragraph("styles", long + '<br><span data-type="strong" id="strong">' + long + "</span>");
    const strong = content("strong");
    select(strong.firstChild, 0);
    const originalRange = getSelection().getRangeAt(0);
    renderLongTextRuns(editor);
    checkCaret(strong, 0);
    checkPoint(originalRange.startContainer, originalRange.startOffset, strong, 0);
    const resumeStyle = suspendLongTextRuns(editor, content("styles"), getSelection().getRangeAt(0));
    checkCaret(strong, 0);
    resumeStyle();
    checkCaret(strong, 0);
    editor.innerHTML = paragraph("after", '<span data-type="strong">styled</span>' + long);
    const after = content("after");
    select(after.lastChild, 0);
    renderLongTextRuns(editor);
    checkPoint(getSelection().anchorNode, getSelection().anchorOffset, after.lastElementChild, 0);
    editor.innerHTML = paragraph("joined", "");
    const joined = content("joined");
    joined.append(document.createTextNode("prefix "), document.createTextNode(long));
    select(joined.lastChild, 15);
    renderLongTextRuns(editor);
    checkCaret(joined, 22);

    // 反向跨块选区及输入处理持有的 Range 必须同时恢复。
    editor.innerHTML = paragraph("first", long) + paragraph("last", long);
    select(content("last").firstChild, 7, content("first").firstChild, 3);
    const selectedText = getSelection().toString();
    renderLongTextRuns(editor);
    check.equal(getSelection().toString(), selectedText);
    checkPoint(getSelection().anchorNode, getSelection().anchorOffset, content("last"), 7);
    checkPoint(getSelection().focusNode, getSelection().focusOffset, content("first"), 3);
    const retained = getSelection().getRangeAt(0).cloneRange();
    const retainedText = retained.toString();
    const resume = suspendLongTextRuns(editor, editor, retained);
    check.equal(editor.querySelector('[data-inline-wrap="token"]'), null);
    checkPoint(retained.startContainer, retained.startOffset, content("first"), 3);
    checkPoint(retained.endContainer, retained.endOffset, content("last"), 7);
    check.equal(retained.toString(), retainedText);
    check.equal(getSelection().toString(), selectedText);
    resume();
    checkPoint(getSelection().anchorNode, getSelection().anchorOffset, content("last"), 7);
    checkPoint(getSelection().focusNode, getSelection().focusOffset, content("first"), 3);

    // 输入处理期间禁止重新包装，组合输入结束后仍在同一编辑容器中继续输入。
    editor.innerHTML = paragraph("other", long) + paragraph("composing", long);
    const composing = content("composing");
    select(composing.firstChild, 12);
    renderLongTextRuns(editor);
    editor.dispatchEvent(new CompositionEvent("compositionstart", {bubbles: true}));
    check.equal(composing.querySelector('[data-inline-wrap="token"]'), null);
    checkCaret(composing, 12);
    composing.firstChild.textContent = long.substring(0, 12) + "输入" + long.substring(12);
    select(composing.firstChild, 14);
    renderLongTextRuns(editor);
    check.equal(composing.querySelector('[data-inline-wrap="token"]'), null);
    editor.dispatchEvent(new CompositionEvent("compositionend", {bubbles: true, data: "输入"}));
    renderLongTextRuns(editor);
    checkCaret(composing, 14);
    await type("z");
    check.equal(composing.textContent, long.substring(0, 12) + "输入z" + long.substring(12));
    checkCaret(composing, 15);

    // 编辑器之外的选区和无选区状态不受渲染影响。
    const outside = document.createElement("div");
    outside.contentEditable = "true";
    outside.textContent = "outside";
    document.body.append(outside);
    getSelection().setBaseAndExtent(outside.firstChild, 2, outside.firstChild, 4);
    editor.innerHTML = paragraph("other", long);
    renderLongTextRuns(editor);
    check.equal(getSelection().anchorNode, outside.firstChild);
    check.equal(getSelection().anchorOffset, 2);
    check.equal(getSelection().focusOffset, 4);
    getSelection().removeAllRanges();
    editor.innerHTML = paragraph("other", long);
    renderLongTextRuns(editor);
    check.equal(getSelection().rangeCount, 0);
    outside.remove();
    editor.remove();
    style.remove();
    return "Long text selection cases passed";
};

test("long text wrapping preserves list input and DOM selection boundaries", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 45000,
}, async () => {
    const source = transpileModule(readFileSync(path.join(__dirname, "longTextWrap.ts"), "utf8")
        .replace(/^export /gm, ""), {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-long-text-test-"));
    const script = path.join(temporary, "run.cjs");
    const lutePath = path.resolve(__dirname, "../../../stage/protyle/js/lute/lute.min.js");
    writeFileSync(script, `const {app, BrowserWindow, ipcMain} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true}});
    ipcMain.handle("long-text-input", async (_event, events) => {
        for (const event of events) {
            win.webContents.sendInputEvent(event);
            await new Promise(resolve => setTimeout(resolve, 20));
        }
    });
    try {
        await win.loadURL("about:blank");
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
            {env, timeout: 40000, windowsHide: true});
        assert.match(result.stdout, /Long text selection cases passed/);
    } finally {
        assert.equal(path.dirname(path.resolve(temporary)), path.resolve(tmpdir()));
        assert.ok(path.basename(temporary).startsWith("siyuan-long-text-test-"));
        rmSync(temporary, {recursive: true, force: true});
    }
});
