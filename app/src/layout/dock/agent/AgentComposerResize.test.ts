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
        '<div class="agent-chat fn__flex-column fn__flex-1">' +
        '<div class="agent-chat__messages-wrap"><div class="agent-chat__messages">Messages</div></div>' +
        '<div class="agent-chat__input-area"><div class="agent-chat__input-resize" data-prevent-swipe="true">' +
        '<span class="protyle-block-resize" data-resize-axis="height" tabindex="0" role="separator"></span></div>' +
        '<div class="agent-chat__composer-host protyle protyle-lite-fragment" data-protyle-lite="true">' +
        '<div class="protyle-content"><div class="protyle-wysiwyg" spellcheck="false"></div></div></div>' +
        '<div class="agent-chat__buttons"><button class="b3-button">Send</button></div></div></div></div>';
    const panel = document.querySelector<HTMLElement>(".sy__agentChat");
    // 原生窗口可能受运行器屏幕尺寸限制，面板必须完全位于实际视口内。
    const panelHeight = Math.min(760, window.innerHeight);
    panel.style.height = `${panelHeight}px`;
    const composer = panel.querySelector<HTMLElement>(".agent-chat__composer-host");
    const content = composer.querySelector<HTMLElement>(".protyle-content");
    const editor = composer.querySelector<HTMLElement>(".protyle-wysiwyg");
    const handle = panel.querySelector<HTMLElement>(".protyle-block-resize");
    const tick = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const input = async (method: string, params: object) => {
        await require("electron").ipcRenderer.invoke("composer-input", method, params);
        await tick();
    };
    const moveMouse = (x: number, y: number) => input("Input.dispatchMouseEvent", {type: "mouseMoved", x, y});
    const dragBy = async (dy: number, options: {touch?: boolean, touchEnd?: boolean, escape?: boolean} = {}) => {
        const rect = handle.getBoundingClientRect();
        await require("electron").ipcRenderer.invoke("composer-drag", {
            x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2), dy, ...options,
        });
        await tick();
    };
    const key = (name: string) => handle.dispatchEvent(new KeyboardEvent("keydown", {key: name, bubbles: true, cancelable: true}));
    const paragraph = (text: string) => '<div class="p" data-node-id="20261022000000-abcdefg" data-type="NodeParagraph">' +
        `<div contenteditable="true" spellcheck="false">${text}</div></div>`;
    const short = () => editor.innerHTML = paragraph("Short input");
    short();
    const resize = module.exports.bindAgentComposerResize(panel, composer, handle);
    await tick();
    const small = composer.clientHeight;
    check.ok(small < 100, `short input stays compact: ${small}`);
    await moveMouse(900, 10);
    check.equal(getComputedStyle(handle).opacity, "0", "idle handles stay hidden on devices with a mouse");
    const inputRect = composer.getBoundingClientRect();
    await moveMouse(inputRect.left + 10, inputRect.top + 10);
    check.equal(getComputedStyle(handle).opacity, "1", "hovering the input reveals the handle even for short content");
    await moveMouse(900, 10);
    check.equal(getComputedStyle(handle).opacity, "0", "leaving the input hides the handle");
    await input("Input.dispatchKeyEvent", {type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9});
    await input("Input.dispatchKeyEvent", {type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9});
    check.equal(document.activeElement, handle, "the handle remains reachable by keyboard");
    check.equal(getComputedStyle(handle).opacity, "1", "keyboard focus reveals the handle without hover");
    check.equal(getComputedStyle(handle).outlineStyle, "solid", "keyboard navigation retains its focus indicator");
    handle.blur();
    await input("Emulation.setTouchEmulationEnabled", {enabled: true});
    check.equal(matchMedia("(hover: none) and (pointer: coarse)").matches, true);
    check.equal(getComputedStyle(handle).opacity, "1", "touch devices retain a visible handle without hover");
    await input("Emulation.setTouchEmulationEnabled", {enabled: false});
    editor.innerHTML = paragraph("");
    await tick();
    const emptyHeight = composer.clientHeight;
    await dragBy(-120);
    check.equal(composer.clientHeight, emptyHeight + 120, "dragging an empty composer sets its actual height");
    check.equal(content.clientHeight, composer.clientHeight, "the editable scroll area fills a manually enlarged composer");
    const maximum = handle.getAttribute("aria-valuemax");
    await dragBy(-1000);
    check.equal(composer.clientHeight, Number(maximum), "dragging stops at the upper bound");
    await dragBy(-100);
    check.equal(composer.clientHeight, Number(maximum), "repeated drags cannot increase the upper bound");
    check.equal(handle.getAttribute("aria-valuemax"), maximum);
    await dragBy(Number(maximum) - emptyHeight - 120);
    short();
    await tick();
    check.equal(composer.clientHeight, emptyHeight + 120, "typing one line preserves the chosen height");
    await dragBy(1000);
    check.equal(content.scrollHeight, content.clientHeight, "shrinking a single line does not create a scrollbar");
    check.equal(composer.clientHeight, Number(handle.getAttribute("aria-valuemin")), "dragging stops at the minimum height");
    for (const fontSize of [16, 32]) {
        panel.style.setProperty("--b3-font-size", `${fontSize}px`);
        for (const text of ["", "Short input"]) {
            editor.innerHTML = paragraph(text);
            await tick();
            key("Home");
            await tick();
            check.equal(content.scrollHeight, content.clientHeight, `minimum height fits one line at ${fontSize}px`);
            check.equal(composer.clientHeight, Number(handle.getAttribute("aria-valuemin")));
        }
    }
    panel.style.removeProperty("--b3-font-size");
    handle.dispatchEvent(new MouseEvent("dblclick", {bubbles: true}));
    await tick();
    check.equal(composer.style.height, "", "double click restores automatic sizing after resizing empty content");
    await dragBy(-100, {escape: true});
    check.equal(composer.style.height, "", "canceling the first drag restores automatic sizing");
    await dragBy(-100, {touch: true});
    check.equal(composer.style.height, "", "canceling a touch drag restores automatic sizing");
    const automaticHeight = composer.clientHeight;
    key("ArrowUp");
    check.equal(composer.clientHeight, automaticHeight + 24, "keyboard resizing starts from the visible height");
    key("Home");
    const touchHeight = composer.clientHeight;
    await dragBy(-100, {touch: true, touchEnd: true});
    check.equal(composer.clientHeight, touchHeight + 100, "touch dragging sets the height even with one line");
    handle.dispatchEvent(new MouseEvent("dblclick", {bubbles: true}));
    const image = '<span class="img"><span></span><span><img alt="Image" ' +
        'src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"></span></span>';
    editor.innerHTML = paragraph(image) + paragraph("After image") + paragraph("Last line");
    await tick();
    check.ok(composer.clientHeight > 120, "image and several lines can grow beyond the old limit");
    check.ok(composer.clientHeight < 240, "shorter content grows only as needed");
    const long = () => editor.innerHTML = paragraph(image) + Array.from({length: 24}, (_, i) => paragraph(`Line ${i + 1}`)).join("");
    long();
    await tick();
    const automaticMaximum = panelHeight - 160;
    check.equal(composer.clientHeight, automaticMaximum, "automatic growth uses the available panel space beyond 240px");
    check.equal(composer.scrollHeight, composer.clientHeight, "only the inner editor scrolls");
    check.ok(content.scrollHeight > content.clientHeight);
    content.scrollTop = content.scrollHeight;
    await tick();
    const bottom = content.getBoundingClientRect().bottom - editor.lastElementChild.getBoundingClientRect().bottom;
    check.ok(bottom >= 23, `last line has bottom scroll space: ${bottom}`);
    content.scrollTop = 0;
    check.ok(editor.firstElementChild.getBoundingClientRect().top - content.getBoundingClientRect().top >= 7);

    handle.focus();
    key("ArrowDown");
    check.equal(composer.style.height, `${automaticMaximum - 24}px`);
    key("ArrowUp");
    check.equal(composer.style.height, `${automaticMaximum}px`);
    key("End");
    check.equal(composer.style.maxHeight, `${panelHeight - 160}px`, "End uses the available panel height");
    await tick();
    check.ok(panel.querySelector(".agent-chat__buttons").getBoundingClientRect().bottom <= panel.getBoundingClientRect().bottom);
    check.ok(panel.querySelector(".agent-chat__messages-wrap").clientHeight > 30);

    // 原生指针事件验证捕获、鼠标拖动以及触摸取消。
    handle.dispatchEvent(new MouseEvent("dblclick", {bubbles: true}));
    key("Home");
    for (let i = 0; i < 8; i++) {
        key("ArrowUp");
    }
    await tick();
    const beforeDrag = composer.clientHeight;
    const editable = editor.querySelector<HTMLElement>('[contenteditable="true"]');
    editable.focus();
    const rect = handle.getBoundingClientRect();
    const x = Math.round(rect.left + rect.width / 2);
    const y = Math.round(rect.top + rect.height / 2);
    await require("electron").ipcRenderer.invoke("composer-drag", {x, y, dy: -100, touch: false});
    check.equal(composer.clientHeight, beforeDrag + 100, "mouse dragging raises the actual height");
    check.equal(handle.classList.contains("touch-resize-active"), false);
    check.equal(document.activeElement, editable, "mouse dragging keeps focus in the composer");
    check.equal(getComputedStyle(handle).outlineStyle, "none", "mouse dragging does not leave a keyboard focus box");
    await moveMouse(900, 10);
    check.equal(getComputedStyle(handle).opacity, "0", "the handle hides after dragging and leaving the input");
    const preferred = composer.style.height;
    const escapeRect = handle.getBoundingClientRect();
    let escapedEditor = false;
    editable.addEventListener("keydown", event => escapedEditor ||= event.key === "Escape");
    await require("electron").ipcRenderer.invoke("composer-drag", {
        x: Math.round(escapeRect.left + escapeRect.width / 2), y: Math.round(escapeRect.top + escapeRect.height / 2),
        dy: -50, touch: false, escape: true,
    });
    check.equal(composer.style.height, preferred, "Escape cancels dragging while focus stays in the editor");
    check.equal(escapedEditor, false, "canceling a drag does not trigger editor Escape actions");
    check.equal(handle.classList.contains("touch-resize-active"), false);
    const touchRect = handle.getBoundingClientRect();
    await require("electron").ipcRenderer.invoke("composer-drag", {
        x: Math.round(touchRect.left + touchRect.width / 2), y: Math.round(touchRect.top + touchRect.height / 2),
        dy: -50, touch: true,
    });
    check.equal(composer.style.height, preferred, "touch cancellation restores the previous height");
    check.equal(handle.classList.contains("touch-resize-active"), false);

    for (const fontSize of [16, 32]) {
        panel.style.setProperty("--b3-font-size", `${fontSize}px`);
        for (const width of [240, 360, 760]) {
            panel.style.width = `${width}px`;
            panel.style.height = "400px";
            await tick();
            check.equal(composer.style.height, "240px", "smaller panels clamp an expanded composer");
            check.ok(panel.querySelector(".agent-chat__buttons").getBoundingClientRect().bottom <= panel.getBoundingClientRect().bottom + 1);
            check.ok(content.clientWidth <= composer.clientWidth);
            content.scrollTop = content.scrollHeight;
            check.ok(editor.lastElementChild.getBoundingClientRect().bottom <= content.getBoundingClientRect().bottom - 23);
        }
    }
    panel.style.height = "760px";
    panel.style.paddingBottom = "400px";
    await tick();
    check.equal(composer.style.height, "200px", "mobile keyboard padding reduces available content height");
    panel.style.paddingBottom = "0";
    await tick();
    check.equal(composer.style.height, preferred, "reopening the available space restores the chosen height");
    short();
    await tick();
    check.equal(composer.style.height, preferred, "clearing long content retains a manually chosen height");
    check.equal(composer.clientHeight, parseFloat(preferred));
    const clickRect = handle.getBoundingClientRect();
    await require("electron").ipcRenderer.invoke("composer-drag", {
        x: Math.round(clickRect.left + clickRect.width / 2), y: Math.round(clickRect.top + clickRect.height / 2),
        dy: 0, touch: false,
    });
    check.equal(composer.style.height, preferred, "clicking without dragging does not change the chosen height");
    handle.dispatchEvent(new MouseEvent("dblclick", {bubbles: true}));
    check.equal(composer.style.maxHeight, `${automaticMaximum}px`, "double click restores the automatic height range");
    await tick();
    check.ok(composer.clientHeight < 120, "resetting returns short content to intrinsic height");
    long();
    await tick();
    check.equal(composer.clientHeight, automaticMaximum, "restored automatic mode grows with the next input");
    key("Home");
    const manualHeight = composer.clientHeight;
    short();
    await tick();
    long();
    await tick();
    check.equal(composer.clientHeight, manualHeight, "manually selected height stays fixed as content increases");
    editor.innerHTML = paragraph("");
    resize.reset();
    await tick();
    check.equal(composer.style.height, "", "sending clears the manually selected height");
    check.equal(composer.clientHeight, Number(handle.getAttribute("aria-valuemin")), "the cleared input returns to its initial height");
    long();
    await tick();
    check.equal(composer.clientHeight, automaticMaximum, "the next message grows automatically after sending");
    key("End");
    check.notEqual(composer.style.height, "");
    resize.destroy();
    key("End");
    check.equal(composer.style.maxHeight, "", "destroy removes listeners and the temporary geometry");
    check.equal(composer.style.height, "");
    const escape = new KeyboardEvent("keydown", {key: "Escape", bubbles: true, cancelable: true});
    panel.dispatchEvent(escape);
    check.equal(escape.defaultPrevented, false, "Escape is not intercepted after disposal");
    return "Composer resize and scrolling passed";
};

