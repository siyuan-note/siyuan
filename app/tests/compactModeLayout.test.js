const assert = require("node:assert/strict");
const {mkdtempSync, readFileSync, rmSync} = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {test} = require("node:test");
const sass = require("sass");

const stylesheet = name => sass.compile(path.join(__dirname, `../src/assets/scss/${name}.scss`), {
    logger: sass.Logger.silent,
}).css;

// 使用共享组件的真实样式测量尺寸、覆盖层和内容隔离，不启动应用或内核。
const browserCases = ({css, desktop, community}) => {
    const check = require("node:assert/strict");
    const style = document.createElement("style");
    style.textContent = css;
    document.head.append(style);
    document.documentElement.setAttribute("data-frontend", desktop ? "desktop" : "mobile");
    document.body.style.fontSize = "14px";
    const item = '<li class="b3-list-item"><span class="b3-list-item__text">Document title</span></li>';
    document.body.innerHTML = `
        <div id="toolbar" class="toolbar fn__flex"><div id="drag" class="fn__flex-1">SiYuan</div>
            <div class="toolbar__item toolbar__item--close"><svg><use href="#iconClose"></use></svg></div></div>
        <div class="dock" id="dockLeft"><span class="dock__item"><svg><use href="#iconFiles"></use></svg></span></div>
        <div class="layout__dockl"><div class="block__icons">Files</div><ul class="b3-list" id="navigation">${item}</ul></div>
        <div class="layout__wnd--center"><div data-type="wnd"><div class="fn__flex"><ul class="layout-tab-bar fn__flex" id="tabs"><li class="item">
            <span class="item__icon">📄</span><span class="item__text">Document</span>
            <span class="item__close"><svg><use href="#iconClose"></use></svg></span></li></ul>
            <ul class="layout-tab-bar layout-tab-bar--readonly fn__flex-1" id="tab-actions"><li class="item item--readonly">
                <span class="block__icon block__icon--show"><svg><use href="#iconAdd"></use></svg></span>
                <span class="fn__flex-1"></span>
                <span class="block__icon block__icon--show"><svg><use href="#iconDown"></use></svg></span>
            </li></ul></div></div></div>
        <div class="protyle-breadcrumb">Notebook / Document</div>
        <div id="status" class="status fn__flex">
            <div id="barDock" class="toolbar__item"><svg><use href="#iconDock"></use></svg></div>
            <div class="status__msg">Ready</div><div class="fn__flex-1"></div>
            <div class="status__backgroundtask">Indexing</div><div class="status__counter">100 words</div>
            <div id="statusHelp" class="toolbar__item"><svg><use href="#iconHelp"></use></svg></div>
            <div id="plugin-status" class="toolbar__item"><svg><use href="#iconPlugin"></use></svg></div>
        </div>
        <div class="protyle-wysiwyg" style="font-size:32px"><div data-node-id="sample" data-type="NodeParagraph">Editor body</div>
            <div data-type="NodeAttributeView" class="av"><div class="av__row"><div class="av__cell">Database cell</div></div></div>
            <ul class="b3-list" id="content-list">${item}</ul></div>
        <div class="b3-typography"><ul class="b3-list" id="preview-list">${item}</ul></div>
        <div class="b3-menu" style="position:relative;left:0;top:0"><button class="b3-menu__item">
            <span class="b3-menu__label">Action</span><svg class="b3-menu__icon"><use href="#iconRight"></use></svg></button></div>
        <div class="b3-dialog__header">Dialog title</div><div class="b3-dialog__content">Dialog content</div>
        <div class="b3-dialog__action"><button class="b3-button">Confirm</button></div>
        <div class="config__panel fn__flex" style="overflow:hidden;position:relative;height:380px">
            <div class="config__side b3-list"><div class="config__tab-head"><div class="config__tab-title">Settings</div></div>
                <ul class="config__tab-scroll">${item.repeat(16)}</ul></div>
            <div class="config__tab-wrap"><div class="config__drag-anchor"><div class="config__drag"></div></div>
                <div class="config__tab-container" data-name="appearance"><div class="config-group config-group--first">
                    <div class="config-title">Interface</div><div class="config-items">${'<label class="b3-label fn__flex"><span class="fn__flex-1">Setting</span><input class="b3-switch" type="checkbox"></label>'.repeat(12)}</div>
                </div><div class="config__view config__view--show fn__none" style="transition:none">Details</div></div></div>
        </div>`;
    const find = selector => document.querySelector(selector);
    const height = selector => find(selector).getBoundingClientRect().height;
    const number = (selector, property) => parseFloat(getComputedStyle(find(selector))[property]);
    const near = (actual, expected, label) => check.ok(Math.abs(actual - expected) < 1,
        `${label}: ${actual} / ${expected}`);
    const checkDialogAlignment = padding => {
        const header = find(".b3-dialog__header");
        const content = document.createRange();
        content.selectNodeContents(find(".b3-dialog__content"));
        for (const title of ["Dialog title", "📚 Dialog title"]) {
            header.textContent = title;
            const text = document.createRange();
            text.selectNodeContents(header);
            near(text.getBoundingClientRect().left, content.getBoundingClientRect().left,
                `${title} aligns with dialog content`);
            near(number(".b3-dialog__header", "paddingLeft"), padding, "dialog title left padding");
            near(number(".b3-dialog__header", "paddingRight"), padding, "dialog title right padding");
        }
        for (const selector of [".b3-dialog__content", ".b3-dialog__action"]) {
            near(number(selector, "paddingLeft"), padding, `${selector} left padding`);
            near(number(selector, "paddingRight"), padding, `${selector} right padding`);
        }
        header.textContent = "Dialog title";
    };
    const settle = () => document.getAnimations().filter(animation => animation instanceof CSSTransition)
        .forEach(animation => animation.finish());
    const checkTabEdge = () => {
        const tabs = find("#tabs");
        for (const width of [280, 800]) {
            tabs.parentElement.style.width = width + "px";
            for (const count of [1, 5]) {
                while (tabs.children.length < count) tabs.append(tabs.firstElementChild.cloneNode(true));
                tabs.scrollLeft = tabs.scrollWidth;
                const edge = tabs.lastElementChild.getBoundingClientRect().right;
                const actions = find("#tab-actions").getBoundingClientRect();
                // 滚动范围按整数像素取整，容许末端出现不足半个像素的测量误差。
                check.ok(edge <= actions.left + 0.5, `tab actions must not cover the last tab at width ${width}: ${edge} / ${actions.left}`);
            }
            while (tabs.children.length > 1) tabs.lastElementChild.remove();
        }
        tabs.parentElement.style.width = "";
        tabs.scrollLeft = 0;
    };
    const snapshot = () => Object.fromEntries([
        ["toolbar", ".toolbar"], ["tabs", "#tabs"], ["panel", ".block__icons"], ["breadcrumb", ".protyle-breadcrumb"],
        ["list", "#navigation .b3-list-item"], ["menu", ".b3-menu__item"], ["dialog", ".b3-dialog__header"],
        ["status", "#status"],
        ["editor", ".protyle-wysiwyg"], ["database", ".av__cell"], ["content", "#content-list"], ["preview", "#preview-list"],
    ].map(([key, selector]) => [key, {height: height(selector), font: getComputedStyle(find(selector)).fontSize}]));
    const normal = snapshot();
    if (desktop && !community) {
        checkDialogAlignment(16);
        checkTabEdge();
        for (const [key, expected] of Object.entries({toolbar: 32, tabs: 42, panel: 42, breadcrumb: 42,
            list: 28, menu: 28, dialog: 43, status: 32})) {
            near(normal[key].height, expected, `${key} retains the default size`);
        }
    }
    document.documentElement.setAttribute("data-ui-density", "compact");
    settle();
    const compact = snapshot();
    if (!desktop) {
        check.deepEqual(compact, normal, "mobile and export do not opt into desktop density");
        return "Compact layout cases passed";
    }
    for (const key of ["editor", "database", "content", "preview"]) {
        check.deepEqual(compact[key], normal[key], `${key} content preserves dimensions and font size`);
    }
    for (const key of Object.keys(normal)) check.equal(compact[key].font, normal[key].font, `${key} keeps its font size`);
    if (!community) {
        checkDialogAlignment(16);
        checkTabEdge();
        for (const key of ["toolbar", "tabs", "panel", "breadcrumb", "list", "menu", "dialog", "status"]) {
            check.ok(compact[key].height < normal[key].height, `${key} becomes smaller: ${JSON.stringify({normal, compact})}`);
        }
        near(compact.toolbar.height, 28, "toolbar height");
        near(compact.status.height, 28, "status bar height");
        near(number("#status", "lineHeight"), 28, "status bar line height");
        const statusRect = find("#status").getBoundingClientRect();
        for (const selector of ["#barDock", "#statusHelp", "#plugin-status", ".status__msg", ".status__counter", ".status__backgroundtask"]) {
            const rect = find(selector).getBoundingClientRect();
            check.ok(rect.top >= statusRect.top && rect.bottom <= statusRect.bottom, `${selector} fits the compact status bar`);
            near((rect.top + rect.bottom) / 2, (statusRect.top + statusRect.bottom) / 2, `${selector} stays vertically centered`);
        }
        near(height("#statusHelp svg"), 15.5, "status icon size is preserved");
        near(number(".status__counter", "fontSize"), 12, "status text size is preserved");
        for (const platform of ["android", "harmony", "ios"]) {
            document.body.classList.add(`body--${platform}`);
            check.deepEqual(snapshot(), compact, `${platform} desktop interface uses compact density`);
            document.body.classList.remove(`body--${platform}`);
        }
        document.body.classList.add("body--ios");
        document.documentElement.setAttribute("data-ios-window-controls", "");
        document.documentElement.style.setProperty("--ios-window-controls-left", "80px");
        document.documentElement.style.setProperty("--ios-window-controls-right", "60px");
        document.documentElement.style.setProperty("--ios-window-controls-height", "50px");
        document.documentElement.style.setProperty("--ios-window-safe-top", "24px");
        document.documentElement.style.setProperty("--ios-window-safe-bottom", "20px");
        near(height("#toolbar"), 56, "separate iOS toolbar retains its safe top area");
        near(number("#toolbar", "paddingTop"), 24, "iOS safe top padding");
        document.documentElement.style.setProperty("--ios-window-safe-top", "0px");
        near(height("#toolbar"), 50, "separate iOS toolbar retains the native control height");
        document.documentElement.style.setProperty("--ios-window-safe-top", "24px");
        for (const density of ["compact", "normal"]) {
            if (density === "normal") document.documentElement.removeAttribute("data-ui-density");
            document.body.classList.add("body--toolbar-hide");
            settle();
            const expected = density === "compact" ? 34 : 42;
            near(height("#toolbar"), expected, `${density} fused iOS toolbar height`);
            near(height("#tabs"), expected, `${density} fused iOS tabs align`);
            near(number(".layout__dockl", "marginTop"), expected, `${density} iOS side panel offset`);
            near(number("#dockLeft", "marginTop"), expected, `${density} iOS dock offset`);
            near(number("#toolbar", "paddingLeft"), 85, `${density} native left controls remain reserved`);
            near(number("#toolbar", "paddingRight"), 65, `${density} native right controls remain reserved`);
            near(number("#toolbar", "paddingTop"), 0, `${density} fused toolbar keeps its vertical baseline`);
            checkTabEdge();
            document.body.classList.remove("body--toolbar-hide");
        }
        document.documentElement.setAttribute("data-ui-density", "compact");
        near(height("#status"), 48, "compact status bar retains the iOS safe area");
        document.documentElement.removeAttribute("data-ui-density");
        near(height("#status"), 52, "normal status bar retains the iOS safe area");
        document.documentElement.setAttribute("data-ui-density", "compact");
        document.documentElement.removeAttribute("data-ios-window-controls");
        for (const name of ["controls-left", "controls-right", "controls-height", "safe-top", "safe-bottom"]) {
            document.documentElement.style.removeProperty(`--ios-window-${name}`);
        }
        document.body.classList.remove("body--ios");
        near(compact.panel.height, 34, "panel height");
        near(compact.list.height, 24, "list height");
        near(compact.menu.height, 26, "menu height");
        near(find(".dock").getBoundingClientRect().width, 34, "dock width");
        document.body.classList.add("body--toolbar-hide");
        settle();
        checkTabEdge();
        near(height(".toolbar"), height("#tabs"), "fused toolbar aligns with tabs");
        near(number(".layout__dockl", "marginTop"), height(".toolbar"), "side panel offset follows fused toolbar");
        near(number("#dockLeft", "marginTop"), height(".toolbar"), "dock offset follows fused toolbar");
        document.body.classList.remove("body--toolbar-hide");
        for (const width of [560, 1000]) {
            const panel = find(".config__panel");
            panel.style.width = width + "px";
            const rect = panel.getBoundingClientRect();
            const wrap = find(".config__tab-wrap").getBoundingClientRect();
            const content = find(".config__tab-container");
            const contentRect = content.getBoundingClientRect();
            const drag = find(".config__drag").getBoundingClientRect();
            near(drag.height, number(".config__tab-container", "paddingTop"), "drag area matches compact padding");
            near(drag.left, wrap.left, "drag starts at content edge");
            near(drag.right, wrap.right, "drag ends at content edge");
            near(contentRect.right, wrap.right, "scrollbar remains on content edge");
            check.ok(content.scrollHeight > content.clientHeight, "settings content scrolls");
            const overlay = find(".config__view");
            overlay.classList.remove("fn__none");
            const details = overlay.getBoundingClientRect();
            near(details.left, rect.left, "details cover the full panel including navigation");
            near(details.right, rect.right, "details reach the panel edge");
            near(details.height, rect.height, "details cover the panel height");
            overlay.classList.add("fn__none");
        }
        find("#navigation").style.fontSize = "32px";
        find(".b3-menu").style.fontSize = "32px";
        check.ok(height("#navigation .b3-list-item") >= 48, "large navigation text can expand");
        check.ok(height(".b3-menu__item") >= 48, "large menu text can expand");
        find("#navigation").style.removeProperty("font-size");
        find(".b3-menu").style.removeProperty("font-size");
    }
    document.documentElement.removeAttribute("data-ui-density");
    settle();
    check.deepEqual(snapshot(), normal, "disabling restores the theme's original component dimensions");
    if (!community) {
        // 根变量和既有组件选择器都能覆盖内置尺寸，即使主题样式先于基础样式加载。
        const theme = document.createElement("style");
        theme.textContent = ":root{--b3-ui-list-height:36px;--b3-ui-status-height:36px}.b3-menu__item{line-height:38px}";
        document.head.prepend(theme);
        document.documentElement.setAttribute("data-ui-density", "compact");
        settle();
        near(height("#navigation .b3-list-item"), 36, "theme root variable wins");
        near(height("#status"), 36, "theme status height variable wins");
        near(height(".b3-menu__item"), 26, "same-specificity early component style follows source order");
        document.head.append(theme);
        near(height(".b3-menu__item"), 38, "existing component theme override wins in the normal load order");
    }
    return "Compact layout cases passed";
};

