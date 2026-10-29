const assert = require("node:assert/strict");
const {mkdtempSync, readFileSync, rmSync} = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const {test} = require("node:test");
const {runInNewContext} = require("node:vm");
const ts = require("typescript");
const sass = require("sass");

const settingsHTML = () => {
    const exports = {};
    const languages = JSON.parse(readFileSync(path.join(__dirname, "../appearance/langs/zh-CN.json"), "utf8"));
    const source = readFileSync(path.join(__dirname, "../src/config/tabs/lockScreenWallpaper.ts"), "utf8");
    runInNewContext(ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS}}).outputText, {
        exports, require: () => ({}), window: {siyuan: {languages}},
    });
    return `<div class="fn__flex b3-label config-item">
        <div class="fn__flex-1 config-item__main">${languages.about5}</div><span class="fn__space"></span>
        <button class="b3-button b3-button--outline fn__flex-center fn__size200" data-reference>${languages.config}</button>
    </div>${exports.genLockScreenWallpaperHtml()}`;
};

const checkSettingsLayout = async (html, css, fontSize) => {
    const check = require("node:assert/strict");
    document.head.innerHTML = "<style></style>";
    document.querySelector("style").textContent = css + `body {font-size:${fontSize}px; --b3-font-size:${fontSize}px;}`;
    document.body.innerHTML = html;
    const item = document.querySelector("[data-lock-screen-wallpaper]");
    const actions = document.querySelector("[data-wallpaper-upload]").parentElement;
    const preview = item.querySelector("[data-wallpaper-preview]");
    const canvas = document.createElement("canvas");
    canvas.width = 240;
    canvas.height = 160;
    const loaded = new Promise(resolve => preview.addEventListener("load", resolve, {once: true}));
    preview.src = canvas.toDataURL();
    await loaded;
    for (const showPreview of [false, true]) {
        preview.classList.toggle("fn__none", !showPreview);
        const rect = item.getBoundingClientRect();
        const group = actions.getBoundingClientRect();
        const upload = item.querySelector("[data-wallpaper-upload]");
        const reset = item.querySelector("[data-wallpaper-reset]");
        const builtIn = item.querySelector("[data-wallpaper-built-in]");
        const uploadRect = upload.getBoundingClientRect();
        const resetRect = reset.getBoundingClientRect();
        const builtInRect = builtIn.getBoundingClientRect();
        check.ok(item.scrollWidth <= item.clientWidth, "wallpaper setting does not overflow horizontally");
        check.ok(group.left >= rect.left && group.right <= rect.right, "actions fit the setting row");
        check.ok(resetRect.top >= uploadRect.bottom, "reset appears below upload");
        check.ok(uploadRect.top >= builtInRect.bottom, "built-in selection appears above upload");
        check.ok(Math.abs(builtInRect.left - uploadRect.left) < 1 && Math.abs(builtInRect.right - uploadRect.right) < 1,
            "built-in selection aligns with upload and reset");
        check.ok(Math.abs(uploadRect.left - resetRect.left) < 1 && Math.abs(uploadRect.right - resetRect.right) < 1,
            "stacked actions share horizontal bounds");
        check.equal(upload.querySelector("use").getAttribute("xlink:href"), "#iconUpload");
        check.equal(reset.querySelector("use").getAttribute("xlink:href"), "#iconUndo");
        check.equal(builtIn.querySelector("use").getAttribute("xlink:href"), "#iconImage");
        if (innerWidth > 750) {
            const reference = document.querySelector("[data-reference]").getBoundingClientRect();
            const main = item.querySelector(".config-item__main").getBoundingClientRect();
            check.ok(group.left >= main.right, "actions are to the right of the description and preview");
            check.ok(Math.abs(group.right - reference.right) < 1, "actions align with adjacent setting controls");
            check.equal(group.width, 200);
            for (const button of actions.querySelectorAll("button")) {
                check.ok(Math.abs(button.getBoundingClientRect().width - reference.width) < 1);
            }
        }
    }
};

