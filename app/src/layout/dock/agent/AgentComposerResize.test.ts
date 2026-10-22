import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const cases = async (source: string, css: string, mobile: boolean) => {
    const check: typeof assert = require("node:assert/strict");
    const module = {exports: {} as typeof import("./AgentComposerResize")};
    new Function("module", "exports", source)(module, module.exports);
    const style = document.createElement("style");
    style.textContent = css;
    document.head.append(style);
    document.body.innerHTML = `<div class="sy__agentChat fn__flex-column file-tree dockPanel${mobile ? " sy__agentChat--mobile" : ""}" ` +
        'style="width:360px;height:760px;min-height:0;box-sizing:border-box">' +
        '<div class="block__icons" style="height:48px">Agent</div>' +
        '<div class="agent-chat__messages-wrap"><div class="agent-chat__messages">Messages</div></div>' +
        '<div class="agent-chat__input-area"><div class="agent-chat__input-resize" data-prevent-swipe="true">' +
        '<span class="protyle-block-resize" data-resize-axis="height" tabindex="0" role="separator"></span></div>' +
        '<div class="agent-chat__composer-host protyle protyle-lite-fragment" data-protyle-lite="true">' +
        '<div class="protyle-content"><div class="protyle-wysiwyg" spellcheck="false"></div></div></div>' +
        '<div class="agent-chat__buttons"><button class="b3-button">Send</button></div></div></div>';
    const panel = document.querySelector<HTMLElement>(".sy__agentChat");
    const composer = panel.querySelector<HTMLElement>(".agent-chat__composer-host");
    const content = composer.querySelector<HTMLElement>(".protyle-content");
    const editor = composer.querySelector<HTMLElement>(".protyle-wysiwyg");
    const handle = panel.querySelector<HTMLElement>(".protyle-block-resize");
    const tick = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const paragraph = (text: string) => '<div class="p" data-node-id="20261022000000-abcdefg" data-type="NodeParagraph">' +
        `<div contenteditable="true" spellcheck="false">${text}</div></div>`;
    const short = () => editor.innerHTML = paragraph("Short input");
    short();
    const destroy = module.exports.bindAgentComposerResize(panel, composer, handle);
    await tick();
    const small = composer.clientHeight;
    check.ok(small < 100, `short input stays compact: ${small}`);
    const image = '<span class="img"><span></span><span><img alt="Image" ' +
        'src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"></span></span>';
    editor.innerHTML = paragraph(image) + paragraph("After image") + paragraph("Last line");
    await tick();
    check.ok(composer.clientHeight > 120, "image and several lines can grow beyond the old limit");
    check.ok(composer.clientHeight < 240, "shorter content grows only as needed");
    const long = () => editor.innerHTML = paragraph(image) + Array.from({length: 24}, (_, i) => paragraph(`Line ${i + 1}`)).join("");
    long();
    await tick();
    check.equal(composer.clientHeight, 240);
    check.equal(composer.scrollHeight, composer.clientHeight, "only the inner editor scrolls");
    check.ok(content.scrollHeight > content.clientHeight);
    content.scrollTop = content.scrollHeight;
    await tick();
    const bottom = content.getBoundingClientRect().bottom - editor.lastElementChild.getBoundingClientRect().bottom;
    check.ok(bottom >= 23, `last line has bottom scroll space: ${bottom}`);
    content.scrollTop = 0;
    check.ok(editor.firstElementChild.getBoundingClientRect().top - content.getBoundingClientRect().top >= 7);

    const key = (name: string) => handle.dispatchEvent(new KeyboardEvent("keydown", {key: name, bubbles: true, cancelable: true}));
    handle.focus();
    key("ArrowUp");
    check.equal(composer.style.maxHeight, "264px");
    key("ArrowDown");
    check.equal(composer.style.maxHeight, "240px");
    key("End");
    check.equal(composer.style.maxHeight, "600px", `panel ${panel.clientHeight} ${getComputedStyle(panel).display} ${getComputedStyle(panel).minHeight}`);
    await tick();
    check.ok(panel.querySelector(".agent-chat__buttons").getBoundingClientRect().bottom <= panel.getBoundingClientRect().bottom);
    check.ok(panel.querySelector(".agent-chat__messages-wrap").clientHeight > 30);

    // 原生指针事件验证捕获、鼠标拖动以及触摸取消。
    handle.dispatchEvent(new MouseEvent("dblclick", {bubbles: true}));
    await tick();
    const rect = handle.getBoundingClientRect();
    const x = Math.round(rect.left + rect.width / 2);
    const y = Math.round(rect.top + rect.height / 2);
    await require("electron").ipcRenderer.invoke("composer-drag", {x, y, dy: -100, touch: false});
    check.ok(composer.clientHeight >= 338 && composer.clientHeight <= 342, "mouse dragging raises the height cap");
    check.equal(handle.classList.contains("touch-resize-active"), false);
    const preferred = composer.style.maxHeight;
    const touchRect = handle.getBoundingClientRect();
    await require("electron").ipcRenderer.invoke("composer-drag", {
        x: Math.round(touchRect.left + touchRect.width / 2), y: Math.round(touchRect.top + touchRect.height / 2),
        dy: -50, touch: true,
    });
    check.equal(composer.style.maxHeight, preferred, "touch cancellation restores the previous cap");
    check.equal(handle.classList.contains("touch-resize-active"), false);

    for (const fontSize of [16, 32]) {
        panel.style.setProperty("--b3-font-size", `${fontSize}px`);
        for (const width of [240, 360, 760]) {
            panel.style.width = `${width}px`;
            panel.style.height = "400px";
            await tick();
            check.equal(composer.style.maxHeight, "240px", "smaller panels clamp an expanded composer");
            check.ok(panel.querySelector(".agent-chat__buttons").getBoundingClientRect().bottom <= panel.getBoundingClientRect().bottom + 1);
            check.ok(content.clientWidth <= composer.clientWidth);
            content.scrollTop = content.scrollHeight;
            check.ok(editor.lastElementChild.getBoundingClientRect().bottom <= content.getBoundingClientRect().bottom - 23);
        }
    }
    panel.style.height = "760px";
    panel.style.paddingBottom = "400px";
    await tick();
    check.equal(composer.style.maxHeight, "200px", "mobile keyboard padding reduces available content height");
    panel.style.paddingBottom = "0";
    await tick();
    check.equal(composer.style.maxHeight, preferred, "reopening the available space restores the chosen cap");
    short();
    await tick();
    check.ok(composer.clientHeight < 120, "clearing long content returns to intrinsic height");
    const clickRect = handle.getBoundingClientRect();
    await require("electron").ipcRenderer.invoke("composer-drag", {
        x: Math.round(clickRect.left + clickRect.width / 2), y: Math.round(clickRect.top + clickRect.height / 2),
        dy: 0, touch: false,
    });
    check.equal(composer.style.maxHeight, preferred, "clicking without dragging does not shrink the automatic growth limit");
    handle.dispatchEvent(new MouseEvent("dblclick", {bubbles: true}));
    check.equal(composer.style.maxHeight, "240px", "double click restores the automatic cap");
    long();
    await tick();
    destroy();
    key("End");
    check.equal(composer.style.maxHeight, "", "destroy removes listeners and the temporary geometry");
    return "Composer resize and scrolling passed";
};

