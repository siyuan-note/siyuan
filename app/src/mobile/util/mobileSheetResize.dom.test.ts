import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {compile} from "sass";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const browserCases = async (sources: string[]) => {
    const check: typeof assert = require("node:assert/strict");
    const viewport = {top: 0, bottom: 800};
    const dependencies: Record<string, any> = {
        getVisibleViewportBounds: () => viewport, isMobileLandscape: () => false,
        waitForSheetViewport: (options: {open: () => void}) => { options.open(); return () => {}; },
    };
    Object.defineProperty(window, "siyuan", {value: {mobile: {size: {portrait: {height1: 800}}}}});
    for (const source of sources) {
        const exports = {};
        new Function("exports", "require", source)(exports, () => dependencies);
        Object.assign(dependencies, exports);
    }
    document.body.style.cssText = "--b3-font-size:16px;--mobile-top-safe-area:20px;--mobile-bottom-bar-safe-area:30px";
    document.body.innerHTML = `<div class="mobile-bottom-sheet-dialog b3-dialog--open"><div class="b3-dialog">
<div class="b3-dialog__scrim"></div><div class="b3-dialog__container mobile-bottom-sheet" style="width:100vw">
<div class="b3-menu__title b3-menu__title--root"></div><div class="b3-dialog__header">Title</div>
<div class="b3-dialog__body"><div class="b3-dialog__content"><input></div>
<div class="b3-dialog__action"><button class="b3-button">Confirm</button></div></div></div></div></div>`;
    const markup = document.body.innerHTML;
    const sheet = document.querySelector<HTMLElement>(".b3-dialog__container");
    const body = sheet.querySelector<HTMLElement>(".b3-dialog__body");
    const content = sheet.querySelector<HTMLElement>(".b3-dialog__content");
    const footer = sheet.querySelector<HTMLElement>(".b3-dialog__action");
    const layout = dependencies.bindMobileSheetLayout(document.querySelector(".b3-dialog"), sheet);
    const natural = sheet.getBoundingClientRect().height;
    layout.setPreferredHeight(650);
    const bounds = layout.getBounds();
    check.ok(bounds.min <= natural + 1, "a stretched flex body must not inflate the natural minimum");
    check.equal(bounds.max, 750, "safe regions are subtracted once");
    check.equal(sheet.getBoundingClientRect().height, 650);
    check.equal(body.style.flex, "");
    layout.setPreferredHeight(bounds.min);
    check.ok(footer.getBoundingClientRect().bottom <= sheet.getBoundingClientRect().bottom + 1);
    content.innerHTML = "<div style='height:1200px'>Long content</div>";
    layout.setPreferredHeight(650);
    layout.resize();
    check.equal(sheet.getBoundingClientRect().height, 650, "content mutation preserves the manual height");
    const longBounds = layout.getBounds();
    check.ok(longBounds.min > bounds.min && longBounds.min < 650);
    layout.setMode("expanded");
    check.equal(sheet.getBoundingClientRect().height, 750);
    layout.setMode("standard");
    check.equal(sheet.getBoundingClientRect().height, 650);
    viewport.bottom = 300;
    layout.resize();
    check.equal(sheet.getBoundingClientRect().height, 250);
    viewport.bottom = 800;
    layout.resize();
    check.equal(sheet.getBoundingClientRect().height, 650, "keyboard recovery restores the preferred height");
    layout.dispose();
    for (const gate of ["child", "root-inert", "body-inert", "root-busy", "body-busy", "business", "closing"]) {
        document.body.innerHTML = markup;
        const root = document.querySelector<HTMLElement>(".mobile-bottom-sheet-dialog");
        const panel = root.querySelector<HTMLElement>(".b3-dialog__container");
        panel.querySelector(".b3-menu__title").remove();
        const panelBody = panel.querySelector<HTMLElement>(".b3-dialog__body");
        const dialog = {element: root};
        window.siyuan.dialogs = [dialog as any];
        let businessBlocked = false;
        let closes = 0;
        const dispose = dependencies.bindBottomSheetDialog(dialog, async () => { closes++; }, undefined, undefined,
            {canStart: () => !businessBlocked});
        const grip = panel.querySelector<HTMLElement>(":scope > .b3-menu__title");
        const block = (enabled: boolean) => {
            if (gate === "child") window.siyuan.dialogs = enabled ? [dialog as any, {} as any] : [dialog as any];
            if (gate === "root-inert") root.inert = enabled;
            if (gate === "body-inert") panelBody.inert = enabled;
            if (gate === "root-busy") root.setAttribute("aria-busy", String(enabled));
            if (gate === "body-busy") panelBody.setAttribute("aria-busy", String(enabled));
            if (gate === "business") businessBlocked = enabled;
            if (gate === "closing") {
                root.dataset.dialogClosing = String(enabled);
                if (enabled) panel.style.transform = "translateY(100%)";
            }
        };
        const touch = (type: string, y: number) => {
            const point = {identifier: 1, clientX: 100, clientY: y};
            const event = new Event(type, {bubbles: true, cancelable: true});
            Object.defineProperties(event, {touches: {value: [point]}, changedTouches: {value: [point]}});
            grip.dispatchEvent(event);
        };
        const initial = panel.getBoundingClientRect().height;
        block(true);
        touch("touchstart", 0);
        touch("touchmove", -100);
        touch("touchend", -100);
        check.equal(panel.getBoundingClientRect().height, initial, gate + " blocks initiation");
        block(false);
        touch("touchstart", 0);
        touch("touchmove", -100);
        const resized = panel.getBoundingClientRect().height;
        check.ok(resized > initial, gate + " allows the owning ready dialog");
        block(true);
        touch("touchend", -200);
        check.equal(panel.getBoundingClientRect().height, resized, gate + " blocks active completion");
        if (gate === "closing") check.equal(panel.style.transform, "translateY(100%)");
        check.equal(closes, 0);
        dispose();
    }
    viewport.bottom = window.innerHeight;
    document.body.innerHTML = markup;
    const fractionalRoot = document.querySelector<HTMLElement>(".mobile-bottom-sheet-dialog");
    fractionalRoot.style.cssText = `position:fixed;top:0;left:0;width:100%;height:${window.innerHeight + .375}px;transform:translateX(0)`;
    const fractionalPanel = fractionalRoot.querySelector<HTMLElement>(".mobile-bottom-sheet");
    const fractionalLayout = dependencies.bindMobileSheetLayout(fractionalRoot.querySelector(".b3-dialog"), fractionalPanel);
    const assertBottom = () => {
        const overlay = fractionalRoot.querySelector<HTMLElement>(".b3-dialog");
        const expected = fractionalRoot.getBoundingClientRect().bottom - parseFloat(getComputedStyle(overlay).paddingBottom);
        check.ok(Math.abs(fractionalPanel.getBoundingClientRect().bottom - expected) < .05,
            "the sheet covers the fractional CSS viewport edge rather than leaving a physical hairline: " +
            JSON.stringify({expected, panel: fractionalPanel.getBoundingClientRect().toJSON(),
                overlay: overlay.getBoundingClientRect().toJSON(), style: overlay.style.cssText}));
    };
    assertBottom();
    fractionalLayout.setMode("expanded");
    assertBottom();
    fractionalLayout.dispose();
    const wait = (duration: number) => new Promise(resolve => setTimeout(resolve, duration));
    for (const source of ["swipe", "external", "refused"]) {
        document.body.innerHTML = markup;
        const root = document.querySelector<HTMLElement>(".mobile-bottom-sheet-dialog");
        const panel = root.querySelector<HTMLElement>(".mobile-bottom-sheet");
        panel.querySelector(".b3-menu__title").remove();
        const dialog = {element: root};
        window.siyuan.dialogs = [dialog as any];
        const close = () => {
            if (source === "refused") return false;
            root.dataset.dialogClosing = "true";
            root.classList.remove("b3-dialog--open");
            return true;
        };
        const dispose = dependencies.bindBottomSheetDialog(dialog, async () => close());
        await wait(200);
        const header = panel.querySelector<HTMLElement>(".b3-dialog__header");
        const touch = (type: string, y: number) => {
            const point = {identifier: 1, clientX: 100, clientY: y};
            const event = new Event(type, {bubbles: true, cancelable: true});
            Object.defineProperties(event, {touches: {value: [point]}, changedTouches: {value: [point]}});
            header.dispatchEvent(event);
        };
        const distance = Math.min(120, panel.clientHeight * .25) + 10;
        touch("touchstart", 0);
        touch("touchmove", distance);
        const offset = () => new DOMMatrixReadOnly(getComputedStyle(panel).transform).m42;
        check.ok(Math.abs(offset() - distance) < .05);
        if (source === "external") close();
        else touch("touchend", distance);
        await wait(0);
        if (source === "refused") {
            check.equal(root.classList.contains("b3-dialog--open"), true);
        } else {
            check.equal(root.dataset.dialogClosing, "true");
            check.equal(panel.style.transition, "");
            check.equal(panel.style.transform, "");
        }
        // 显式推进浏览器生成的过渡，避免隐藏窗口等待合成器帧。
        const transition = panel.getAnimations()[0];
        check.ok(transition, "closing and refusing a dragged sheet both create a CSS transition");
        transition.pause();
        transition.currentTime = Number(transition.effect.getComputedTiming().duration) / 2;
        if (source === "refused") check.ok(offset() < distance && offset() > 0, "refused closes rebound smoothly");
        else check.ok(offset() > distance && offset() < panel.getBoundingClientRect().height,
            "the close transition continues beyond the last drag position");
        transition.finish();
        check.ok(Math.abs(offset() - (source === "refused" ? 0 : panel.getBoundingClientRect().height)) < .05,
            "accepted closes finish offscreen and refused closes rebound");
        dispose();
    }
    return "Sheet resize geometry passed";
};