test("composer preserves automatic growth and bounded manual heights on desktop and mobile", {
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
        webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true, backgroundThrottling: false}});
    win.webContents.debugger.attach("1.3");
    ipcMain.handle("composer-input", (_event, method, params) => win.webContents.debugger.sendCommand(method, params));
    ipcMain.handle("composer-drag", async (_event, {x, y, dy, touch, touchEnd, escape}) => {
        const send = async (method, params) => {
            await win.webContents.debugger.sendCommand(method, params);
            await new Promise(resolve => setTimeout(resolve, 40));
        };
        if (touch) {
            await send("Emulation.setTouchEmulationEnabled", {enabled: true});
            await send("Input.dispatchTouchEvent", {type: "touchStart", touchPoints: [{x, y}]});
            await send("Input.dispatchTouchEvent", {type: "touchMove", touchPoints: [{x, y: y + dy}]});
            await send("Input.dispatchTouchEvent", {type: touchEnd ? "touchEnd" : "touchCancel", touchPoints: []});
            await send("Emulation.setTouchEmulationEnabled", {enabled: false});
        } else {
            await send("Input.dispatchMouseEvent", {type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1});
            await send("Input.dispatchMouseEvent", {type: "mouseMoved", x, y: y + dy, button: "left", buttons: 1});
            if (escape) {
                await send("Input.dispatchKeyEvent", {type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27});
                await send("Input.dispatchKeyEvent", {type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27});
            }
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
