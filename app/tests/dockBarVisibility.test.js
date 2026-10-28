const assert = require("node:assert/strict");
const {mkdtempSync, readFileSync, rmSync, writeFileSync} = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const {test} = require("node:test");
const {ModuleKind, ScriptTarget, transpileModule} = require("typescript");
const sass = require("sass");

const browserCases = async (sources, css, template, animationOnly = false) => {
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
        check.equal(rightDockSpace(), reserved ? "var(--b3-ui-dock-width, 42px)" : "var(--b3-layout-space)",
            message);
    };
    checkRightDockSpace("a hidden right bar reserves no space for fixed overlays");
    if (animationOnly) {
        const nextFrames = async () => {
            for (let index = 0; index < 3; index++) {
                await new Promise(resolve => requestAnimationFrame(resolve));
            }
        };
        for (const position of ["Left", "Right"]) {
            const dock = docks[position];
            const panel = dock.layout.element;
            const element = position === "Left" ? leftBar : rightBar;
            open(position);
            await settle();
            dock.hideDock();
            await settle();
            const checkAttached = (message, checkOpacity = true) => {
                const panelRect = panel.getBoundingClientRect();
                const barRect = element.getBoundingClientRect();
                const gap = position === "Left" ? panelRect.left - barRect.right : barRect.left - panelRect.right;
                check.ok(Math.abs(gap) < 2, `${position} ${message}: gap=${gap}`);
                if (checkOpacity) {
                    check.ok(Math.abs(Number(getComputedStyle(panel).opacity) - Number(getComputedStyle(element).opacity)) < .02,
                        `${position} ${message}: opacity follows the panel`);
                }
                check.deepEqual(rect(center.element), initialEditor, "custom animations do not resize the editor");
            };
            const finish = async () => {
                await Promise.all([...panel.getAnimations(), ...element.getAnimations()].map(animation => animation.finished));
                await nextFrames();
            };
            // 动画结束后必须回到停靠栏原始位置，否则边缘会留出缝隙并在动画释放时跳动。
            const checkResting = (message) => {
                const barRect = element.getBoundingClientRect();
                const edge = position === "Left" ? barRect.left : window.innerWidth - barRect.right;
                check.ok(Math.abs(edge) < 1, `${position} ${message}: resting edge=${edge}`);
                check.equal(getComputedStyle(element).transform, "none",
                    `${position} ${message}: no residual translation`);
            };
            for (const transition of ["none", "transform 600ms linear, opacity 50ms linear",
                "transform 600ms linear", "opacity 300ms linear", "transform 350ms linear 120ms, opacity 50ms linear 120ms"]) {
                panel.style.transition = transition;
                dock.showDock();
                await nextFrames();
                checkAttached(`entry with ${transition}`);
                if (transition === "none") {
                    check.equal(element.getAnimations().length, 0, "disabled panel transitions create no standalone bar animation");
                } else {
                    await new Promise(resolve => setTimeout(resolve, 180));
                    checkAttached(`entry after opacity completes with ${transition}`);
                }
                await finish();
                checkResting(`entry with ${transition}`);
                dock.hideDock();
                await nextFrames();
                if (transition === "none") {
                    check.ok(hidden(element), "disabled transitions hide the bar without a trailing animation");
                } else {
                    checkAttached(`exit with ${transition}`);
                    await new Promise(resolve => setTimeout(resolve, 180));
                    if (transition.startsWith("transform")) {
                        check.ok(!hidden(element), "short opacity transitions do not end the longer transform");
                        checkAttached(`exit after opacity completes with ${transition}`);
                    }
                }
                await finish();
                check.ok(hidden(element), "all animations complete before the temporary bar is removed");
            }
            panel.style.transition = "transform 600ms linear, opacity 50ms linear";
            dock.showDock();
            await nextFrames();
            await new Promise(resolve => setTimeout(resolve, 160));
            dock.hideDock();
            await nextFrames();
            dock.showDock();
            await nextFrames();
            checkAttached("reversing custom transitions");
            await finish();
            check.ok(!hidden(element) && !element.inert, "canceled animations cannot clean up the reopened bar");
            dock.hideDock();
            await nextFrames();
            await finish();
            check.ok(hidden(element));
            // 面板在停靠栏已经浮出时展开，停靠栏仍需贴着面板外沿一起移动。
            bar.setDockBarHover(element, true);
            await nextFrames();
            check.ok(!hidden(element) && element.classList.contains("dock--float"),
                "the edge reveals the bar before the panel opens");
            await finish();
            dock.showDock();
            await nextFrames();
            // 停靠栏已在位时面板只淡入，停靠栏不参与透明度过渡。
            checkAttached("panel opens while the bar is already floating", false);
            await finish();
            checkResting("panel opens while the bar is already floating");
            bar.setDockBarHover(element, false);
            dock.hideDock();
            await nextFrames();
            await finish();
            check.ok(hidden(element));
            panel.style.transition = "";
        }
        return "Floating dock bar cases passed";
    }
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
        check.equal(getComputedStyle(element).transform, "none",
            "clicking a revealed entry does not restart the bar from the window edge");
        check.deepEqual(rect(center.element), initialEditor, "revealing a bar and panel does not resize the editor");
        const panelRect = dock.layout.element.getBoundingClientRect();
        const barRect = element.getBoundingClientRect();
        check.equal(position === "Left" ? panelRect.left : panelRect.right,
            position === "Left" ? barRect.right : barRect.left, "panel stays beside the bar");
        check.equal(getComputedStyle(element).transform, "none",
            "the settled bar keeps no residual translation, so no gap opens at the window edge");
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

        // 指针离开图标栏后，位置刷新不应取消待执行的收起。
        center.element.dispatchEvent(new MouseEvent("mousemove", {bubbles: true,
            clientX: window.innerWidth / 2, clientY: 200}));
        dock.showDock(true);
        // 悬停收起要等延迟计时和面板过渡都结束，位置刷新不得打断它们。
        await settle();
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
        await new Promise(resolve => requestAnimationFrame(resolve));
        check.ok(!hidden(element) && element.getAnimations().length > 0,
            "explicitly collapsing a panel slides its temporary bar out instead of removing it at once");
        await settle();
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
        // 指针停在图标栏上时点击已打开的图标收起面板，停靠栏保持可见以便继续切换工具。
        element.dispatchEvent(new MouseEvent("mousemove", {bubbles: true,
            clientX: position === "Left" ? 1 : window.innerWidth - 1, clientY: 200}));
        await settle();
        dock.toggleModel(position + "two", false, true, false, false);
        await settle();
        check.ok(!hidden(element), "the pointer over the bar keeps the temporary bar visible after the panel closes");
        center.element.dispatchEvent(new MouseEvent("mousemove", {bubbles: true,
            clientX: window.innerWidth / 2, clientY: 200}));
        await new Promise(resolve => setTimeout(resolve, 60));
        check.ok(!hidden(element) && element.getAnimations().length > 0,
            "leaving the bar slides it out instead of removing it at once");
        await settle();
        check.ok(hidden(element), "leaving the bar hides the temporary bar after the panel closes");
        center.element.dispatchEvent(new MouseEvent("mousemove", {bubbles: true,
            clientX: position === "Left" ? 1 : window.innerWidth - 1, clientY: 200}));
        await settle();
        check.ok(!hidden(element), "the edge remains usable after closing the last panel");
        bar.setDockBarHover(element, false);
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
    check.equal(rightDockSpace(), "var(--b3-layout-space)",
        "hiding the right bar keeps only the editor outer margin for fixed overlays");
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
            const animationOnly = process.env.SIYUAN_DOCK_ANIMATION_CASES === "1";
            for (const theme of ["daylight", "midnight"]) {
                const css = readFileSync(path.join(__dirname, `../appearance/themes/${theme}/theme.css`), "utf8") + styles;
                for (const width of animationOnly ? [1200] : [1200, 700]) {
                    for (const hideToolbar of animationOnly ? [false] : [false, true]) {
                        captureName = `${theme}-${width}-${hideToolbar ? "hidden-toolbar" : "toolbar"}`;
                        win.setContentSize(width, 800);
                        await win.loadURL(`data:text/html,<html><body class='fn__flex-column${hideToolbar ? " body--toolbar-hide" : ""}'></body></html>`);
                        const result = await win.webContents.executeJavaScript(`(${browserCases.toString()})(${[
                            sources, css, html, animationOnly,
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
    const runCases = async (animationOnly) => {
        const env = {...process.env, SIYUAN_DOCK_ANIMATION_CASES: animationOnly ? "1" : "0"};
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
    };
    const options = {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 180000,
    };
    test("floating dock bars follow disabled, partial, delayed and interrupted panel transitions", options, () => runCases(true));
    test("floating dock bars preserve editor width and remain accessible when every panel is closed", options, () => runCases(false));
}