test("composer grows, resizes and preserves scroll space on desktop and mobile", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 60000,
}, async () => {
    const source = transpileModule(readFileSync(path.join(__dirname, "AgentComposerResize.ts"), "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    const sass = require("sass");
    const sheets = ["base", "mobile"].map(name => ({name, css: sass.compile(path.resolve(__dirname,
        `../../../assets/scss/${name}.scss`), {logger: sass.Logger.silent}).css}));
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-composer-resize-"));
    const script = path.join(temporary, "run.cjs");
    writeFileSync(script, `const {app, BrowserWindow, ipcMain} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, width: 1000, height: 900,
        webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true}});
    win.webContents.debugger.attach("1.3");
    ipcMain.handle("composer-drag", async (_event, {x, y, dy, touch}) => {
        const send = async (method, params) => {
            await win.webContents.debugger.sendCommand(method, params);
            await new Promise(resolve => setTimeout(resolve, 40));
        };
        if (touch) {
            await send("Emulation.setTouchEmulationEnabled", {enabled: true});
            await send("Input.dispatchTouchEvent", {type: "touchStart", touchPoints: [{x, y}]});
            await send("Input.dispatchTouchEvent", {type: "touchMove", touchPoints: [{x, y: y + dy}]});
            await send("Input.dispatchTouchEvent", {type: "touchCancel", touchPoints: []});
            await send("Emulation.setTouchEmulationEnabled", {enabled: false});
        } else {
            await send("Input.dispatchMouseEvent", {type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1});
            await send("Input.dispatchMouseEvent", {type: "mouseMoved", x, y: y + dy, button: "left", buttons: 1});
            await send("Input.dispatchMouseEvent", {type: "mouseReleased", x, y: y + dy, button: "left", buttons: 0, clickCount: 1});
        }
    });
    try {
        for (const sheet of ${JSON.stringify(sheets)}) {
            for (const theme of ["daylight", "midnight"]) {
                await win.loadURL("data:text/html,<html><body></body></html>");
                const css = require("node:fs").readFileSync(${JSON.stringify(path.resolve(__dirname, "../../../../appearance/themes"))} + "/" + theme + "/theme.css", "utf8") + sheet.css;
                console.log(await win.webContents.executeJavaScript(
                    "const __name = value => value; (" + ${JSON.stringify(cases.toString())} + ")(" +
                    JSON.stringify(${JSON.stringify(source)}) + "," + JSON.stringify(css) + "," + (sheet.name === "mobile") + ")"));
            }
        }
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
        const result = await promisify(execFile)(require("electron"), [script], {env, windowsHide: true, timeout: 50000});
        assert.equal(result.stdout.match(/Composer resize and scrolling passed/g)?.length, 4);
    } finally {
        assert.equal(path.dirname(path.resolve(temporary)), path.resolve(tmpdir()));
        assert.ok(path.basename(temporary).startsWith("siyuan-composer-resize-"));
        rmSync(temporary, {recursive: true, force: true, maxRetries: 10, retryDelay: 100});
    }
});
