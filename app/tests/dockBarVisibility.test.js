const assert = require("node:assert/strict");
const {mkdtempSync, readFileSync, rmSync, writeFileSync} = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const {test} = require("node:test");
const {ModuleKind, ScriptTarget, transpileModule} = require("typescript");
const sass = require("sass");

const browserCases = async (sources, css, template) => {
    const check = require("node:assert/strict");
    const load = (name, dependencies = {}) => {
        const exports = {};
        new Function("exports", "require", sources[name])(exports, () => dependencies);
        return exports;
    };
    document.head.innerHTML = "<style></style>";
    document.querySelector("style").textContent = css;
    if (window.innerWidth === 700) {
        document.body.style.setProperty("--b3-body-background-gradient", document.body.classList.contains("body--toolbar-hide") ?
            "none" : "radial-gradient(ellipse 60% 40% at 0% 0%, rgba(220, 80, 40, .6), transparent)");
    }
    document.body.innerHTML = '<div id="toolbar" class="toolbar">' +
        '<span style="display:block;width:20px;height:20px;margin:6px;background:rgb(180,40,80)"></span></div>' + template +
        '<div id="status" class="status"></div><div id="commonMenu" class="fn__none"></div>';
    const layouts = document.getElementById("layouts");
    layouts.classList.add("fn__flex-column");
    layouts.innerHTML = '<div id="outer" class="fn__flex fn__flex-1">' +
        '<div id="left" class="layout fn__flex-column"></div><div class="layout__resize"></div>' +
        '<div id="center" class="layout__center fn__flex-1 fn__flex"><div class="fn__flex-1 fn__flex">' +
        '<div data-type="wnd" class="fn__flex-column fn__flex-1">' +
        '<div class="fn__flex"><ul class="layout-tab-bar fn__flex"><li class="item item--focus">' +
        '<span class="item__text">Document</span></li></ul><ul class="layout-tab-bar layout-tab-bar--readonly fn__flex-1">' +
        '<li class="item item--readonly"><span class="fn__flex-1"></span></li></ul></div>' +
        '<div class="layout-tab-container fn__flex-1">Editor</div></div></div></div>' +
        '<div class="layout__resize"></div>' +
        '<div id="right" class="layout fn__flex-column"></div></div><div class="layout__resize"></div>' +
        '<div id="bottom" class="layout fn__flex"></div>';
    const makeLayout = (id) => {
        const element = document.getElementById(id);
        element.innerHTML = '<div class="fn__flex-1"><div class="layout-tab-container"></div></div>' +
            '<div class="layout__resize"></div><div class="fn__flex-1"><div class="layout-tab-container"></div></div>';
        return {element, children: [element.children[0], element.children[2]].map(child => ({element: child}))};
    };
    const left = makeLayout("left");
    const right = makeLayout("right");
    const bottom = makeLayout("bottom");
    const center = {element: document.getElementById("center")};
    if (document.body.classList.contains("body--toolbar-hide")) {
        center.element.firstElementChild.classList.add("layout__wnd--left", "layout__wnd--right", "layout__wnd--center");
        center.element.querySelector('[data-type="wnd"]').firstElementChild.style.paddingLeft = "112px";
    }
    const outer = {element: document.getElementById("outer"), children: [left, center, right]};
    window.siyuan = {zIndex: 10, config: {uiLayout: {hideDock: true}, appearance: {hideStatusBar: false}, system: {os: "linux"}},
        layout: {layout: {children: [outer, bottom]}, centerLayout: center}};
    const bar = load("barVisibility");
    const dependencies = {
        ...bar, ...load("panelVisibility"),
        Constants: {TIMEOUT_DOCK_TOGGLE: 20, TIMEOUT_TRANSITION: 20, ATTRIBUTE_DOCK_WIDTH: "data-width"},
        bindPanelTransitionGuard() {}, isTouchHoverInput: () => false,
        isWindow: () => false, isAbove: (a, b) => Number(a.style.zIndex) > Number(b.style.zIndex),
        resizeTabs() {}, setTabPosition() {}, adjustLayout() {}, setPanelFocus() {},
        recordBeforeResizeTop() {}, clearBeforeResizeTop() {},
        hasClosestByClassName: (element, name) => element?.closest?.("." + name),
    };
    const {Dock} = load("index", dependencies);
    const docks = {};
    for (const position of ["Left", "Right", "Bottom"]) {
        docks[position] = window.siyuan.layout[position.toLowerCase() + "Dock"] =
            new Dock({app: {plugins: []}, data: {pin: false, data: []}, position});
    }
    const settle = () => new Promise(resolve => setTimeout(resolve, 350));
    await settle();
    for (const position of ["Left", "Right", "Bottom"]) {
        const dock = docks[position];
        for (const suffix of ["one", "two"]) {
            const type = position + suffix;
            dock.elements[0].insertAdjacentHTML("beforeend", `<span class="dock__item" data-type="${type}"
                data-entry-id="plugin:test:${type}" data-id="${type}" data-index="0" data-width="240" data-height="180">${suffix}</span>`);
            dock.layout.children[0].element.firstElementChild.insertAdjacentHTML("beforeend",
                `<div data-id="${type}" class="fn__none"><input class="b3-text-field"></div>`);
        }
    }
    const open = (position, suffix = "one") => docks[position].toggleModel(position + suffix, true, false, false, false);
    const hidden = element => getComputedStyle(element).display === "none";
    const rect = element => {
        const {x, y, width, height} = element.getBoundingClientRect();
        return {x, y, width, height};
    };
    const appearance = element => {
        const style = getComputedStyle(element);
        return Object.fromEntries(["borderTopLeftRadius", "borderTopRightRadius",
            "borderBottomLeftRadius", "borderBottomRightRadius", "marginTop", "boxShadow"]
            .map(key => [key, style[key]]));
    };
    bar.syncDockBarVisibility();
    const initialEditor = rect(center.element);
    const leftBar = document.getElementById("dockLeft");
    const rightBar = document.getElementById("dockRight");
    check.ok(hidden(leftBar) && hidden(rightBar));
    const rightDockSpace = () => document.documentElement.style.getPropertyValue("--b3-dock-right-width");
    const checkRightDockSpace = (message) => {
        const reserved = !hidden(rightBar) && !rightBar.classList.contains("dock--float");
        check.equal(rightDockSpace(), reserved ? "var(--b3-ui-dock-width, 42px)" : "0px", message);
    };
    checkRightDockSpace("a hidden right bar reserves no space for fixed overlays");
    const {windowMouseMove} = load("mousemove", dependencies);
    const move = event => windowMouseMove(event);
    document.addEventListener("mousemove", move);
    for (const position of ["Left", "Right"]) {
        const dock = docks[position];
        const element = position === "Left" ? leftBar : rightBar;
        const otherBar = position === "Left" ? rightBar : leftBar;
        const entries = Array.from(element.querySelectorAll(".dock__item"));
        const order = entries.map(item => item.dataset.entryId);
        check.equal(dock.layout.element.clientWidth, 0);
        center.element.dispatchEvent(new MouseEvent("mousemove", {bubbles: true,
            clientX: position === "Left" ? 1 : window.innerWidth - 1, clientY: 200}));
        await settle();
        check.ok(!hidden(element) && hidden(otherBar), "the edge reveals a bar with all panels closed");
        check.equal(dock.hasActive(), false);
        check.equal(dock.layout.element.style.opacity, "0", "revealing a bar does not open an empty panel");
        check.deepEqual(rect(center.element), initialEditor, "bar-only edge hover does not resize the editor");
        const menu = document.getElementById("commonMenu");
        menu.style.zIndex = "9999";
        menu.classList.remove("fn__none");
        dock.hideDock();
        check.ok(!hidden(element), "a menu opened from a bar keeps the bar visible without an active panel");
        menu.classList.add("fn__none");
        center.element.dispatchEvent(new MouseEvent("mousemove", {bubbles: true,
            clientX: window.innerWidth / 2, clientY: 200}));
        await settle();
        check.ok(hidden(element), "bar-only hover closes after leaving the edge");
        center.element.dispatchEvent(new MouseEvent("mousemove", {bubbles: true,
            clientX: position === "Left" ? 1 : window.innerWidth - 1, clientY: 200}));
        await settle();
        entries.forEach((entry, index) => entry.addEventListener("click", () =>
            dock.toggleModel(position + (index === 0 ? "one" : "two"), false, true, false, false)));
        entries[0].click();
        await settle();
        check.equal(dock.layout.element.style.opacity, "1", "clicking a revealed entry opens its panel");
        check.ok(!hidden(element) && hidden(otherBar), "only the expanded side reveals its bar");
        check.equal(getComputedStyle(element).position, "fixed");
        check.deepEqual(rect(center.element), initialEditor, "revealing a bar and panel does not resize the editor");
        const panelRect = dock.layout.element.getBoundingClientRect();
        const barRect = element.getBoundingClientRect();
        check.equal(position === "Left" ? panelRect.left : panelRect.right,
            position === "Left" ? barRect.right : barRect.left, "panel stays beside the bar");
        const temporary = {bar: rect(element), panel: rect(dock.layout.element),
            barStyle: appearance(element), panelStyle: appearance(dock.layout.element)};
        const backdrop = element.previousElementSibling;
        check.ok(backdrop.classList.contains("dock__backdrop"));
        check.equal(getComputedStyle(backdrop).backgroundColor, getComputedStyle(document.body).backgroundColor);
        check.equal(getComputedStyle(backdrop).backgroundImage, getComputedStyle(document.body).backgroundImage,
            "the overlay shares the window gradient, including theme overrides");
        const rowTop = document.body.classList.contains("body--toolbar-hide") ?
            center.element.querySelector(".layout-tab-container").getBoundingClientRect().top :
            element.parentElement.getBoundingClientRect().top;
        const radius = parseFloat(getComputedStyle(center.element).borderTopLeftRadius);
        const edge = position === "Left" ? barRect.right : barRect.left;
        const sign = position === "Left" ? 1 : -1;
        const toolbarButton = document.getElementById("toolbar").firstElementChild.getBoundingClientRect();
        const samples = [
            {x: edge - sign * 2, y: rowTop + 2},
            {x: edge + sign * 2, y: rowTop + 1},
            {x: edge + sign * (radius + 2), y: rowTop + 2},
            {x: edge + sign * 2, y: barRect.bottom - 2},
            {x: toolbarButton.x + toolbarButton.width / 2, y: toolbarButton.y + toolbarButton.height / 2},
        ];
        const pixels = () => require("electron").ipcRenderer.invoke("dock-bar-pixels", samples);
        const overlayPixels = await pixels();
        window.siyuan.config.uiLayout.hideDock = false;
        bar.syncDockBarVisibility();
        dock.showDock(true);
        check.deepEqual({bar: rect(element), panel: rect(dock.layout.element),
            barStyle: appearance(element), panelStyle: appearance(dock.layout.element)}, temporary,
        "floating bars preserve the normal dock geometry and panel corners");
        const normalPixels = await pixels();
        overlayPixels.forEach((pixel, index) => pixel.forEach((channel, component) =>
            check.ok(Math.abs(channel - normalPixels[index][component]) <= 3,
                `background and inner corner sample ${index} matches the normal dock: ${pixel} / ${normalPixels[index]}`)));
        window.siyuan.config.uiLayout.hideDock = true;
        bar.syncDockBarVisibility();
        dock.showDock(true);
        await settle();
        const expandedEditor = rect(center.element);
        if (process.env.SIYUAN_DOCK_TEST_SCREENSHOTS) {
            await require("electron").ipcRenderer.invoke("dock-bar-capture", position);
        }
        if (document.body.classList.contains("body--toolbar-hide")) {
            const header = center.element.querySelector('[data-type="wnd"]').firstElementChild;
            header.classList.add("fn__none");
            await settle();
            check.equal(parseFloat(element.previousElementSibling.style.top),
                center.element.querySelector(".layout-tab-container").getBoundingClientRect().top,
                "merged layout without tabs restores the top corner to the editor edge");
            header.classList.remove("fn__none");
            await settle();
            check.equal(parseFloat(element.previousElementSibling.style.top), rowTop,
                "opening tabs places the inner corner below the merged tab bar");
        }

        dock.hideDockByHover();
        // 覆盖停靠栏最外侧像素，不能因旧的边缘范围少两个像素而收起。
        element.dispatchEvent(new MouseEvent("mousemove", {bubbles: true,
            clientX: position === "Left" ? 1 : window.innerWidth - 1, clientY: 200}));
        dock.layout.element.dispatchEvent(new MouseEvent("mouseleave", {relatedTarget: entries[0],
            clientX: position === "Left" ? barRect.right - 1 : barRect.left + 1, clientY: 200}));
        await settle();
        check.equal(dock.layout.element.style.opacity, "1", "moving from panel to bar keeps the panel open");
        check.ok(!hidden(element));

        entries[1].click();
        await settle();
        check.ok(entries[1].classList.contains("dock__item--active"));
        check.ok(!hidden(dock.layout.element.querySelector(`[data-id="${position}two"]`)));
        check.deepEqual(entries.map(item => item.dataset.entryId), order, "plugin entry identifiers and order are preserved");
        check.deepEqual(rect(center.element), expandedEditor, "switching tools keeps the editor layout unchanged");
        entries[0].classList.add("fn__none");
        bar.syncDockBarVisibility();
        check.ok(hidden(entries[0]) && !hidden(element), "profile-hidden entries stay hidden during refresh");
        entries[0].classList.remove("fn__none");

        dock.hideDockByHover();
        dock.showDock(true);
        await settle();
        check.ok(hidden(element), "position refreshes do not cancel a pending hover close");
        dock.showDock();
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const during = [];
        for (let frame = 0; frame < 4; frame++) {
            await new Promise(resolve => requestAnimationFrame(resolve));
            const movingPanel = dock.layout.element.getBoundingClientRect();
            const movingBar = element.getBoundingClientRect();
            const gap = position === "Left" ? movingPanel.left - movingBar.right : movingBar.left - movingPanel.right;
            check.ok(Math.abs(gap) < 2, `bar follows the panel during entry, gap=${gap}`);
            during.push(position === "Left" ? movingBar.left : window.innerWidth - movingBar.right);
            check.deepEqual(rect(center.element), initialEditor, "animation does not move the editor");
        }
        check.ok(during[0] < 0 && during.at(-1) > during[0], "the bar slides into the window instead of appearing instantly");
        dock.hideDock();
        await new Promise(resolve => requestAnimationFrame(resolve));
        dock.showDock();
        for (let frame = 0; frame < 4; frame++) {
            await new Promise(resolve => requestAnimationFrame(resolve));
            const movingPanel = dock.layout.element.getBoundingClientRect();
            const movingBar = element.getBoundingClientRect();
            const gap = position === "Left" ? movingPanel.left - movingBar.right : movingBar.left - movingPanel.right;
            check.ok(Math.abs(gap) < 2, `interrupted animations keep the bar attached, gap=${gap}`);
        }
        await settle();
        check.equal(element.inert, false, "reentering during close restores interaction");
        check.equal(element.parentElement.querySelectorAll(".dock__backdrop").length, 1,
            "interrupted animation reuses its background");

        const input = dock.layout.element.querySelector(`[data-id="${position}two"] input`);
        input.focus();
        dock.hideDock();
        check.ok(!hidden(element), "focused input keeps both panel and bar open");
        input.blur();
        menu.style.zIndex = "9999";
        menu.classList.remove("fn__none");
        dock.hideDock();
        check.ok(!hidden(element), "open menu keeps both panel and bar open");
        menu.classList.add("fn__none");

        center.element.dispatchEvent(new MouseEvent("mousemove", {bubbles: true,
            clientX: window.innerWidth / 2, clientY: 200}));
        await settle();
        check.ok(hidden(element), "leaving the dock and panel restores the hidden state");
        check.equal(dock.layout.element.style.opacity, "0");
        check.deepEqual(rect(center.element), initialEditor, "closing a temporary bar restores the editor space");
        dock.showDock();
        dock.togglePanel(false);
        check.ok(hidden(element), "explicitly collapsing a panel clears its temporary bar");
        center.element.dispatchEvent(new MouseEvent("mousemove", {bubbles: true,
            clientX: position === "Left" ? 1 : window.innerWidth - 1, clientY: 200}));
        await settle();
        check.ok(!hidden(element), "edge hover reveals entries when the panel is explicitly collapsed");
        check.ok(hidden(dock.layout.element), "bar hover preserves the explicit panel collapse");
        dock.hideDock();
        dock.togglePanel(true);
        await settle();
        check.ok(!hidden(element));
        dock.togglePin();
        check.ok(hidden(element), "pinning does not reveal a globally hidden bar");
        dock.togglePin();
        dock.showDock();
        await settle();
        check.ok(!hidden(element));
        dock.toggleModel(position + "two", false, true, false, false);
        await settle();
        check.ok(hidden(element), "closing the final active item hides the temporary bar");
        center.element.dispatchEvent(new MouseEvent("mousemove", {bubbles: true,
            clientX: position === "Left" ? 1 : window.innerWidth - 1, clientY: 200}));
        await settle();
        check.ok(!hidden(element), "the edge remains usable after closing the last panel");
        dock.hideDock();
    }
    document.removeEventListener("mousemove", move);

    open("Left");
    open("Right");
    open("Bottom");
    await settle();
    check.ok(!hidden(leftBar) && !hidden(rightBar));
    checkRightDockSpace("a temporary right bar overlays the editor instead of reserving space");
    docks.Left.hideDock();
    await settle();
    check.ok(hidden(leftBar) && !hidden(rightBar), "each side closes independently");
    check.equal(bottom.element.style.left, "0px");
    check.equal(bottom.element.style.right, "0px", "temporary bars do not narrow the bottom panel");
    check.deepEqual(rect(center.element), initialEditor);
    docks.Right.hideDock();
    await settle();
    check.ok(hidden(leftBar) && hidden(rightBar), "the bottom panel alone reveals no side bars");
    check.equal(bottom.element.style.right, "0px", "closing the side bar restores bottom panel width");
    docks.Bottom.hideDock();

    docks.Right.togglePin();
    docks.Right.setResponsiveFloating(true, 240);
    docks.Right.showDock();
    await settle();
    check.ok(!hidden(rightBar), "responsive floating uses the same temporary bar");
    docks.Right.setResponsiveFloating(false, 240);
    check.ok(hidden(rightBar), "restoring fixed layout clears the temporary bar");
    docks.Right.togglePin();
    docks.Right.showDock();
    await settle();

    document.getElementById("toolbar").classList.add("fn__none");
    document.getElementById("status").classList.add("fn__none");
    await settle();
    check.equal(rightBar.getBoundingClientRect().top,
        rightBar.parentElement.getBoundingClientRect().top + parseFloat(getComputedStyle(rightBar).marginTop));
    check.equal(rightBar.getBoundingClientRect().bottom, rightBar.parentElement.getBoundingClientRect().bottom);
    document.body.style.setProperty("--b3-ui-dock-width", "64px");
    docks.Right.showDock(true);
    await settle();
    check.equal(rightBar.clientWidth, 64);
    check.equal(right.element.getBoundingClientRect().right, rightBar.getBoundingClientRect().left,
        "density changes update the panel offset");

    const fullscreen = right.element.querySelector('[data-id="Rightone"]');
    fullscreen.classList.add("fullscreen");
    docks.Right.showDock(true);
    await settle();
    const hit = document.elementFromPoint(innerWidth - 10, 200);
    check.ok(fullscreen.contains(hit), "the bar does not cover fullscreen panel content");
    docks.Right.hideDock();
    check.equal(right.element.style.opacity, "1");
    fullscreen.classList.remove("fullscreen");
    docks.Right.showDock(true);

    window.siyuan.config.uiLayout.hideDock = false;
    bar.syncDockBarVisibility();
    docks.Right.showDock(true);
    check.ok(!hidden(leftBar) && !hidden(rightBar));
    check.equal(rightDockSpace(), "var(--b3-ui-dock-width, 42px)",
        "a fixed right bar publishes its width so notifications keep a gap from it");
    check.equal(rightBar.style.top, "");
    check.equal(rightBar.style.zIndex, "");
    docks.Right.hideDock();
    check.ok(!hidden(rightBar), "globally visible bars remain visible after floating panels close");
    window.siyuan.config.uiLayout.hideDock = true;
    bar.syncDockBarVisibility();
    check.ok(hidden(leftBar) && hidden(rightBar));
    check.equal(rightDockSpace(), "0px", "hiding the right bar restores the window edge offset");
    check.equal(window.siyuan.config.uiLayout.hideDock, true);
    return "Floating dock bar cases passed";
};

