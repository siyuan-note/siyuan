import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {promisify} from "node:util";
import test from "node:test";
import {ScriptTarget, transpileModule} from "typescript";

const browserCases = async (source: string) => {
    const check = require("node:assert/strict");
    const requests: ((response: unknown) => void)[] = [];
    class Panel {
        element = document.createElement("div");
        editors: {protyle: IProtyle}[] = [];
        targetElement: HTMLElement;
        refDefs: IRefDefs[];

        constructor(options: {targetElement: HTMLElement, refDefs: IRefDefs[]}) {
            this.targetElement = options.targetElement;
            this.refDefs = options.refDefs;
            this.element.className = "block__popover";
            this.element.dataset.pin = "false";
            this.element.dataset.level = "1";
            this.element.dataset.oid = "test";
            document.body.append(this.element);
        }

        destroy() {
            this.element.remove();
            const index = window.siyuan.blockPanels.findIndex(item => item.element === this.element);
            window.siyuan.blockPanels.splice(index, 1);
        }
    }
    const dependencies = {
        BlockPanel: Panel,
        fetchSyncPost: () => new Promise(resolve => requests.push(resolve)),
        hideTooltip: () => {},
        Constants: {TIMEOUT_INPUT: 5},
        isTouchDevice: () => false,
        isEncryptedBox: () => false,
        isListItemActionElement: () => false,
        isAbove: () => false,
    };
    const api = new Function(...Object.keys(dependencies), source +
        "; return {initBlockPopover, suspendBlockPopover, showPopover};")(...Object.values(dependencies));
    window.siyuan = {
        config: {editor: {floatWindowMode: 0, floatWindowDelay: 20}},
        menus: {menu: {element: document.createElement("div")}},
        blockPanels: [],
    } as unknown as typeof window.siyuan;
    window.JSAndroid = {} as typeof window.JSAndroid;
    const root = document.createElement("div");
    root.className = "list-mindmap";
    root.innerHTML = '<span data-type="block-ref" data-id="test">Reference</span>';
    document.body.append(root);
    const ref = root.firstElementChild as HTMLElement;
    const hover = () => ref.dispatchEvent(new MouseEvent("mouseover", {bubbles: true}));
    const penHover = () => ref.dispatchEvent(new PointerEvent("pointerover", {bubbles: true, pointerType: "pen"}));
    const settle = () => new Promise(resolve => setTimeout(resolve, 60));
    const suspend = () => api.suspendBlockPopover(root, new PointerEvent("pointerdown"));
    api.initBlockPopover({});

    // 按下前已排队的悬停任务必须取消，结束交互也不补开。
    hover();
    let resume = suspend();
    await settle();
    check.equal(window.siyuan.blockPanels.length, 0);
    hover();
    await settle();
    check.equal(window.siyuan.blockPanels.length, 0);
    resume();
    await settle();
    check.equal(window.siyuan.blockPanels.length, 0);
    hover();
    await settle();
    check.equal(window.siyuan.blockPanels.length, 1, "fresh hover resumes after interaction");
    resume = suspend();
    check.equal(window.siyuan.blockPanels.length, 0, "an existing temporary panel closes on interaction");
    resume();

    hover();
    await settle();
    const pinned = window.siyuan.blockPanels[0];
    pinned.element.dataset.pin = "true";
    resume = suspend();
    check.equal(window.siyuan.blockPanels[0], pinned, "pinned panels survive interaction");
    resume();
    pinned.destroy();

    // 多个脑图交互分别释放，取消其中一个不能恢复另一个的悬停。
    const otherRoot = document.createElement("div");
    document.body.append(otherRoot);
    resume = suspend();
    const resumeOther = api.suspendBlockPopover(otherRoot, new PointerEvent("pointerdown"));
    resume();
    hover();
    await settle();
    check.equal(window.siyuan.blockPanels.length, 0);
    resumeOther();

    // 引用查询在松手之后才完成时，仍属于已取消的悬停任务。
    window.siyuan.shiftIsPressed = true;
    hover();
    check.equal(requests.length, 1);
    window.siyuan.shiftIsPressed = false;
    resume = suspend();
    resume();
    requests.shift()({code: 0, data: {refDefs: [{refID: "test"}]}});
    await settle();
    check.equal(window.siyuan.blockPanels.length, 0, "late reference queries cannot reopen the panel");

    ref.dataset.type = "virtual-block-ref";
    delete ref.dataset.id;
    hover();
    await settle();
    check.equal(requests.length, 1);
    resume = suspend();
    resume();
    requests.shift()({code: 0, data: {refDefs: [{refID: "virtual"}]}});
    await settle();
    check.equal(window.siyuan.blockPanels.length, 0, "late virtual reference queries are also cancelled");
    ref.dataset.type = "block-ref";
    ref.dataset.id = "test";

    penHover();
    resume = suspend();
    await settle();
    check.equal(window.siyuan.blockPanels.length, 0, "pen hover timers are cancelled with mouse hover timers");
    resume();
    penHover();
    await settle();
    check.equal(window.siyuan.blockPanels.length, 1);
    check.equal(window.siyuan.config.editor.floatWindowMode, 0);
    check.equal(window.siyuan.config.editor.floatWindowDelay, 20);
    return "Popover interaction cases passed";
};

test("mindmap interaction cancels pending popovers and preserves hover preferences and pinned panels", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 20000,
}, async () => {
    const source = ["../protyle/util/hasClosest.ts", "popover.ts"].map(file => transpileModule(
        readFileSync(path.join(__dirname, file), "utf8").replace(/^import [\s\S]*?;\r?\n/gm, "").replace(/^export /gm, ""),
        {compilerOptions: {target: ScriptTarget.ES2021}},
    ).outputText).join("\n");
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-popover-test-"));
    const script = path.join(temporary, "run.cjs");
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false}});
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
        const executable = require("electron") as unknown as string;
        const result = await promisify(execFile)(executable, [script], {env, timeout: 15000, windowsHide: true});
        assert.match(result.stdout, /Popover interaction cases passed/);
    } finally {
        rmSync(temporary, {recursive: true, force: true});
    }
});