// 只替换模板数据和无关的登录脚本，保留实际认证页的结构、样式及壁纸加载函数。
const fixtureHTML = (file, dark, glassSupported = true) => {
    let source = readFileSync(path.join(__dirname, "..", file), "utf8");
    const loader = /const loadLockScreenWallpaper = \(\) => \{[\s\S]*?\n {4}\};/.exec(source)[0];
    source = source.replace(/<script>[\s\S]*?<\/script>/g, "")
        .replace(/{{if not \.accessAuthCodeEnabled}}[\s\S]*?{{end}}/g, "")
        .replace(/{{(?:if \.\w+|end)}}/g, "")
        .replace(/{{\.workspace}}/g, "Workspace")
        .replace(/{{\.l\d+}}/g, "Sign in")
        .replace(/{{\.lockScreenReveal}}/g, "Click or press a key to sign in")
        .replace('<span id="lockScreenHint"></span>', '<span id="lockScreenHint">Click or press a key to sign in</span>')
        .replace("<main hidden>", "<main>");
    if (dark) source = source.replace('<html style="height: 100%">', '<html class="dark" style="height: 100%">');
    // 仅替换能力条件，验证不支持背景模糊时的实色回退样式。
    if (!glassSupported) source = source.replace(
        "@supports (backdrop-filter: blur(8px)) or (-webkit-backdrop-filter: blur(8px))",
        "@supports (siyuan-unsupported: true)");
    return source.replace("</body>", `<script>${loader}\nwindow.loadLockScreenWallpaper = loadLockScreenWallpaper;</script></body>`);
};

