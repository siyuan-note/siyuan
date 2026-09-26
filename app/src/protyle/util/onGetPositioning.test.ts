import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {ScriptTarget, transpileModule} from "typescript";

const browserCases = async (source: string, desktopSource: string) => {
    const check: typeof assert = require("node:assert/strict");
    const Constants = {CB_GET_SCROLL: "scroll", CB_GET_HL: "highlight", CB_GET_FOCUS: "focus",
        CB_GET_FOCUSFIRST: "focusFirst"};
    const focusElementById = new Function("Constants", "resolveVisibleListMindmapBlock", "isPhablet",
        "hasClosestByAttribute", source + "\nreturn focusElementById;")(
        Constants, (): undefined => undefined, () => false, (): null => null) as (
        protyle: IProtyle, action: string[], scrollAttr: IScrollAttr) => void;

    const host = document.createElement("div");
    const content = document.createElement("div");
    const wysiwyg = document.createElement("div");
    content.style.cssText = "height: 200px; width: 300px; overflow-y: auto";
    wysiwyg.innerHTML = '<div data-node-id="block"><div contenteditable="true">Text</div></div>' +
        '<div id="spacer" style="height: 800px"></div>';
    content.append(wysiwyg);
    host.append(content);
    document.body.append(host);
    const spacer = wysiwyg.querySelector<HTMLElement>("#spacer");
    const editable = wysiwyg.querySelector<HTMLElement>('[contenteditable="true"]');
    const noop = (): void => undefined;
    const protyle = {element: host, contentElement: content, wysiwyg: {element: wysiwyg},
        block: {id: "block", rootID: "root"}, observer: {observe: noop, unobserve: noop}} as unknown as IProtyle;

    focusElementById(protyle, [Constants.CB_GET_SCROLL], {scrollTop: 221} as IScrollAttr);
    content.scrollTop = 0;
    spacer.style.height = "801px";
    await new Promise(resolve => setTimeout(resolve, 150));
    check.equal(content.scrollTop, 221, "layout changes keep the requested position before editing");

    focusElementById(protyle, [Constants.CB_GET_SCROLL], {scrollTop: 221} as IScrollAttr);
    content.scrollTop = 0;
    editable.dispatchEvent(new InputEvent("beforeinput", {bubbles: true, inputType: "insertText", data: "x"}));
    spacer.style.height = "802px";
    await new Promise(resolve => setTimeout(resolve, 150));
    check.equal(content.scrollTop, 0, "typing releases the old position before layout changes");

    const editor = {editor: {protyle}};
    const observeDesktopPosition = new Function("editor", "nodeElement", "scrollTop", "options",
        "isHiddenTabContent", "scrollCenter", desktopSource + "\nreturn observerLoad;");
    const target = wysiwyg.querySelector('[data-node-id="block"]');
    const observe = () => observeDesktopPosition(editor, target, 221, {}, () => false, noop) as ResizeObserver;
    const firstObserver = observe();
    content.scrollTop = 0;
    spacer.style.height = "803px";
    await new Promise(resolve => setTimeout(resolve, 150));
    check.equal(content.scrollTop, 221, "desktop focus compensation follows layout changes before editing");
    firstObserver.disconnect();

    observe();
    content.scrollTop = 0;
    editable.dispatchEvent(new InputEvent("beforeinput", {bubbles: true, inputType: "insertText", data: "x"}));
    spacer.style.height = "804px";
    await new Promise(resolve => setTimeout(resolve, 150));
    check.equal(content.scrollTop, 0, "typing cancels desktop focus compensation");
    host.remove();
    return "Positioning cancellation cases passed";
};

test("typing stops delayed document positioning", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 30000,
}, async () => {
    const source = readFileSync(path.join(__dirname, "onGet.ts"), "utf8");
    const start = source.indexOf("const focusElementById = ");
    const end = source.indexOf("export const setReadonlyByConfig", start);
    assert.ok(start >= 0 && end > start);
    const compiled = transpileModule(source.slice(start, end), {
        compilerOptions: {target: ScriptTarget.ES2021}
    }).outputText;
    const desktopSource = readFileSync(path.join(__dirname, "../../editor/util.ts"), "utf8");
    const desktopStart = desktopSource.indexOf("const userScrollAbort = new AbortController();");
    const desktopEndMarker = "observerLoad.observe(editor.editor.protyle.wysiwyg.element);";
    const desktopEnd = desktopSource.indexOf(desktopEndMarker, desktopStart) + desktopEndMarker.length;
    assert.ok(desktopStart >= 0 && desktopEnd > desktopStart);
    const desktopCompiled = transpileModule(desktopSource.slice(desktopStart, desktopEnd), {
        compilerOptions: {target: ScriptTarget.ES2021}
    }).outputText;
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-onget-positioning-test-"));
    const script = path.join(temporary, "run.cjs");
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true}});
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        console.log(await win.webContents.executeJavaScript(${JSON.stringify("const __name = value => value; (" +
        browserCases.toString() + ")(" + JSON.stringify(compiled) + "," + JSON.stringify(desktopCompiled) + ")")}));
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
        assert.match(result.stdout, /Positioning cancellation cases passed/);
    } finally {
        if (path.dirname(path.resolve(temporary)) === path.resolve(tmpdir()) &&
            path.basename(temporary).startsWith("siyuan-onget-positioning-test-")) {
            rmSync(temporary, {recursive: true, force: true});
        }
    }
});
