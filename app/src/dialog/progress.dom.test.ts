import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {compileString} from "sass";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const browserCases = (progressSource: string, touchSource: string, css: string) => {
    const check = (value: boolean, message: string) => { if (!value) throw new Error(message); };
    document.head.insertAdjacentHTML("beforeend", `<style>${css}</style>`);
    document.body.innerHTML = '<div class="side-mask"></div><div class="b3-dialog" style="z-index:99"></div>';
    window.siyuan = {zIndex: 100, mobile: {}, languages: {_kernel: {35: "Reindexing"}}} as any;
    const api = {} as typeof import("./progress");
    new Function("exports", progressSource)(api);
    api.progressLoading({code: 1, msg: "Reindexing"} as IWebSocketData);
    const root = document.getElementById("progress");
    const scrim = root.firstElementChild as HTMLElement;
    const card = root.lastElementChild as HTMLElement;
    const bounds = root.getBoundingClientRect();
    check(bounds.x === 0 && bounds.y === 0 && bounds.width === innerWidth && bounds.height === innerHeight,
        "progress root must cover the viewport");
    check(getComputedStyle(root).position === "fixed" && root.style.zIndex === "101", "root must own the stacking context");
    check(document.elementFromPoint(1, 1) === scrim, "scrim must cover the existing dialog");
    check(getComputedStyle(scrim).touchAction === "none", "scrim must block native panning");
    check(getComputedStyle(card).touchAction === "auto", "card must retain native scrolling");
    check(root.hasAttribute("data-reindex-progress"), "reindex status binding must survive");
    api.progressLoading({code: 1, msg: "Long progress message ".repeat(1000)} as IWebSocketData);
    check(document.getElementById("progress") === root, "updates must preserve the task root");
    card.scrollTop = 100;
    check(card.scrollHeight > card.clientHeight && card.scrollTop === 100, "long progress card must scroll");

    let panelChanges = 0;
    const touch = {} as typeof import("../mobile/util/touch");
    const dependencies = {
        getSidebarElement: (): null => null, setSidebarSwipeState: () => {},
        popSidebar: () => panelChanges++, closePanel: () => panelChanges++, closeModel: () => panelChanges++,
        resetAndroidBoundedSelectionGesture: () => {}, getCurrentEditor: (): null => null,
        hasClosestByAttribute: (element: HTMLElement, attribute: string, value: string) =>
            element.closest(value === null ? `[${attribute}]` : `[${attribute}="${value}"]`),
        hasClosestByClassName: (element: HTMLElement, name: string) => element.closest(`.${name}`),
        isInAndroid: () => false, isInHarmony: () => false, isIOSDevice: () => false,
        Constants: {SIZE_DRAG_THRESHOLD: 5},
    };
    new Function("exports", "require", touchSource)(touch, () => dependencies);
    window.getSelection().removeAllRanges();
    for (const target of [scrim, card]) {
        for (const cancel of [false, true]) {
            const event = (x: number) => ({target, timeStamp: x, defaultPrevented: false,
                touches: [{target, clientX: x, clientY: 200}], changedTouches: [{target, clientX: x, clientY: 200}]}) as unknown as TouchEvent;
            touch.handleTouchStart(event(100));
            touch.handleTouchMove(event(300));
            if (cancel) touch.handleTouchCancel();
            else touch.handleTouchEnd(event(300));
        }
    }
    check(panelChanges === 0, "progress gestures must not open or close background panels");

    let clicks = 0;
    api.progressLoading({code: 1, msg: "Exiting"} as IWebSocketData, "exitProgress",
        {label: "Cancel", callback: () => clicks++});
    const exit = document.getElementById("exitProgress");
    const button = exit.querySelector("button");
    check(document.activeElement === button, "explicit progress action must retain focus");
    button.click();
    check(clicks === 1, "progress action must remain usable");
    api.progressLoading({code: 2} as IWebSocketData);
    check(!root.isConnected && exit.isConnected, "closing one task must retain the other");
    api.progressLoading({code: 2} as IWebSocketData, "exitProgress");
    check(!exit.isConnected, "each task must close independently");
    return "Progress DOM cases passed";
};

test("progress overlays cover dialogs, isolate mobile gestures and preserve scrolling and actions", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 45000,
}, async () => {
    const compile = (file: string) => transpileModule(readFileSync(file, "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2020},
    }).outputText;
    const progress = compile("src/dialog/progress.ts");
    const touch = compile("src/mobile/util/touch.ts");
    const css = compileString(readFileSync("src/assets/scss/component/_dialog.scss", "utf8")).css;
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-progress-test-"));
    const script = path.join(temporary, "run.cjs");
    const code = `const __name = value => value; (${browserCases.toString()})(${JSON.stringify(progress)}, ${JSON.stringify(touch)}, ${JSON.stringify(css)})`;
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, width: 384, height: 808,
        webPreferences: {nodeIntegration: true, contextIsolation: false, backgroundThrottling: false}});
    try {
        await win.loadURL("about:blank");
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(code)}));
        win.destroy(); app.exit(0);
    } catch (error) {
        console.error(error); win.destroy(); app.exit(1);
    }
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const {stdout} = await promisify(execFile)(require("electron") as unknown as string, [script],
            {env, timeout: 40000, windowsHide: true});
        assert.match(stdout, /Progress DOM cases passed/);
    } finally {
        assert.equal(path.dirname(path.resolve(temporary)), path.resolve(tmpdir()));
        assert.ok(path.basename(temporary).startsWith("siyuan-progress-test-"));
        rmSync(temporary, {recursive: true, force: true});
    }
});