const checkLayout = async (wallpaperPresent, dark, remote, glass = true) => {
    const check = require("node:assert/strict");
    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = 800;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#e18a40";
    ctx.fillRect(0, 0, 600, 800);
    ctx.fillStyle = "#16384e";
    ctx.fillRect(600, 0, 600, 800);
    const wallpaper = document.getElementById("lockScreenWallpaper");
    const loaded = new Promise(resolve => wallpaper.addEventListener(wallpaperPresent ? "load" : "error", resolve, {once: true}));
    window.loadLockScreenWallpaper();
    wallpaper.src = wallpaperPresent ? canvas.toDataURL() : "data:image/jpeg;base64,Y29ycnVwdA==";
    await loaded;
    await new Promise(resolve => requestAnimationFrame(resolve));
    check.equal(document.body.classList.contains("has-wallpaper"), wallpaperPresent);
    check.equal(wallpaper.hidden, !wallpaperPresent);
    const panel = document.querySelector(remote ? "main" : "#authPanel");
    if (!remote) {
        check.equal(panel.querySelector(".ft__on-surface"), null, "the credits row is removed from authentication pages");
        check.equal(panel.lastElementChild.id, "authForm", "the login card ends with its sign-in form");
        check.ok(panel.lastElementChild.lastElementChild.classList.contains("auth-actions"),
            "the sign-in form ends with its actions");
    }
    const cover = document.getElementById("lockScreenCover");
    if (wallpaperPresent) {
        check.equal(panel.inert, true);
        check.equal(getComputedStyle(panel).opacity, "0");
        check.equal(getComputedStyle(panel).pointerEvents, "none");
        check.equal(cover.hidden, false);
        check.ok(document.getElementById("lockScreenTime").textContent);
        check.ok(document.getElementById("lockScreenDate").textContent);
        const group = document.getElementById("lockScreenClock").getBoundingClientRect();
        const clock = document.getElementById("lockScreenTime").getBoundingClientRect();
        const date = document.getElementById("lockScreenDate").getBoundingClientRect();
        const hint = document.getElementById("lockScreenHint").getBoundingClientRect();
        check.ok(clock.left >= 0 && clock.right <= innerWidth && date.left >= 0 && date.right <= innerWidth &&
            hint.left >= 0 && hint.right <= innerWidth && hint.bottom <= innerHeight,
            "clock and reveal hint fit narrow and short screens");
        check.ok(Math.abs((group.left + group.right) / 2 - innerWidth / 2) < 1 &&
            Math.abs((group.top + group.bottom) / 2 - innerHeight / 2) < 1,
            `time and date are centered together: ${JSON.stringify({x: group.x, y: group.y, width: group.width,
                height: group.height, viewport: [innerWidth, innerHeight], remote, classes: document.body.className,
                transform: getComputedStyle(document.getElementById("lockScreenClock")).transform})}`);
        check.ok(Math.abs((clock.left + clock.right) / 2 - innerWidth / 2) < 1 &&
            Math.abs((date.left + date.right) / 2 - innerWidth / 2) < 1,
            "time and date each align with the horizontal center");
        check.ok(hint.top > group.bottom && Math.abs((hint.left + hint.right) / 2 - innerWidth / 2) < 1,
            "reveal hint stays centered below the clock without overlapping it");
        const drag = document.querySelector(remote ? "#windowBar" : "[data-auth-drag]");
        check.ok(drag.contains(document.elementFromPoint(innerWidth / 2, 16)),
            "the top window drag area remains above the cover");
        cover.click();
        check.equal(panel.inert, false);
        check.equal(cover.inert, true);
        check.equal(getComputedStyle(panel).visibility, "visible");
        await Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {})));
        const raisedClock = document.getElementById("lockScreenClock");
        if (getComputedStyle(raisedClock).opacity === "1") {
            const raised = raisedClock.getBoundingClientRect();
            check.ok(raised.top >= 39 && raised.bottom + 15 <= panel.getBoundingClientRect().top,
                "the raised clock stays below the window bar and above the login card");
        }
    }
    const rect = panel.getBoundingClientRect();
    const style = getComputedStyle(panel);
    const blur = style.backdropFilter || style.webkitBackdropFilter;
    const forcedColors = matchMedia("(forced-colors: active)").matches;
    if (wallpaperPresent) {
        check.ok(rect.left >= 0 && rect.right <= innerWidth, "login panel fits the viewport horizontally");
        check.ok(rect.top >= 32 && rect.bottom <= innerHeight, "login panel fits below the drag area");
        check.ok(panel.scrollWidth <= panel.clientWidth, "login controls do not overflow the panel");
        check.equal(style.backgroundColor, forcedColors ? getComputedStyle(document.body).backgroundColor : (glass ?
            (dark ? "rgba(0, 0, 0, 0.06)" : "rgba(255, 255, 255, 0.08)") :
            (dark ? "rgb(30, 30, 30)" : "rgb(255, 255, 255)")));
        check.equal(blur, glass ? "blur(8px) saturate(1.05)" : "none");
        check.equal(style.opacity, "1", "glass affects the panel background, not its text and controls");
        check.equal(getComputedStyle(document.getElementById("authCode")).opacity, "1");
        // 更薄的玻璃使用反色文字阴影辅助阅读，同时检查壁纸合成色与阴影颜色的对比度。
        const luminance = rgb => rgb.map(value => value / 255).map(value =>
            value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
            .reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
        if (!forcedColors) {
            const field = getComputedStyle(document.getElementById("authCode"));
            const levels = [field.color, field.backgroundColor].map(color => luminance(color.match(/[\d.]+/g).map(Number).slice(0, 3)));
            check.ok((Math.max(...levels) + .05) / (Math.min(...levels) + .05) >= 4.5,
                "glass text colors do not reduce password input contrast");
        }
        const panelColor = style.backgroundColor.match(/[\d.]+/g).map(Number);
        const panelAlpha = panelColor[3] ?? 1;
        const brightness = Number(/brightness\(([\d.]+)\)/.exec(blur)?.[1] ?? 1);
        const selectors = remote ? ["h1", "label", ...(glass ? ["#origin"] : [])] : ["label", "h1"];
        for (const selector of forcedColors ? [] : selectors) {
            const textStyle = getComputedStyle(panel.querySelector(selector));
            const foreground = textStyle.color.match(/[\d.]+/g).map(Number);
            const alpha = (foreground[3] ?? 1) * Number(textStyle.opacity);
            let outlineContrast = 0;
            if (glass) {
                const outline = "rgb(0, 0, 0)";
                check.equal(textStyle.textShadow, `${outline} 0px 1px 3px`);
                const outlineLight = 0;
                check.ok(luminance(foreground.slice(0, 3)) > .8,
                    "transparent panels use clear light text in both application themes");
                const foregroundLight = luminance(foreground.slice(0, 3));
                outlineContrast = (Math.max(outlineLight, foregroundLight) + .05) /
                    (Math.min(outlineLight, foregroundLight) + .05);
                check.ok(outlineContrast >= 4.5, "the text shadow color remains distinct from its fill");
            }
            for (const wallpaperColor of [0, 255]) {
                const background = panelColor.slice(0, 3).map(value =>
                    value * panelAlpha + Math.min(255, wallpaperColor * brightness) * (1 - panelAlpha));
                const color = foreground.slice(0, 3).map((value, index) => value * alpha + background[index] * (1 - alpha));
                const values = [luminance(background), luminance(color)];
                const contrast = (Math.max(...values) + .05) / (Math.min(...values) + .05);
                check.ok(Math.max(contrast, outlineContrast) >= 4.5,
                    `${selector} contrast ${contrast} over wallpaper ${wallpaperColor} (dark=${dark}, remote=${remote}, glass=${glass})`);
            }
        }
        panel.scrollTop = panel.scrollHeight;
        const last = panel.querySelector(remote ? "#submit" : ".b3-button--white").getBoundingClientRect();
        check.ok(last.bottom <= rect.bottom && last.top >= rect.top, "login and exit actions remain reachable");
        const image = wallpaper.getBoundingClientRect();
        check.equal(image.width, innerWidth);
        check.equal(image.height, innerHeight);
        if (innerWidth >= 640 && innerHeight >= 600) {
            check.ok(rect.width > rect.height, "desktop login panel is wider than it is tall");
        }
    } else {
        check.equal(blur, "none", "default login has no glass effect");
        check.equal(style.backgroundColor, "rgba(0, 0, 0, 0)", "default login keeps its original panel background");
    }
};

