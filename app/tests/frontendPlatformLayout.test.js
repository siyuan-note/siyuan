const assert = require("node:assert/strict");
const {execFile} = require("node:child_process");
const {mkdtempSync, readFileSync, rmSync} = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {promisify} = require("node:util");

// 使用真实样式验证前端形态与设备平台组合，保留原生窗口占位和浏览器安全区。
const browserCases = ({css, mobile, inboxDetailHTML}) => {
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
            if (frontend === "mobile" && platform === "android") {
                check.equal(getComputedStyle(document.body).getPropertyValue("--android-navigation-overlay").trim(), "1");
                document.body.innerHTML += '<div class="mobile-bottom-bar"></div><div class="b3-dialog"></div><div class="b3-menu b3-menu--fullscreen"><div class="b3-menu__items--menu"></div></div><div id="sidebar" class="side-panel"><div class="b3-list--mobile"><div data-type="sidebar-file"><div class="fn__flex-1"></div></div></div></div>';
                for (const bottom of [0, 16, 32, 0]) {
                    const footer = document.createElement("div");
                    footer.className = "toolbar toolbar--bottom";
                    const keyboard = document.createElement("div");
                    keyboard.className = "keyboard";
                    document.body.append(footer, keyboard);
                    document.documentElement.style.setProperty("--android-navigation-bar-height", `${bottom}px`);
                    check.equal(getComputedStyle(footer).height, `${48 + bottom}px`);
                    check.equal(footer.getBoundingClientRect().height, 48 + bottom);
                    check.equal(getComputedStyle(footer).paddingBottom, `${bottom}px`);
                    check.equal(getComputedStyle(keyboard).bottom, `${bottom}px`);
                    check.equal(getComputedStyle(document.body, "::after").height, `${bottom * 2}px`, "gesture protection follows the native inset");
                    check.equal(getComputedStyle(document.body, "::after").pointerEvents, "none");
                    check.equal(getComputedStyle(document.querySelector(".mobile-bottom-bar")).bottom, `${Math.max(24, bottom) + 8}px`);
                    check.equal(getComputedStyle(document.querySelector(".b3-dialog")).paddingBottom, `${bottom}px`);
                    check.equal(getComputedStyle(document.querySelector(".b3-menu__items--menu")).paddingBottom, `${Math.max(16, bottom)}px`);
                    check.equal(getComputedStyle(document.querySelector('#sidebar [data-type="sidebar-file"] > .fn__flex-1'), "::after").height, `${bottom}px`);
                    footer.remove();
                    keyboard.remove();
                }
                // 长列表滚到底时末项可完整离开手势区，既有间距只补偿一次。
                const rows = Array.from({length: 60}, (_, index) => `<li class="b3-list-item">Row ${index}</li>`).join("");
                for (const type of ["file", "file-pins", "bookmark", "tag", "inbox", "backlink", "backlink-only", "outline"]) {
                    const kind = type.split("-")[0];
                    const list = `<ul class="b3-list b3-list--background"${kind === "inbox" ? ' style="padding:8px 0"' : ""}>${rows}</ul>`;
                    let content = `<div class="fn__flex-1 ${kind === "bookmark" ? "bookmarkList" : kind === "tag" ? "tagList" : ""}">${list}</div>`;
                    if (type === "file-pins") {
                        content = `<div class="fn__flex-column b3-list" style="min-height:0;flex:1"><div class="fn__flex-shrink">Pins</div>${content}</div>`;
                    } else if (kind === "backlink") {
                        content = `<div class="backlinkList fn__flex-1">${list}</div><div class="block__icons backlinkMList__header">Mentions</div><div class="backlinkMList fn__flex-1">${list}</div>`;
                    } else if (kind === "outline") {
                        content = `<div class="fn__flex-1" style="padding:8px 0 calc(8px + var(--mobile-bottom-bar-safe-area, env(safe-area-inset-bottom)))">${list}</div>`;
                    }
                    document.body.innerHTML = `<div class="side-panel fn__flex-column" style="transform:none"><div class="toolbar">Docks</div><div class="fn__flex-1 b3-list--mobile"><div class="fn__flex-column ${kind === "backlink" ? "sy__backlink" : ""} ${type === "backlink-only" ? "sy__backlink--only-backlinks" : ""}" data-type="sidebar-${kind}"><div class="toolbar">Panel</div>${content}</div></div></div>`;
                    const scroller = document.querySelector(kind === "backlink" ?
                        (type === "backlink-only" ? ".backlinkList" : ".backlinkMList") :
                        type === "file-pins" ? '[data-type="sidebar-file"] > .b3-list > .fn__flex-1' : "[data-type] > .fn__flex-1");
                    let initialGap;
                    for (const bottom of [0, 16, 32, 15.75, 0]) {
                        document.documentElement.style.setProperty("--android-navigation-bar-height", `${bottom}px`);
                        scroller.scrollTop = scroller.scrollHeight;
                        check.ok(scroller.scrollTop > 0, `${type} has scrollable content`);
                        check.ok(Math.abs(scroller.getBoundingClientRect().bottom - innerHeight) < 1, `${type} reaches the viewport bottom`);
                        const rowBottom = scroller.querySelector("li:last-child").getBoundingClientRect().bottom;
                        const gap = innerHeight - rowBottom;
                        initialGap ??= gap;
                        check.ok(rowBottom <= innerHeight - bottom + 1, `${type}/${bottom} last row is above the gesture area`);
                        check.ok(Math.abs(gap - initialGap - bottom) < 1, `${type}/${bottom} preserves spacing without double compensation`);
                    }
                    if (kind === "backlink") {
                        document.querySelector(".side-panel").classList.remove("side-panel");
                        check.equal(getComputedStyle(scroller, "::after").content, "none", "non-sidebar backlinks have no extra spacer");
                    }
                }
                document.body.innerHTML = `<div class="side-panel fn__flex-column" style="transform:none"><div class="toolbar">Docks</div><div class="fn__flex-1 b3-list--mobile"><div class="fn__flex-column" data-type="sidebar-inbox"><div class="toolbar">Inbox</div><div class="fn__flex-1 fn__none inboxDetails fn__flex-column" style="min-height:auto">${inboxDetailHTML}</div><div class="fn__flex-1 inboxList"><ul style="padding:8px 0" class="b3-list">${rows}</ul></div></div></div></div>`;
                const details = document.querySelector(".inboxDetails");
                const inboxList = document.querySelector(".inboxList");
                for (const bottom of [0, 24, 32, 15.75, 0]) {
                    document.documentElement.style.setProperty("--android-navigation-bar-height", `${bottom}px`);
                    for (const showDetails of [false, true, false]) {
                        details.classList.toggle("fn__none", !showDetails);
                        inboxList.classList.toggle("fn__none", showDetails);
                        const scroller = showDetails ? details.querySelector(".b3-typography") : inboxList;
                        scroller.scrollTop = scroller.scrollHeight;
                        check.ok(scroller.scrollTop > 0, "inbox view has scrollable content: " + JSON.stringify({showDetails,
                            height:scroller.clientHeight,scrollHeight:scroller.scrollHeight,overflow:getComputedStyle(scroller).overflow,
                            parentHeight:scroller.parentElement.clientHeight,minHeight:getComputedStyle(scroller).minHeight}));
                        check.ok(Math.abs(scroller.getBoundingClientRect().bottom - innerHeight) < 1, "inbox view reaches the viewport bottom");
                        const last = scroller.querySelector(showDetails ? "img" : "li:last-child");
                        check.ok(last.getBoundingClientRect().bottom <= innerHeight - bottom + 1, "inbox list and detail content clear the gesture area");
                        if (showDetails) {
                            const content = details.querySelector(".b3-typography");
                            check.equal(getComputedStyle(content).paddingBottom, `${8 + bottom}px`, "inbox details preserve their spacing and add the inset once");
                            check.ok(Math.abs(innerHeight - last.getBoundingClientRect().bottom - bottom - 8) < 1, "inbox detail image can scroll fully above the gesture area");
                        }
                    }
                }
                document.documentElement.style.removeProperty("--android-navigation-bar-height");
                for (const color of ["rgb(255, 255, 255)", "rgb(30, 30, 30)"]) {
                    document.body.style.setProperty("--b3-theme-background", color);
                    check.ok(getComputedStyle(document.body, "::after").backgroundImage.includes(color), "gesture protection follows the theme");
                }
                document.body.style.removeProperty("--b3-theme-background");
            } else {
                check.notEqual(getComputedStyle(document.body).getPropertyValue("--android-navigation-overlay").trim(), "1", label);
            }
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
            const inboxSource = readFileSync(path.join(__dirname, "../src/layout/dock/Inbox.ts"), "utf8");
            const detailTemplate = inboxSource.match(/return sanitizeKernelHTML\(`(<div class="toolbar">[\s\S]*?)`\);/);
            assert.ok(detailTemplate, "mobile inbox detail template exists");
            const inboxDetailHTML = detailTemplate[1].replace("${data.shorthandTitle}", "Inbox detail")
                .replace("${linkHTML}", "")
                .replace("${data.shorthandContent}", '<img alt="Detail end" style="height:1600px;width:100px;flex-shrink:0" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7">');
            for (const mobile of [true, false]) {
                const css = sass.compile(path.join(__dirname, `../src/assets/scss/${mobile ? "mobile" : "base"}.scss`), {
                    logger: sass.Logger.silent,
                }).css;
                await win.loadURL("data:text/html,<html><head><meta name='viewport' content='width=device-width, initial-scale=1, viewport-fit=cover'></head><body></body></html>");
                const error = await win.webContents.executeJavaScript(`(() => {
                    try { (${browserCases.toString()})(${JSON.stringify({css, mobile, inboxDetailHTML})}); }
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