if (process.versions.electron && process.type === "browser") {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", process.argv[2]);
    app.whenReady().then(async () => {
        const win = new BrowserWindow({show: false, width: 1200, height: 1000,
            webPreferences: {nodeIntegration: true, contextIsolation: false}});
        try {
            const communityThemes = process.env.SIYUAN_COMPACT_THEME_MANIFEST ?
                JSON.parse(readFileSync(process.env.SIYUAN_COMPACT_THEME_MANIFEST, "utf8")) : [];
            for (const name of ["base", "mobile", "export"]) {
                const compiled = stylesheet(name);
                for (const theme of ["daylight", "midnight"]) {
                    const builtIn = readFileSync(path.join(__dirname, `../appearance/themes/${theme}/theme.css`), "utf8");
                    for (const extra of [null, ...(name === "base" ? communityThemes : [])]) {
                        await win.loadURL("data:text/html,<html><body></body></html>");
                        await win.webContents.executeJavaScript(`document.documentElement.setAttribute("data-theme-mode", "${theme === "daylight" ? "light" : "dark"}")`);
                        const css = compiled + builtIn + (extra ? readFileSync(extra.css, "utf8") : "");
                        assert.equal(await win.webContents.executeJavaScript(
                            `(() => { try { return (${browserCases.toString()})(${JSON.stringify({css, desktop: name === "base", community: !!extra})}); } catch (error) { return error.stack; } })()`),
                        "Compact layout cases passed");
                        console.log(`${name}/${theme}/${extra?.repo || "built-in"} passed`);
                    }
                }
            }
            console.log("Compact layout cases passed");
            win.destroy();
            app.exit(0);
        } catch (error) {
            console.error(error);
            win.destroy();
            app.exit(1);
        }
    }).catch(error => {
        console.error(error);
        app.exit(1);
    });
} else {
    test("compact density preserves themes, content and settings overlays in the browser", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 120000,
    }, async () => {
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-compact-layout-"));
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 110000});
            assert.match(stdout, /Compact layout cases passed/);
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(profile).startsWith("siyuan-compact-layout-"));
            rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