const prepareKeyboardCase = async () => {
    const wallpaper = document.getElementById("lockScreenWallpaper");
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    window.loadLockScreenWallpaper();
    const loaded = new Promise(resolve => wallpaper.addEventListener("load", resolve, {once: true}));
    wallpaper.src = canvas.toDataURL();
    await loaded;
    window.testSubmits = 0;
    const form = document.getElementById("authForm");
    if (form) {
        form.addEventListener("submit", event => {
            event.preventDefault();
            window.testSubmits++;
        });
    } else {
        document.getElementById("authCode").addEventListener("keydown", event => {
            if (event.key === "Enter") window.testSubmits++;
        });
    }
};

const assertKeyboardState = async (value, submits) => {
    // 等待原生输入更新渲染状态，保留超时后的完整交互断言。
    const deadline = performance.now() + 5000;
    while ((document.getElementById("lockScreenCover").inert !== true ||
        document.getElementById("authCode").value !== value || document.activeElement !== document.getElementById("authCode") ||
        window.testSubmits !== submits) && performance.now() < deadline) {
        await new Promise(resolve => requestAnimationFrame(resolve));
    }
    await new Promise(resolve => requestAnimationFrame(resolve));
    const check = require("node:assert/strict");
    check.equal(document.getElementById("lockScreenCover").inert, true);
    check.equal(document.getElementById("authCode").value, value);
    check.equal(document.activeElement, document.getElementById("authCode"),
        `password focus after native input (value=${value}, submits=${submits})`);
    check.equal(window.testSubmits, submits, "native Enter events reach the revealed login form");
};

const checkTransition = async (remote, reduced) => {
    const check = require("node:assert/strict");
    const panel = document.querySelector(remote ? "main" : "#authPanel");
    const cover = document.getElementById("lockScreenCover");
    const clock = document.getElementById("lockScreenClock");
    const hint = document.getElementById("lockScreenHint");
    const targets = [panel, clock, hint];
    const animations = () => targets.flatMap(target => target.getAnimations());
    const centered = clock.getBoundingClientRect();
    cover.click();
    check.equal(panel.inert, false, "login is available before the transition ends");
    check.equal(document.activeElement, document.getElementById("authCode"));
    const entering = animations();
    if (reduced) {
        check.equal(entering.length, 0, "reduced motion switches directly without transitions");
        check.equal(getComputedStyle(panel).opacity, "1");
    } else {
        check.ok(entering.length >= 3);
        for (const animation of entering) {
            check.equal(animation.effect.getTiming().duration, animation.transitionProperty === "visibility" ? 0 : 200);
            animation.pause();
            animation.currentTime = 100;
        }
        const opacity = Number(getComputedStyle(panel).opacity);
        check.ok(opacity > 0 && opacity < 1, "the card fades in while moving upward");
        const y = new DOMMatrix(getComputedStyle(panel).transform).m42;
        check.ok(y > 0 && y < 20);
        check.ok(clock.getBoundingClientRect().top < centered.top, "time and date move upward together");
        check.ok(clock.getBoundingClientRect().bottom < panel.getBoundingClientRect().top,
            "the clock moves clear before the entering card becomes prominent");
        entering.forEach(animation => animation.finish());
    }
    const input = document.getElementById("authCode");
    input.value = "retained password";
    input.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true, cancelable: true}));
    check.equal(panel.inert, true);
    check.equal(cover.inert, false);
    const leaving = animations();
    if (reduced) {
        check.equal(leaving.length, 0);
    } else {
        check.ok(leaving.length >= 3);
        leaving.forEach(animation => { animation.pause(); animation.currentTime = 100; });
        const opacity = Number(getComputedStyle(panel).opacity);
        check.ok(opacity > 0 && opacity < 1, "Escape fades the card out rather than hiding it immediately");
        check.equal(getComputedStyle(panel).visibility, "visible");
        check.ok(new DOMMatrix(getComputedStyle(panel).transform).m42 > 0);
        check.ok(clock.getBoundingClientRect().bottom < panel.getBoundingClientRect().top,
            "the returning clock waits for the card to fade before crossing its position");
        leaving.forEach(animation => animation.finish());
    }
    check.equal(input.value, "retained password");
    check.equal(getComputedStyle(panel).opacity, "0");
    check.equal(getComputedStyle(panel).pointerEvents, "none");
    const restored = clock.getBoundingClientRect();
    check.ok(Math.abs((restored.top + restored.bottom) / 2 - innerHeight / 2) < 1);
    // 动画尚未完成时反向切换，最终状态和输入内容仍以最后一次操作为准。
    cover.click();
    input.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true, cancelable: true}));
    cover.click();
    await Promise.all(animations().map(animation => animation.finished.catch(() => {})));
    check.equal(panel.inert, false);
    check.equal(cover.inert, true);
    check.equal(getComputedStyle(panel).opacity, "1");
    check.equal(input.value, "retained password");
};

