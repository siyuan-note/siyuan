import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {ScriptTarget, transpileModule} from "typescript";

test("block move shortcuts use marked blocks even with an absent or distant caret", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 30000,
}, async () => {
    const sources = [
        "src/protyle/util/hasClosest.ts",
        "src/protyle/wysiwyg/blockSelection.ts",
        "src/protyle/wysiwyg/move.ts",
        "src/protyle/wysiwyg/keydown.ts",
        "src/util/highlightById.ts",
    ].map(file => readFileSync(file, "utf8").replace(/^import [\s\S]*?;\r?\n/gm, "")
        .replace(/^export /gm, ""));
    const source = transpileModule(sources.join("\n"), {compilerOptions: {target: ScriptTarget.ES2022}}).outputText;
    const fixture = `
        const assert = require("node:assert/strict");
        const bindVerticalNavigationReset = () => {};
        const getAVTemplateInteractiveElement = () => false;
        const handleDocumentBoundaryHotkey = () => false;
        const handleReadonlyAttributeHotkey = () => false;
        const hideElements = () => {};
        const refreshSbResize = () => {};
        const preventScroll = () => {};
        const isUndoViewportPreserved = () => false;
        const resolveVisibleListMindmapBlock = () => undefined;
        const revealTabsForTarget = () => {};
        const getPreviousBlockSibling = element => element.previousElementSibling;
        const getParentBlock = element => element.parentElement;
        const matchHotKey = (key, event) => key === event.key && event.ctrlKey && event.shiftKey;
        const getEditorRange = () => {
            rangeReads++;
            const range = document.createRange();
            range.setStart(root.firstElementChild.firstElementChild, 0);
            range.collapse(true);
            return range;
        };
        const edits = [];
        const transaction = (_protyle, operations) => edits.push(operations[0].id);
        window.siyuan = {config: {keymap: {editor: {general: {moveToUp: "ArrowUp", moveToDown: "ArrowDown"}}}}};
        document.body.innerHTML = '<div class="protyle-content" style="height:400px;overflow:auto;overflow-anchor:none">' +
            '<div class="protyle-wysiwyg" tabindex="0" contenteditable="false">' +
            Array.from({length: 50}, (_, i) => '<div style="height:40px" data-type="NodeParagraph" data-node-id="' +
                (i + 1) + '"><div contenteditable="true">' + (i + 1) + '</div></div>').join("") + '</div></div>';
        const root = document.querySelector(".protyle-wysiwyg");
        const contentElement = root.parentElement;
        const protyle = {wysiwyg: {element: root}, contentElement, block: {parentID: "root"},
            selectElement: Object.assign(document.createElement("div"), {className: "fn__none"})};
        let rangeReads = 0;
        const handlerErrors = [];
        window.addEventListener("unhandledrejection", event => handlerErrors.push(String(event.reason)));
        keydown(protyle, root);
        const order = () => Array.from(root.children, block => Number(block.dataset.nodeId));
        const selected = () => Array.from(root.querySelectorAll("." + BLOCK_SELECTION_CLASS),
            block => Number(block.dataset.nodeId));
        const press = key => {
            const event = new KeyboardEvent("keydown", {key, code: key, bubbles: true, cancelable: true,
                ctrlKey: true, shiftKey: true});
            root.dispatchEvent(event);
            assert.equal(event.defaultPrevented, true);
            assert.equal(rangeReads, 0);
        };
        for (let i = 27; i < 32; i++) {
            root.children[i].classList.add(BLOCK_SELECTION_CLASS);
        }
        root.focus({preventScroll: true});
        getSelection().removeAllRanges();
        contentElement.scrollTop = 1000;
        press("ArrowUp");
        assert.deepEqual(order().slice(25, 33), [26, 28, 29, 30, 31, 32, 27, 33]);
        assert.equal(contentElement.scrollTop, 1000);
        getSelection().collapse(root.firstElementChild.firstElementChild.firstChild, 0);
        contentElement.scrollTop = 1000;
        press("ArrowDown");
        press("ArrowDown");
        assert.deepEqual(order().slice(25, 33), [26, 27, 33, 28, 29, 30, 31, 32]);
        assert.deepEqual(selected(), [28, 29, 30, 31, 32]);
        assert.equal(contentElement.scrollTop, 1000);
        assert.equal(getSelection().anchorNode.textContent, "1");
        const edge = root.querySelector('[data-node-id="32"]');
        contentElement.scrollTop = edge.offsetTop - contentElement.offsetTop - contentElement.clientHeight + 2;
        const before = contentElement.scrollTop;
        press("ArrowDown");
        assert.deepEqual(edits, ["27", "27", "33", "34"]);
        assert.ok(contentElement.scrollTop > before && contentElement.scrollTop - before <= 80);
        assert.ok(edge.getBoundingClientRect().bottom <= contentElement.getBoundingClientRect().bottom);
        assert.deepEqual(selected(), [28, 29, 30, 31, 32]);
        await new Promise(resolve => setTimeout(resolve, 0));
        assert.deepEqual(handlerErrors, []);
        return "block move passed";
    `;
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-block-move-"));
    const script = path.join(temporary, "main.cjs");
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false,
        offscreen: true}});
    try {
        await win.loadURL("about:blank");
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(
        "(async () => {" + source + fixture + "})()")}));
        app.exit(0);
    } catch (error) {
        console.error(error);
        app.exit(1);
    }
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const {stdout} = await promisify(execFile)(require("electron") as unknown as string, [script],
            {env, timeout: 25000, windowsHide: true});
        assert.match(stdout, /block move passed/);
    } finally {
        assert.equal(path.dirname(path.resolve(temporary)), path.resolve(tmpdir()));
        assert.ok(path.basename(temporary).startsWith("siyuan-block-move-"));
        rmSync(temporary, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
    }
});
