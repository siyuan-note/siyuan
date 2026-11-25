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
    document.body.innerHTML = `<div id="keyboardToolbar" style="height:40px"></div>
<div id="host"><div class="mobile-bottom-sheet" style="height:100px;visibility:hidden"></div></div>
<div class="b3-menu--sheet" style="height:100px"></div>`;
    const toolbar = document.getElementById("keyboardToolbar");
    const dialogSheet = document.querySelector<HTMLElement>(".mobile-bottom-sheet");
    const menuSheet = document.querySelector<HTMLElement>(".b3-menu--sheet");
    const settle = () => new Promise(resolve => setTimeout(resolve, 40));
    const active = () => toolbar.classList.contains("keyboard--sheet-open");
    const disposeDialogState = dependencies.bindKeyboardSheetState(dialogSheet);
    check.equal(active(), false, "an unopened sheet does not expose the theme state");
    dialogSheet.style.visibility = "";
    await settle();
    check.equal(active(), true);
    const theme = document.createElement("style");
    theme.textContent = "#keyboardToolbar.keyboard--sheet-open {display:none}";
    document.head.append(theme);
    await settle();
    check.equal(active(), true, "theme-derived visibility cannot feed back into the application state");
    toolbar.classList.add("fn__none");
    await settle();
    check.equal(active(), false, "explicit application hiding still clears a theme-hidden toolbar");
    toolbar.classList.remove("fn__none");
    await settle();
    check.equal(active(), true);
    theme.remove();
    toolbar.style.display = "none";
    await settle();
    check.equal(active(), false);
    toolbar.style.display = "";
    await settle();
    check.equal(active(), true);
    const disposeMenuState = dependencies.bindKeyboardSheetState(menuSheet);
    disposeDialogState();
    check.equal(active(), true, "closing a dialog must preserve an overlapping menu's state");
    menuSheet.hidden = true;
    await settle();
    check.equal(active(), false);
    menuSheet.hidden = false;
    await settle();
    check.equal(active(), true);
    menuSheet.remove();
    await settle();
    check.equal(active(), false, "removed sheets must not leave stale state");
    disposeMenuState();
    const disposeAgain = dependencies.bindKeyboardSheetState(dialogSheet);
    check.equal(active(), true);
    document.getElementById("host").style.display = "none";
    await settle();
    check.equal(active(), false, "hidden ancestors are respected");
    disposeAgain();
    disposeAgain();
    check.equal(active(), false);
    document.body.style.cssText = "--b3-font-size:16px;--mobile-top-safe-area:20px;--mobile-bottom-bar-safe-area:30px";
    document.body.innerHTML = `<div class="mobile-bottom-sheet-dialog b3-dialog--open"><div class="b3-dialog">
<div class="b3-dialog__scrim"></div><div class="b3-dialog__container mobile-bottom-sheet" style="width:100vw">
<div class="b3-menu__title b3-menu__title--root"></div><div class="b3-dialog__header">Title</div>
<div class="b3-dialog__body"><div class="b3-dialog__content"><input></div>
<div class="b3-dialog__action"><button class="b3-button">Confirm</button></div></div></div></div></div>`;
    const markup = document.body.innerHTML;
    const sheet = document.querySelector<HTMLElement>(".b3-dialog__container");
    const content = sheet.querySelector<HTMLElement>(".b3-dialog__content");
    const footer = sheet.querySelector<HTMLElement>(".b3-dialog__action");
    const layout = dependencies.bindMobileSheetLayout(document.querySelector(".b3-dialog"), sheet);
    check.equal(sheet.getBoundingClientRect().height, Math.max(innerHeight, 800) / 2);
    check.ok(footer.getBoundingClientRect().bottom <= sheet.getBoundingClientRect().bottom + 1);
    content.innerHTML = "<div style='height:1200px'>Long content</div>";
    content.scrollTop = 300;
    check.equal(content.scrollTop, 300);
    layout.setMode("expanded");
    check.equal(sheet.getBoundingClientRect().height, 750, "full height subtracts the safe regions once");
    check.equal(content.scrollTop, 300, "expanding a long sheet keeps the scroll position");
    const settingInput = document.createElement("input");
    settingInput.value = "plugin setting";
    content.firstElementChild.prepend(settingInput);
    settingInput.focus({preventScroll: true});
    settingInput.setSelectionRange(2, 5);
    viewport.bottom = 300;
    layout.resize();
    check.equal(sheet.getBoundingClientRect().height, 250);
    viewport.bottom = 800;
    layout.resize();
    check.equal(sheet.getBoundingClientRect().height, 750, "keyboard recovery restores full height");
    check.equal(content.scrollTop, 300);
    check.equal(document.activeElement, settingInput);
    check.equal(settingInput.selectionStart, 2);
    check.equal(settingInput.selectionEnd, 5);
    layout.dispose();
    document.body.classList.add("body--ios");
    for (const safeArea of [34, 21, 0]) {
        document.body.style.setProperty("--mobile-bottom-bar-safe-area", `${safeArea}px`);
        for (const bottom of [800, 300]) {
            viewport.bottom = bottom;
            document.body.innerHTML = markup;
            const iosOverlay = document.querySelector<HTMLElement>(".b3-dialog");
            const iosPanel = document.querySelector<HTMLElement>(".mobile-bottom-sheet");
            const iosFooter = iosPanel.querySelector<HTMLElement>(".b3-dialog__action");
            const iosLayout = dependencies.bindMobileSheetLayout(iosOverlay, iosPanel);
            check.equal(getComputedStyle(iosOverlay).paddingBottom, "0px");
            check.equal(parseFloat(getComputedStyle(iosPanel).paddingBottom), safeArea);
            check.ok(Math.abs(iosPanel.getBoundingClientRect().bottom - bottom) < 1,
                "iOS sheet background reaches the viewport or keyboard edge");
            check.ok(iosFooter.getBoundingClientRect().bottom <= bottom - safeArea + 1,
                "iOS action buttons remain above the home indicator safe area");
            iosLayout.setMode("expanded");
            check.equal(iosPanel.getBoundingClientRect().height, bottom - 20,
                "iOS safe area is inside the panel and must not be subtracted twice");
            iosLayout.dispose();
        }
    }
    document.body.classList.remove("body--ios");
    document.documentElement.dataset.frontend = "mobile";
    document.body.classList.add("body--android");
    document.body.style.setProperty("--android-navigation-bar-height", "48px");
    document.body.innerHTML = markup;
    const flashcard = document.querySelector<HTMLElement>(".mobile-bottom-sheet-dialog");
    flashcard.dataset.key = "dialog-opencard";
    const flashcardPanel = flashcard.querySelector<HTMLElement>(".mobile-bottom-sheet");
    flashcardPanel.querySelector(".b3-dialog__body").innerHTML = `<div class="card__main" style="height:100%">
<div class="card__block protyle fn__flex-1"><div class="protyle-content">Card</div></div>
<div class="card__action"><button class="b3-button">Rate</button></div></div>`;
    check.equal(getComputedStyle(flashcardPanel).paddingBottom, "48px");
    document.body.classList.add("mobile-keyboard--open");
    check.equal(getComputedStyle(flashcardPanel).paddingBottom, "0px",
        "flashcard ratings do not reserve the navigation area above the keyboard");
    document.body.insertAdjacentHTML("beforeend", '<div id="keyboardToolbar" style="position:fixed;top:450px;height:48px;width:100%"></div>');
    const flashcardLayout = dependencies.bindMobileSheetLayout(flashcard.querySelector(".b3-dialog"), flashcardPanel,
        {initiallyExpanded: true});
    const editor = flashcardPanel.querySelector<HTMLElement>(".card__block");
    const rate = flashcardPanel.querySelector("button");
    const gap = () => flashcardPanel.getBoundingClientRect().bottom - rate.getBoundingClientRect().bottom;
    const normalGap = gap();
    dependencies.getMobileToolbarPaddingElement({element: editor})?.style.setProperty("padding-bottom", "48px");
    check.equal(gap(), normalGap, "the flashcard drawer already positions its ratings above the keyboard toolbar");
    flashcardLayout.dispose();
    flashcard.removeAttribute("data-key");
    check.equal(getComputedStyle(flashcardPanel).paddingBottom, "48px");
    flashcard.dataset.key = "dialog-opencard";
    document.body.classList.remove("mobile-keyboard--open");
    check.equal(getComputedStyle(flashcardPanel).paddingBottom, "48px",
        "flashcard ratings regain the Android navigation inset after input ends");
    document.body.classList.remove("body--android");
    delete document.documentElement.dataset.frontend;
    document.body.style.removeProperty("--android-navigation-bar-height");
    document.body.style.setProperty("--mobile-bottom-bar-safe-area", "30px");
    viewport.bottom = 800;
    document.body.innerHTML = markup;
    const expandedRoot = document.querySelector<HTMLElement>(".mobile-bottom-sheet-dialog");
    const expandedPanel = expandedRoot.querySelector<HTMLElement>(".b3-dialog__container");
    expandedPanel.querySelector(".b3-menu__title").remove();
    let heightAtOpen: number;
    const disposeExpanded = dependencies.bindBottomSheetDialog({element: expandedRoot}, async () => true, undefined,
        () => { heightAtOpen = expandedPanel.getBoundingClientRect().height; }, {initiallyExpanded: true});
    check.equal(heightAtOpen, 750, "an initially expanded sheet opens at full available height");
    viewport.bottom = 500;
    window.dispatchEvent(new Event("resize"));
    check.equal(expandedPanel.getBoundingClientRect().height, 450, "the keyboard clips the expanded sheet");
    viewport.bottom = 800;
    window.dispatchEvent(new Event("resize"));
    check.equal(expandedPanel.getBoundingClientRect().height, 750, "the sheet returns to full height after keyboard dismissal");
    disposeExpanded();

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
        check.equal(panel.getBoundingClientRect().height, initial, gate + " defers expansion until release");
        block(true);
        touch("touchend", -200);
        check.equal(panel.getBoundingClientRect().height, initial, gate + " blocks active completion");
        if (gate === "closing") check.equal(panel.style.transform, "translateY(100%)");
        check.equal(closes, 0);
        block(false);
        touch("touchstart", 0);
        touch("touchmove", -100);
        touch("touchend", -100);
        const expansion = panel.getAnimations().find(animation => !(animation instanceof CSSTransition));
        check.ok(expansion, gate + " animates the height on release");
        expansion.pause();
        expansion.currentTime = Number(expansion.effect.getComputedTiming().duration) / 2;
        const height = panel.getBoundingClientRect().height;
        check.ok(height > initial && height < 750, gate + " passes through intermediate heights");
        expansion.finish();
        check.equal(panel.getBoundingClientRect().height, 750, gate + " allows a fresh grip gesture");
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

test("real sheet geometry preserves its selected height, safe areas and guarded dismissal", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY && !headless,
    // 样式编译和临时目录清理计入父测试，浏览器仍受独立的执行期限约束。
    timeout: 45000,
}, async () => {
    const sources = ["protyle/util/browserCompatibility", "protyle/wysiwyg/nativeTextMenu", "protyle/lite/mobileToolbar", "mobile/util/keyboardSheetState",
        "mobile/util/mobileSheetGesture", "mobile/util/mobileSheetLayout", "mobile/util/bindBottomSheetDrag",
        "mobile/util/bindBottomSheetDialog"].map(id => transpileModule(
        readFileSync(`src/${id}.ts`, "utf8"), {
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
        // Exercise actual animation regardless of the runner's accessibility settings.
        win.webContents.debugger.attach();
        await win.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", {
            features: [{name: "prefers-reduced-motion", value: "no-preference"}],
        });
        if (!await win.webContents.executeJavaScript('matchMedia("(prefers-reduced-motion: no-preference)").matches')) {
            throw new Error("Sheet resize test could not disable reduced motion emulation");
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
