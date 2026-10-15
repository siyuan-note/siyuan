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
    const {bindListMarkerCaret} = new Function(source + "\nreturn {bindListMarkerCaret};")();
    const editor = document.createElement("div");
    editor.className = "protyle-wysiwyg";
    document.body.append(editor);
    const selection = getSelection();
    const tick = () => new Promise(resolve => setTimeout(resolve, 20));
    const select = (node: Node, offset = 0) => {
        selection.setBaseAndExtent(node, offset, node, offset);
    };
    const makeList = (content = "body", marker = "1.") => {
        editor.innerHTML = '<div data-type="NodeList" data-node-id="list"><div data-type="NodeListItem" ' +
            'data-node-id="item"><div class="protyle-action" contenteditable="false"><span>' + marker +
            '</span></div><div data-type="NodeParagraph" data-node-id="paragraph"><div contenteditable="true">' +
            content + "</div></div></div></div>";
        const action = editor.querySelector<HTMLElement>(".protyle-action");
        const body = editor.querySelector<HTMLElement>('[contenteditable="true"]');
        editor.focus();
        body.focus();
        return {action, body, item: action.parentElement};
    };
    const atBodyStart = (body: HTMLElement) => {
        check.ok(body.contains(selection.anchorNode), `${selection.anchorNode?.nodeName}: ${selection.anchorNode?.textContent}`);
        const range = document.createRange();
        range.selectNodeContents(body);
        range.setEnd(selection.anchorNode, selection.anchorOffset);
        check.equal(range.toString(), "");
        check.ok(selection.isCollapsed);
    };
    const inputEvent = (inputType = "insertText", targetRanges: StaticRange[] = []) => new InputEvent("beforeinput", {
        bubbles: true, cancelable: true, inputType, data: "x", targetRanges,
    });

    // 无保护时，真实 DOM Selection 允许光标停在不可编辑的序号文本内部。
    editor.contentEditable = "true";
    const baseline = makeList();
    select(baseline.action.firstChild.firstChild);
    await tick();
    check.equal(selection.anchorNode, baseline.action.firstChild.firstChild);

    let enabled = true;
    const dispose = bindListMarkerCaret(editor, () => enabled);
    // 覆盖 iPad/桌面的外层编辑宿主以及 iPhone/Android 的独立正文宿主。
    for (const rootEditable of ["true", "false"]) {
        editor.contentEditable = rootEditable;
        for (const marker of ["1.", "123.", "•", '<svg><use href="#iconCheck"></use></svg>']) {
            for (const position of ["text", "marker", "before", "after"]) {
                const {action, body, item} = makeList("body", marker);
                select(position === "text" ? action.firstChild.firstChild : position === "marker" ? action : item,
                    position === "after" ? 1 : 0);
                await tick();
                atBodyStart(body);
                const markerHTML = action.innerHTML;
                await ipcRenderer.invoke("marker-type", "测");
                check.equal(body.textContent, "测body");
                check.equal(action.innerHTML, markerHTML);
            }
        }
    }
    const empty = makeList("");
    select(empty.action);
    await tick();
    atBodyStart(empty.body);

    // 选区变化通知尚未到达时，在输入入口阻止对序号的插入、退格、删除及粘贴。
    for (const inputType of ["insertText", "deleteContentBackward", "deleteContentForward", "insertFromPaste"]) {
        const {action, body} = makeList();
        select(action.firstChild.firstChild);
        const event = inputEvent(inputType);
        check.equal(editor.dispatchEvent(event), false);
        atBodyStart(body);
        check.equal(action.textContent, "1.");
        check.equal(body.textContent, "body");
    }
    // 即便选区已经校正，输入事件携带的旧目标仍不可写入。
    const stale = makeList();
    select(stale.body.firstChild);
    const target = new StaticRange({startContainer: stale.action.firstChild.firstChild, startOffset: 0,
        endContainer: stale.action.firstChild.firstChild, endOffset: 0});
    check.equal(editor.dispatchEvent(inputEvent("insertText", [target])), false);
    const deletionTarget = new StaticRange({startContainer: stale.action.firstChild.firstChild, startOffset: 0,
        endContainer: stale.action.firstChild.firstChild, endOffset: 1});
    check.equal(editor.dispatchEvent(inputEvent("deleteContentBackward", [deletionTarget])), false);

    // 组合开始前校正光标，候选更新期间保留正文中的合法光标和选区。
    const composition = makeList();
    select(composition.action.firstChild.firstChild);
    let startWasRepaired = false;
    editor.addEventListener("compositionstart", () => {
        atBodyStart(composition.body);
        startWasRepaired = true;
    }, {once: true});
    editor.dispatchEvent(new CompositionEvent("compositionstart", {bubbles: true}));
    check.ok(startWasRepaired);
    select(composition.body.firstChild, 2);
    await tick();
    check.equal(selection.anchorOffset, 2);
    editor.dispatchEvent(new CompositionEvent("compositionend", {bubbles: true}));
    check.equal(selection.anchorOffset, 2);
    check.equal(editor.dispatchEvent(inputEvent()), true);

    // 缺失组合结束事件时，明确提交的输入恢复后续光标校正。
    editor.dispatchEvent(new CompositionEvent("compositionstart", {bubbles: true}));
    editor.dispatchEvent(new InputEvent("input", {inputType: "insertText", isComposing: false}));
    select(composition.action.firstChild.firstChild);
    await tick();
    atBodyStart(composition.body);

    // 嵌套列表只定位到当前列表项正文，不跳到外层列表的首项。
    const nested = makeList();
    const childList = document.createElement("div");
    childList.innerHTML = nested.item.outerHTML;
    nested.item.append(childList);
    const childBody = childList.querySelector<HTMLElement>('[contenteditable="true"]');
    childBody.focus();
    select(childList.querySelector(".protyle-action").firstChild.firstChild);
    await tick();
    atBodyStart(childBody);

    const normal = makeList();
    selection.setBaseAndExtent(normal.action.firstChild.firstChild, 0, normal.body.firstChild, 2);
    await tick();
    check.equal(selection.anchorNode, normal.action.firstChild.firstChild);
    check.equal(selection.focusOffset, 2);
    const crossTarget = new StaticRange({startContainer: normal.action.firstChild.firstChild, startOffset: 0,
        endContainer: normal.body.firstChild, endOffset: 2});
    check.equal(editor.dispatchEvent(inputEvent("insertText", [crossTarget])), true);

    // 代码块等其他工具栏不属于列表序号保护的范围。
    const code = document.createElement("div");
    code.setAttribute("data-type", "NodeCodeBlock");
    code.innerHTML = '<div class="protyle-action">js</div>';
    editor.append(code);
    select(code.firstChild.firstChild);
    await tick();
    check.equal(selection.anchorNode, code.firstChild.firstChild);

    // 禁用、外部编辑器及销毁后的选区不被抢占。
    enabled = false;
    select(normal.action.firstChild.firstChild);
    await tick();
    check.equal(selection.anchorNode, normal.action.firstChild.firstChild);
    enabled = true;
    const outside = document.createElement("div");
    outside.contentEditable = "true";
    outside.textContent = "outside";
    document.body.append(outside);
    outside.focus();
    select(normal.action.firstChild.firstChild);
    await tick();
    check.equal(document.activeElement, outside);
    check.equal(selection.anchorNode, normal.action.firstChild.firstChild);
    select(outside.firstChild, 2);
    await tick();
    check.equal(selection.anchorNode, outside.firstChild);
    check.equal(selection.anchorOffset, 2);
    dispose();
    normal.body.focus();
    select(normal.action.firstChild.firstChild);
    await tick();
    check.equal(selection.anchorNode, normal.action.firstChild.firstChild);
    editor.remove();
    outside.remove();
    return "List marker caret cases passed";
};

test("list marker carets are repaired before editing without disturbing body input or selections", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 45000,
}, async () => {
    const compile = (file: string) => transpileModule(readFileSync(path.join(__dirname, file), "utf8")
        .replace(/^import [\s\S]*?;\r?\n/gm, "").replace(/^export /gm, ""),
    {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;
    const source = compile("getBlock.ts") + "\n" + compile("compositionInput.ts") + "\n" + compile("listMarkerCaret.ts");
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-list-marker-test-"));
    const script = path.join(temporary, "run.cjs");
    writeFileSync(script, `const {app, BrowserWindow, ipcMain} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false,
        offscreen: true, backgroundThrottling: false}});
    ipcMain.handle("marker-type", (_event, text) => win.webContents.insertText(text));
    try {
        await win.loadURL("about:blank");
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
        assert.match(result.stdout, /List marker caret cases passed/, result.stderr);
    } finally {
        assert.equal(path.dirname(path.resolve(temporary)), path.resolve(tmpdir()));
        assert.ok(path.basename(temporary).startsWith("siyuan-list-marker-test-"));
        rmSync(temporary, {recursive: true, force: true});
    }
});
