import {test} from "node:test";
import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {promisify} from "node:util";
import {ScriptTarget, transpileModule} from "typescript";

const browserCases = async (source: string) => {
    const check: typeof assert = require("node:assert/strict");
    const {createInlineMathSelection, isDirectMathClick} = new Function(source +
        "\nreturn {createInlineMathSelection, isDirectMathClick};")() as {
        createInlineMathSelection: (onSettled?: () => void) =>
            ReturnType<typeof import("./inlineMathSelection").createInlineMathSelection>,
        isDirectMathClick: typeof import("../../protyle/util/mathClick").isDirectMathClick,
    };
    let opened = 0;
    const helper = createInlineMathSelection(() => opened++);
    const selection = getSelection();
    const editor = document.createElement("div");
    editor.contentEditable = "true";
    editor.style.cssText = "font-size:24px;width:340px;line-height:2";
    editor.innerHTML = '<p>before<span data-type="inline-math" data-subtype="math" contenteditable="false">' +
        '<span class="katex">x+y</span></span>after</p>' +
        '<p>end<span data-type="inline-math" data-subtype="math" contenteditable="false">z</span></p>';
    document.body.append(editor);
    editor.focus();
    const math = editor.querySelector<HTMLElement>("[data-type=inline-math]");
    const inner = math.firstChild.firstChild;
    const before = math.previousSibling;
    const after = math.nextSibling;
    const place = (node: Node, offset: number) => {
        selection.setBaseAndExtent(node, offset, node, offset);
        helper.update(editor, selection);
    };
    const wait = () => new Promise(resolve => setTimeout(resolve, 400));

    // 拖动经过公式或停在公式内，都不能更改焦点、选区或打开编辑。
    place(before, 2);
    place(inner, 1);
    await wait();
    check.equal(opened, 0, "resting inside a formula does not open its editor");
    check.equal(selection.anchorNode, inner);
    check.equal(selection.anchorOffset, 1);
    check.equal(document.activeElement, editor);
    place(after, 2);
    place(inner, 2);
    await wait();
    check.equal(opened, 0, "backward caret movement also preserves focus");
    check.equal(selection.anchorNode, inner);
    check.equal(document.activeElement, editor);

    // 输入前按照进入方向移到公式外，保持渲染节点不变。
    const original = math.outerHTML;
    check.equal(helper.prepareInput(editor, selection), true);
    check.equal(selection.anchorNode, before);
    check.equal(selection.anchorOffset, before.textContent.length);
    place(before, 2);
    place(inner, 1);
    check.equal(helper.prepareInput(editor, selection), true);
    check.equal(selection.anchorNode, after);
    check.equal(selection.anchorOffset, 0);
    document.execCommand("insertText", false, "Q");
    check.equal(math.outerHTML, original);
    check.equal(after.textContent, "Qafter");

    // 段末没有文本兄弟节点时，插入位置也必须处于公式外。
    const endMath = editor.querySelectorAll<HTMLElement>("[data-type=inline-math]")[1];
    place(endMath.previousSibling, 1);
    place(endMath.firstChild, 1);
    await wait();
    check.equal(opened, 0, "a caret mapped into the last formula does not open it");
    check.equal(helper.prepareInput(editor, selection), true);
    check.equal(selection.anchorNode, endMath.parentNode);
    check.equal(selection.anchorOffset, 2);

    // 反向选区涉及公式内部时扩展到完整公式，避免删除部分渲染内容。
    selection.setBaseAndExtent(after, 2, inner, 1);
    check.equal(helper.prepareInput(editor, selection), true);
    check.equal(selection.anchorNode, after);
    check.equal(selection.focusNode, math.parentNode);
    check.equal(selection.focusOffset, 1);
    check.equal(math.outerHTML, original);

    // 组合输入和只读区域不得被选区观察器改写。
    selection.collapse(inner, 1);
    helper.update(editor, selection, true);
    check.equal(selection.anchorNode, inner);
    editor.contentEditable = "false";
    check.equal(helper.prepareInput(editor, selection), false);
    check.equal(selection.anchorNode, inner);
    editor.contentEditable = "true";

    // 浏览器即使把点击目标吸附到公式，也必须用实际坐标排除附近空白。
    const rect = math.getBoundingClientRect();
    const click = (x: number, y = (rect.top + rect.bottom) / 2) => new MouseEvent("click", {
        clientX: x, clientY: y, detail: 1,
    });
    check.equal(isDirectMathClick(math, click((rect.left + rect.right) / 2)), true);
    check.equal(isDirectMathClick(math, click(rect.left - 2)), false);
    check.equal(isDirectMathClick(math, click(rect.right + 2)), false);
    const endRect = endMath.getBoundingClientRect();
    check.equal(isDirectMathClick(endMath, click(endRect.right + 50,
        (endRect.top + endRect.bottom) / 2)), false);
    check.equal(isDirectMathClick(math, click(rect.left + 2, rect.bottom + 5)), false);
    check.equal(isDirectMathClick(math, new MouseEvent("click", {detail: 0})), true);
    const blockMath = document.createElement("div");
    blockMath.dataset.subtype = "math";
    check.equal(isDirectMathClick(blockMath, click(0)), true);

    helper.reset();
    editor.remove();
    return "Inline math selection cases passed";
};

test("Android inline math preserves caret movement and only accepts direct formula clicks", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 25000,
}, async () => {
    const source = ["inlineMathSelection.ts", "../../protyle/util/mathClick.ts"].map(file => transpileModule(
        readFileSync(path.join(__dirname, file), "utf8").replace(/^export /gm, ""),
        {compilerOptions: {target: ScriptTarget.ES2021}},
    ).outputText).join("\n");
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-inline-math-test-"));
    const script = path.join(temporary, "run.cjs");
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true}});
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
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
            {env, timeout: 20000, windowsHide: true});
        assert.match(result.stdout, /Inline math selection cases passed/);
    } finally {
        if (path.dirname(path.resolve(temporary)) === path.resolve(tmpdir()) &&
            path.basename(temporary).startsWith("siyuan-inline-math-test-")) {
            rmSync(temporary, {recursive: true, force: true});
        }
    }
});