if (process.versions.electron && process.type === "browser") {
    const {app, BrowserWindow, ipcMain} = require("electron");
    app.setPath("userData", process.argv[2]);
    app.whenReady().then(async () => {
        const win = new BrowserWindow({show: false, frame: false, webPreferences: {
            nodeIntegration: true, contextIsolation: false, offscreen: true, backgroundThrottling: false,
        }});
        let captureName;
        ipcMain.handle("dock-bar-pixels", async (_event, points) => {
            const capture = await win.webContents.capturePage();
            const bitmap = capture.toBitmap();
            const size = capture.getSize();
            const [width] = win.getContentSize();
            const scale = size.width / width;
            return points.map(({x, y}) => {
                const offset = (Math.floor(y * scale) * size.width + Math.floor(x * scale)) * 4;
                return Array.from(bitmap.subarray(offset, offset + 4));
            });
        });
        if (process.env.SIYUAN_DOCK_TEST_SCREENSHOTS) {
            ipcMain.handle("dock-bar-capture", async (_event, position) => {
                assert.ok(["Left", "Right"].includes(position));
                writeFileSync(path.join(process.env.SIYUAN_DOCK_TEST_SCREENSHOTS, `${captureName}-${position}.png`),
                    (await win.webContents.capturePage()).toPNG());
            });
        }
        try {
            const sources = Object.fromEntries([
                ["barVisibility", "layout/dock/barVisibility"], ["panelVisibility", "layout/dock/panelVisibility"],
                ["index", "layout/dock/index"], ["mousemove", "boot/globalEvent/mousemove"],
            ].map(([name, file]) => [name, transpileModule(readFileSync(path.join(__dirname, `../src/${file}.ts`), "utf8"), {
                compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
            }).outputText]));
            const template = readFileSync(path.join(__dirname, "../src/assets/template/desktop/index.tpl"), "utf8")
                .split('<div class="fn__flex-1 fn__flex">')[1].split('<div id="status"')[0];
            const html = '<div class="fn__flex-1 fn__flex">' + template;
            const styles = sass.compile(path.join(__dirname, "../src/assets/scss/base.scss"), {logger: sass.Logger.silent}).css;
            for (const theme of ["daylight", "midnight"]) {
                const css = readFileSync(path.join(__dirname, `../appearance/themes/${theme}/theme.css`), "utf8") + styles;
                for (const width of [1200, 700]) {
                    for (const hideToolbar of [false, true]) {
                        captureName = `${theme}-${width}-${hideToolbar ? "hidden-toolbar" : "toolbar"}`;
                        win.setContentSize(width, 800);
                        await win.loadURL(`data:text/html,<html><body class='fn__flex-column${hideToolbar ? " body--toolbar-hide" : ""}'></body></html>`);
                        const result = await win.webContents.executeJavaScript(`(${browserCases.toString()})(${[
                            sources, css, html,
                        ].map(value => JSON.stringify(value)).join(",")})`);
                        assert.equal(result, "Floating dock bar cases passed", captureName);
                    }
                }
            }
            console.log("Floating dock bar cases passed");
            win.destroy();
            app.exit(0);
        } catch (error) {
            console.error(error);
            win.destroy();
            app.exit(1);
        }
    });
} else {
    test("floating dock bars preserve editor width and remain accessible when every panel is closed", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 180000,
    }, async () => {
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-dock-bar-"));
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 175000});
            assert.match(stdout, /Floating dock bar cases passed/);
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(profile).startsWith("siyuan-dock-bar-"));
            rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
