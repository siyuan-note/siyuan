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
    document.body.innerHTML = '<div id="toolbar" class="toolbar"></div>' + template +
        '<div id="status" class="status"></div><div id="commonMenu" class="fn__none"></div>';
    const layouts = document.getElementById("layouts");
    layouts.classList.add("fn__flex-column");
    layouts.innerHTML = '<div id="outer" class="fn__flex fn__flex-1">' +
        '<div id="left" class="layout fn__flex-column"></div><div class="layout__resize"></div>' +
        '<div id="center" class="layout__center fn__flex-1 fn__flex"><div class="layout-tab-container fn__flex-1">Editor</div></div>' +
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
    const outer = {element: document.getElementById("outer"), children: [left, center, right]};
    window.siyuan = {zIndex: 10, config: {uiLayout: {hideDock: true}, appearance: {hideStatusBar: false}, system: {os: "linux"}},
        layout: {layout: {children: [outer, bottom]}, centerLayout: center}};
    const bar = load("barVisibility");
    const resizes = [];
    const dependencies = {
        ...bar, ...load("panelVisibility"),
        Constants: {TIMEOUT_DOCK_TOGGLE: 20, TIMEOUT_TRANSITION: 20, ATTRIBUTE_DOCK_WIDTH: "data-width"},
        bindPanelTransitionGuard() {}, isTouchHoverInput: () => false,
        isWindow: () => false, isAbove: (a, b) => Number(a.style.zIndex) > Number(b.style.zIndex),
        resizeTabs(save) { resizes.push(save); }, setTabPosition() {}, adjustLayout() {}, setPanelFocus() {},
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
        return Object.fromEntries(["position", "backgroundColor", "borderTopLeftRadius", "borderTopRightRadius",
            "borderBottomLeftRadius", "borderBottomRightRadius", "marginTop", "boxShadow"]
            .map(key => [key, style[key]]));
    };
    bar.syncDockBarVisibility();
    const initialEditor = rect(center.element);
    const leftBar = document.getElementById("dockLeft");
    const rightBar = document.getElementById("dockRight");
    check.ok(hidden(leftBar) && hidden(rightBar));
    for (const position of ["Left", "Right"]) {
        const dock = docks[position];
        const element = position === "Left" ? leftBar : rightBar;
        const otherBar = position === "Left" ? rightBar : leftBar;
        const entries = Array.from(element.querySelectorAll(".dock__item"));
        const order = entries.map(item => item.dataset.entryId);
        open(position);
        await settle();
        check.ok(!hidden(element) && hidden(otherBar), "only the expanded side reveals its bar");
        check.ok(rect(center.element).width < initialEditor.width, "a temporary bar uses its normal layout space");
        check.ok(resizes.includes(false), "bar visibility resizes the editor without saving the hidden preference");
        const panelRect = dock.layout.element.getBoundingClientRect();
        const barRect = element.getBoundingClientRect();
        check.equal(position === "Left" ? panelRect.left : panelRect.right,
            position === "Left" ? barRect.right : barRect.left, "panel stays beside the bar");
        const temporary = {bar: rect(element), panel: rect(dock.layout.element),
            barStyle: appearance(element), panelStyle: appearance(dock.layout.element)};
        window.siyuan.config.uiLayout.hideDock = false;
        bar.syncDockBarVisibility();
        dock.showDock(true);
        check.deepEqual({bar: rect(element), panel: rect(dock.layout.element),
            barStyle: appearance(element), panelStyle: appearance(dock.layout.element)}, temporary,
        "temporary bars preserve the geometry, colors and corners of normally visible bars and panels");
        window.siyuan.config.uiLayout.hideDock = true;
        bar.syncDockBarVisibility();
        dock.showDock(true);
        const expandedEditor = rect(center.element);
        if (process.env.SIYUAN_DOCK_TEST_SCREENSHOTS) {
            await require("electron").ipcRenderer.invoke("dock-bar-capture", position);
        }

        const {windowMouseMove} = load("mousemove", dependencies);
        const move = event => windowMouseMove(event);
        document.addEventListener("mousemove", move);
        dock.hideDockByHover();
        // 覆盖停靠栏最外侧像素，不能因旧的边缘范围少两个像素而收起。
        element.dispatchEvent(new MouseEvent("mousemove", {bubbles: true,
            clientX: position === "Left" ? 1 : window.innerWidth - 1, clientY: 200}));
        dock.layout.element.dispatchEvent(new MouseEvent("mouseleave", {relatedTarget: entries[0],
            clientX: position === "Left" ? barRect.right - 1 : barRect.left + 1, clientY: 200}));
        await settle();
        check.equal(dock.layout.element.style.opacity, "1", "moving from panel to bar keeps the panel open");
        check.ok(!hidden(element));

        entries[1].addEventListener("click", () => dock.toggleModel(position + "two", false, true, false, false));
        entries[1].click();
        await settle();
        check.ok(entries[1].classList.contains("dock__item--active"));
        check.ok(!hidden(dock.layout.element.querySelector(`[data-id="${position}two"]`)));
        check.deepEqual(entries.map(item => item.dataset.entryId), order, "plugin entry identifiers and order are preserved");
        check.deepEqual(rect(center.element), expandedEditor, "switching tools preserves the occupied dock space");
        entries[0].classList.add("fn__none");
        bar.syncDockBarVisibility();
        check.ok(hidden(entries[0]) && !hidden(element), "profile-hidden entries stay hidden during refresh");
        entries[0].classList.remove("fn__none");

        const input = dock.layout.element.querySelector(`[data-id="${position}two"] input`);
        input.focus();
        dock.hideDock();
        check.ok(!hidden(element), "focused input keeps both panel and bar open");
        input.blur();
        const menu = document.getElementById("commonMenu");
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
        document.removeEventListener("mousemove", move);
        dock.showDock();
        dock.togglePanel(false);
        check.ok(hidden(element), "explicitly collapsing a panel clears its temporary bar");
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
    }

    open("Left");
    open("Right");
    open("Bottom");
    await settle();
    check.ok(!hidden(leftBar) && !hidden(rightBar));
    docks.Left.hideDock();
    check.ok(hidden(leftBar) && !hidden(rightBar), "each side closes independently");
    check.equal(bottom.element.style.left, "0px");
    check.equal(bottom.element.style.right, rightBar.clientWidth + "px", "bottom panel follows normally occupied side bars");
    docks.Right.hideDock();
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
    check.equal(rightBar.style.top, "");
    check.equal(rightBar.style.zIndex, "");
    docks.Right.hideDock();
    check.ok(!hidden(rightBar), "globally visible bars remain visible after floating panels close");
    window.siyuan.config.uiLayout.hideDock = true;
    bar.syncDockBarVisibility();
    check.ok(hidden(leftBar) && hidden(rightBar));
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
    test("floating side panels temporarily reveal dock bars using their normal layout and appearance", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 120000,
    }, async () => {
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-dock-bar-"));
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 115000});
            assert.match(stdout, /Floating dock bar cases passed/);
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(profile).startsWith("siyuan-dock-bar-"));
            rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
