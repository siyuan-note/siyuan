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
                (frontend === "desktop-window" ? (platform === "mac" ? 42 : 168) : (platform === "mac" ? 8 : 136.5));
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
    if (!mobile) {
        document.documentElement.setAttribute("data-frontend", "desktop");
        for (const platform of ["windows", "linux"]) {
            for (const density of ["default", "compact"]) {
                document.documentElement.setAttribute("data-ui-density", density);
                for (const fused of [false, true]) {
                    document.body.className = `body--${platform}${fused ? " body--toolbar-hide" : ""}`;
                    for (const headerClass of ["block__icons", "protyle-breadcrumb"]) {
                        const label = `${platform}/${density}/${fused}/${headerClass}`;
                        document.body.innerHTML = `<div id="toolbar" class="toolbar fn__flex"><div class="fn__flex-1"></div>
                            <div id="windowControls" class="fn__flex">${["win", "win", "close"].map(type =>
                            `<div class="toolbar__item toolbar__item--${type}"><svg></svg></div>`).join("")}</div></div>
                            <div class="fullscreen"><div class="${headerClass}"><div class="fn__flex-1"></div>
                                <span class="block__icon"><svg></svg></span></div></div>`;
                        const controls = document.querySelector("#windowControls").getBoundingClientRect();
                        const header = document.querySelector(`.${headerClass}`).getBoundingClientRect();
                        const button = document.querySelector(".block__icon").getBoundingClientRect();
                        check.ok(button.right <= controls.left - 4, `${label} functional and window buttons do not overlap`);
                        check.ok(Math.abs((header.top + header.bottom - controls.top - controls.bottom) / 2) <= .5,
                            `${label} header and window controls share their vertical center`);
                        const icon = document.querySelector(".block__icon svg").getBoundingClientRect();
                        for (const nativeIcon of document.querySelectorAll("#windowControls svg")) {
                            const rect = nativeIcon.getBoundingClientRect();
                            check.ok(Math.abs((icon.top + icon.bottom - rect.top - rect.bottom) / 2) < .1,
                                `${label} functional and native SVG icons share their vertical center`);
                        }
                    }
                }
            }
        }
        document.documentElement.removeAttribute("data-ui-density");
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