if (process.versions.electron && process.type === "browser") {
    const {app, BrowserWindow, nativeTheme} = require("electron");
    app.setPath("userData", process.argv[2]);
    app.whenReady().then(async () => {
        const win = new BrowserWindow({show: false, frame: false, webPreferences: {
            nodeIntegration: true, contextIsolation: false, offscreen: true, backgroundThrottling: false,
        }});
        win.webContents.on("console-message", event => {
            if (event.message.includes("AssertionError")) console.error(event.message);
        });
        let context;
        try {
            for (const file of ["stage/auth.html", "electron/remote-auth.html"]) {
                for (const [width, height] of [[1200, 800], [320, 640], [640, 320], [320, 280]]) {
                    win.setContentSize(width, height);
                    for (const dark of [false, true]) {
                        nativeTheme.themeSource = dark ? "dark" : "light";
                        for (const [present, glass] of [[false, true], [true, true], [true, false]]) {
                            context = {file, width, height, dark, present, glass};
                            await win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(fixtureHTML(file, dark, glass)));
                            await win.webContents.executeJavaScript(`(async () => {
                                try { await (${checkLayout.toString()})(${present}, ${dark}, ${file.startsWith("electron")}, ${glass}); }
                                catch (error) { console.error(error.stack); throw error; }
                            })()`);
                        }
                    }
                }
                win.webContents.debugger.attach("1.3");
                for (const feature of ["prefers-reduced-transparency", "forced-colors"]) {
                    await win.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", {
                        features: [{name: feature, value: feature === "forced-colors" ? "active" : "reduce"}],
                    });
                    for (const dark of [false, true]) {
                        context = {file, feature, dark};
                        nativeTheme.themeSource = dark ? "dark" : "light";
                        await win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(fixtureHTML(file, dark)));
                        await win.webContents.executeJavaScript(`(${checkLayout.toString()})(true, ${dark}, ${file.startsWith("electron")}, false)`);
                    }
                }
                await win.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", {features: []});
                for (const reduced of [false, true]) {
                    context = {file, reduced};
                    await win.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", {
                        features: [{name: "prefers-reduced-motion", value: reduced ? "reduce" : "no-preference"}],
                    });
                    win.setContentSize(1200, 900);
                    await win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(fixtureHTML(file, false)));
                    await win.webContents.executeJavaScript(`(${prepareKeyboardCase.toString()})()`);
                    await win.webContents.executeJavaScript(`(${checkTransition.toString()})(${file.startsWith("electron")}, ${reduced})`);
                }
                await win.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", {features: []});
                win.webContents.debugger.detach();
                win.setContentSize(1000, 700);
                const start = async () => {
                    await win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(fixtureHTML(file, false)));
                    await win.webContents.executeJavaScript(`(${prepareKeyboardCase.toString()})()`);
                };
                context = {file, input: "characters"};
                await start();
                for (const [type, keyCode] of [["keyDown", "A"], ["char", "a"], ["keyUp", "A"],
                    ["keyDown", "B"], ["char", "b"], ["keyUp", "B"]]) {
                    win.webContents.sendInputEvent({type, keyCode});
                }
                await win.webContents.executeJavaScript(`(${assertKeyboardState.toString()})("ab", 0)`);
                context = {file, input: "captcha"};
                await win.webContents.executeJavaScript(`{
                    const captcha = document.getElementById("captcha");
                    captcha.parentElement.style.display = "block";
                    captcha.value = "42"; captcha.focus(); captcha.setSelectionRange(2, 2);
                }`);
                win.webContents.sendInputEvent({type: "keyDown", keyCode: "Escape"});
                win.webContents.sendInputEvent({type: "keyUp", keyCode: "Escape"});
                await win.webContents.executeJavaScript(`(async () => {
                    const check = require("node:assert/strict");
                    const cover = document.getElementById("lockScreenCover");
                    const deadline = performance.now() + 5000;
                    while (cover.inert && performance.now() < deadline) {
                        await new Promise(resolve => requestAnimationFrame(resolve));
                    }
                    check.equal(document.getElementById("lockScreenCover").inert, false);
                    check.equal(document.getElementById("authCode").value, "ab");
                    check.equal(document.getElementById("captcha").value, "42");
                })()`);
                for (const [type, keyCode] of [["keyDown", "3"], ["char", "3"], ["keyUp", "3"]]) {
                    win.webContents.sendInputEvent({type, keyCode});
                }
                await win.webContents.executeJavaScript(`(async () => {
                    const check = require("node:assert/strict");
                    const captcha = document.getElementById("captcha");
                    const deadline = performance.now() + 5000;
                    while (captcha.value !== "423" && performance.now() < deadline) {
                        await new Promise(resolve => requestAnimationFrame(resolve));
                    }
                    await new Promise(resolve => requestAnimationFrame(resolve));
                    check.equal(document.activeElement, captcha);
                    check.equal(captcha.value, "423");
                    check.equal(document.getElementById("authCode").value, "ab");
                })()`);
                context = {file, input: "enter"};
                await start();
                win.webContents.sendInputEvent({type: "keyDown", keyCode: "Enter"});
                win.webContents.sendInputEvent({type: "char", keyCode: "\r"});
                win.webContents.sendInputEvent({type: "keyUp", keyCode: "Enter"});
                await win.webContents.executeJavaScript(`(${assertKeyboardState.toString()})("", 0)`);
                win.webContents.sendInputEvent({type: "keyDown", keyCode: "Enter"});
                win.webContents.sendInputEvent({type: "char", keyCode: "\r"});
                win.webContents.sendInputEvent({type: "keyUp", keyCode: "Enter"});
                await win.webContents.executeJavaScript(`(${assertKeyboardState.toString()})("", 1)`);
                context = {file, input: "pointer"};
                await start();
                win.webContents.sendInputEvent({type: "mouseDown", x: 40, y: 300, button: "left", clickCount: 1});
                win.webContents.sendInputEvent({type: "mouseUp", x: 40, y: 300, button: "left", clickCount: 1});
                await win.webContents.executeJavaScript(`(${assertKeyboardState.toString()})("", 0)`);
                context = {file, input: "composition"};
                await start();
                await win.webContents.executeJavaScript(`document.getElementById("lockScreenCover").dispatchEvent(
                    new KeyboardEvent("keydown", {key: "Process", isComposing: true, bubbles: true, cancelable: true}));`);
                await win.webContents.insertText("\u4e2d");
                await win.webContents.executeJavaScript(`(${assertKeyboardState.toString()})("\\u4e2d", 0)`);
            }
            const html = settingsHTML();
            for (const name of ["base", "mobile"]) {
                const styles = sass.compile(path.join(__dirname, `../src/assets/scss/${name}.scss`), {logger: sass.Logger.silent}).css;
                for (const theme of ["daylight", "midnight"]) {
                    const css = readFileSync(path.join(__dirname, `../appearance/themes/${theme}/theme.css`), "utf8") + styles;
                    for (const width of [1000, 600, 320]) {
                        context = {name, theme, width};
                        win.setContentSize(width, 800);
                        await win.loadURL("data:text/html,<html><body></body></html>");
                        await win.webContents.executeJavaScript(`(${checkSettingsLayout.toString()})(${[
                            html, css, width === 1000 ? 16 : 24,
                        ].map(value => JSON.stringify(value)).join(",")})`);
                    }
                }
            }
            console.log("Wallpaper layouts passed");
            win.destroy();
            app.exit(0);
        } catch (error) {
            console.error(context, error);
            win.destroy();
            app.exit(1);
        }
    });
} else {
    test("lock screen wallpapers preserve readable login actions on desktop, narrow and short screens in both themes", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 120000,
    }, async () => {
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-wallpaper-layout-"));
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 115000});
            assert.match(stdout, /Wallpaper layouts passed/);
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(profile).startsWith("siyuan-wallpaper-layout-"));
            rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