const headless = process.env.SIYUAN_TEST_HEADLESS === "1";

test("real sheet geometry keeps short minimums and footer visible across manual and keyboard resizing", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY && !headless,
    timeout: 30000,
}, async () => {
    const sources = ["mobileSheetGesture", "mobileSheetLayout", "bindBottomSheetDrag", "bindBottomSheetDialog"].map(id => transpileModule(
        readFileSync(`src/mobile/util/${id}.ts`, "utf8"), {
            compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
        }).outputText);
    const css = compile("src/assets/scss/mobile.scss", {logger: {warn() {}}}).css;
    const directory = mkdtempSync(join(tmpdir(), "siyuan-sheet-resize-"));
    const script = join(directory, "run.cjs");
    const code = `const __name = value => value; (${browserCases.toString()})(${JSON.stringify(sources)})`;
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(join(directory, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show:false, width:390, height:900, webPreferences:{nodeIntegration:true, contextIsolation:false, backgroundThrottling:false}});
    try {
        await win.loadURL("about:blank");
        if (${headless}) {
            win.showInactive();
            win.webContents.enableDeviceEmulation({screenPosition:"mobile", screenSize:{width:390,height:900},
                viewSize:{width:390,height:900}, deviceScaleFactor:1, scale:1});
        }
        await win.webContents.insertCSS(${JSON.stringify(css)});
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(code)}));
        win.destroy(); app.exit(0);
    } catch (error) { console.error(error); win.destroy(); app.exit(1); }
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const arguments_ = [...(headless ? ["--ozone-platform=headless", "--disable-gpu"] : []), script];
        const result = await promisify(execFile)(require("electron") as unknown as string, arguments_, {env, timeout: 25000});
        assert.match(result.stdout, /Sheet resize geometry passed/);
    } finally {
        rmSync(directory, {recursive: true, force: true});
    }
});
