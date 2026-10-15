const assert = require("node:assert/strict");
const {execFile} = require("node:child_process");
const {mkdtempSync, rmSync} = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {promisify} = require("node:util");

// 使用真实样式验证前端形态与设备平台组合，保留原生窗口占位和浏览器安全区。
const browserCases = ({css, mobile}) => {
    const check = require("node:assert/strict");
    const style = document.createElement("style");
    style.textContent = css;
    document.head.append(style);
    document.documentElement.style.cssText = "--b3-toolbar-left-mac:74px;--b3-font-size:14px";
    const cases = mobile ? [
        {frontend: "browser-mobile", platform: "android", inset: 32},
        {frontend: "mobile", platform: "android", inset: 0},
        {frontend: "browser-mobile", platform: "ios", inset: 32},
        {frontend: "mobile", platform: "ios", inset: 32},
        {frontend: "mobile", platform: "harmony", inset: 32},
    ] : ["windows", "linux", "mac"].flatMap(platform =>
        ["browser-desktop", "desktop", "desktop-window"].map(frontend => ({platform, frontend})));
    for (const scenario of cases) {
        const {frontend, platform} = scenario;
        const label = `${frontend}/${platform}`;
        document.documentElement.setAttribute("data-frontend", frontend);
        document.body.className = `body--${platform}${frontend === "desktop-window" ? " body--window" : ""}`;
        if (mobile) {
            document.body.innerHTML = '<div class="mobile-safe-area"></div><div class="mobile-topbar"></div>';
            check.equal(getComputedStyle(document.querySelector(".mobile-safe-area")).height, scenario.inset + "px", label);
            check.equal(getComputedStyle(document.querySelector(".mobile-topbar")).top, scenario.inset + "px", label);
        } else {
            document.body.innerHTML = `<div class="toolbar${frontend === "browser-desktop" ? " toolbar--browser" : ""}"></div>
                <div class="sy__globalGraph fullscreen"><div class="block__icons">
                    <div class="block__logo block__logo--counter">Global Graph</div><div class="fn__flex-1"></div>
                    <input class="b3-text-field search__label fn__size200"><span class="block__icon">S</span>
                    <span class="fn__space"></span><span class="block__icon">R</span><div class="fn__space"></div>
                    <div class="block__icon">F</div><div class="fn__space"></div><div class="block__icon">M</div>
                    <span class="fn__space"></span><span class="block__icon">X</span></div></div>`;
            const input = document.querySelector("input");
            const padding = frontend === "browser-desktop" ? 8 :
                (frontend === "desktop-window" ? (platform === "mac" ? 42 : 168) : (platform === "mac" ? 8 : 126));
            check.equal(getComputedStyle(input).right, (frontend === "browser-desktop" || platform === "mac" ? 8 : 108) + "px", label);
            check.equal(getComputedStyle(document.querySelector(".block__icons")).paddingRight, padding + "px", label);
            if (frontend === "browser-desktop") {
                check.ok(input.getBoundingClientRect().left >= document.querySelector(".block__logo").getBoundingClientRect().right,
                    `${label} search does not cover the title in a narrow window`);
                const toolbar = getComputedStyle(document.querySelector(".toolbar"));
                check.equal(toolbar.paddingLeft, "5px", label);
                check.equal(toolbar.paddingRight, "5px", label);
            }
        }
    }
};

if (process.versions.electron && process.type === "browser") {
    const {app, BrowserWindow} = require("electron");
    const sass = require("sass");
    app.setPath("userData", process.argv[2]);
    app.disableHardwareAcceleration();
    app.whenReady().then(async () => {
        const watchdog = setTimeout(() => app.exit(1), 40000);
        let win;
        let code = 0;
        try {
            win = new BrowserWindow({show: false, width: 400, height: 700,
                webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true}});
            await win.loadURL("about:blank");
            win.webContents.debugger.attach("1.3");
            await win.webContents.debugger.sendCommand("Emulation.setSafeAreaInsetsOverride", {
                insets: {top: 32, left: 0, right: 0, bottom: 0},
            });
            for (const mobile of [true, false]) {
                const css = sass.compile(path.join(__dirname, `../src/assets/scss/${mobile ? "mobile" : "base"}.scss`), {
                    logger: sass.Logger.silent,
                }).css;
                await win.loadURL("data:text/html,<html><head><meta name='viewport' content='width=device-width, initial-scale=1, viewport-fit=cover'></head><body></body></html>");
                const error = await win.webContents.executeJavaScript(`(() => {
                    try { (${browserCases.toString()})(${JSON.stringify({css, mobile})}); }
                    catch (error) { return error.stack; }
                })()`);
                assert.equal(error, undefined);
            }
            console.log("Verified frontend platform layouts");
        } catch (error) {
            console.error(error);
            code = 1;
        } finally {
            if (win && !win.isDestroyed()) win.destroy();
            clearTimeout(watchdog);
            app.exit(code);
        }
    });
} else {
    const {test} = require("node:test");
    test("frontend platform styles preserve browser safe areas and native window spacing", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 50000,
    }, async () => {
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-platform-layout-"));
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        try {
            const {stdout} = await promisify(execFile)(require("electron"), [__filename, profile], {
                env, windowsHide: true, timeout: 45000,
            });
            assert.ok(stdout.includes("Verified frontend platform layouts"));
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(profile).startsWith("siyuan-platform-layout-"));
            rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
