import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {compile, Logger} from "sass";
import {browserSources, canRunBrowser, runBrowserCase} from "../../datePicker/test/browser";

test("touch dismissal clears breadcrumb menu button highlights while mouse hover still works", {
    skip: !canRunBrowser, timeout: 45000,
}, async () => {
    const moduleNames = ["protyle/breadcrumb/index", "menus/Menu", "menus/menuGroup", "menus/sheetActions", "menus/sheetOpen",
        "mobile/util/mobileSheetGesture", "mobile/util/keyboardSheetState", "protyle/util/hasClosest"];
    const sources = browserSources(Object.fromEntries(moduleNames.map(name => [name, "src/" + name + ".ts"])));
    const css = ["business/_block.scss", "component/_menu.scss", "main/_mobile.scss"].map(path =>
        compile("src/assets/scss/" + path, {logger: Logger.silent}).css).join("\n");
    for (const name of ["daylight", "midnight"]) {
        sources[name] = readFileSync("appearance/themes/" + name + "/theme.css", "utf8");
    }
    const output = await runBrowserCase(async (sources, css) => {
        const style = document.createElement("style");
        document.head.append(style);
        document.body.innerHTML = '<div id="commonMenuScrim" class="b3-menu__scrim fn__none"></div>' +
            '<div id="commonMenu" class="b3-menu fn__none"><div class="b3-menu__title fn__none">' +
            '<span class="b3-menu__label"></span></div><div class="b3-menu__items"></div></div>';
        Object.assign(window, {siyuan: {languages: {gutterTip2: "Document menu", more: "More", back: "Back"},
            config: {keymap: {editor: {general: {exitFocus: {custom: ""}}}}}, zIndex: 0,
            mobile: {size: {portrait: {height1: innerHeight}}}, menus: {}}});
        const menuElement = document.getElementById("commonMenu");
        let lastError = "";
        window.addEventListener("error", event => { lastError = event.message; });
        window.addEventListener("unhandledrejection", event => { lastError = String(event.reason); });
        const openSheet = () => {
            menu.remove();
            menu.addItem({label: "Menu action"});
            menu.fullscreen();
        };
        const noop = () => {};
        const modules: Record<string, unknown> = {
            "constants": {Constants: {TIMEOUT_DBLCLICK: 10}},
            "protyle/util/compatibility": {isIPad: () => false, isInAndroid: () => false, isInHarmony: () => false,
                isMac: () => false, updateHotkeyTip: String},
            "util/functions": {isMobile: () => true},
            "util/escape": {escapeAttr: String},
            "mobile/util/keyboardToolbar": {activeBlur: noop, bindMobileMenuKeyboard: () => noop},
            "protyle/util/editorFocus": {getEditorFocusRange: noop},
            "protyle/breadcrumb/history": {DocumentHistory: class {}},
            "protyle/header/openTitleMenu": {openTitleMenu: openSheet},
            "boot/globalEvent/command/panel": {commandPanel: openSheet},
            "plugin/breadcrumbButton": {mountBreadcrumbButtons: noop},
            "plugin/EventBusCore": {forEachPluginSubscriber: noop},
            "block/popoverLifecycle": {setPopoverMenuOpen: noop},
            "config/entryVisibility/runtime": {applyMenuEntryVisibility: noop},
        };
        const load = (name: string): unknown => {
            if (name in modules) return modules[name];
            if (!sources[name]) return {};
            const exports = {};
            modules[name] = exports;
            new Function("exports", "require", sources[name])(exports, (id: string) =>
                load(new URL(id, "https://fixture.test/" + name).pathname.slice(1)));
            return exports;
        };
        const {Menu} = load("menus/Menu") as typeof import("../../menus/Menu");
        const menu = new Menu(menuElement);
        const {Breadcrumb} = load("protyle/breadcrumb/index") as typeof import("./index");
        const breadcrumb = new Breadcrumb({wysiwyg: {}, toolbar: {}} as IProtyle);
        breadcrumb.showMenu = async () => openSheet();
        document.body.prepend(breadcrumb.element.parentElement);
        const getButton = (type: string) => breadcrumb.element.parentElement.querySelector(`button[data-type="${type}"]`);
        const point = (element: Element) => {
            const {left, top, width, height} = element.getBoundingClientRect();
            return {x: left + width / 2, y: top + height / 2};
        };
        Object.assign(window, {
            useTheme: (theme: string) => {
                style.textContent = sources[theme] + css + `:root {--b3-transition:none; --mobile-top-safe-area:0px;}
                    .fn__none {display:none!important} .protyle-breadcrumb__actions {display:flex;gap:8px}
                    .protyle-breadcrumb .block__icon {opacity:1}`;
            },
            buttonPoint: (type: string) => point(getButton(type)),
            sheetGrip: () => point(menuElement.firstElementChild),
            buttonBackground: (type: string) => getComputedStyle(getButton(type)).backgroundColor,
            waitForSheet: async (open: boolean, type: string) => {
                for (let attempt = 0; attempt < 40; attempt++) {
                    if (open ? menuElement.style.transform === "translateY(0px)" &&
                        menuElement.getBoundingClientRect().bottom <= innerHeight + 0.5 : menuElement.classList.contains("fn__none")) {
                        return;
                    }
                    await new Promise(resolve => requestAnimationFrame(resolve));
                }
                throw Error(`${type} did not ${open ? "open" : "close"}: ${menuElement.className} ${menuElement.style.transform} ${lastError}`);
            },
        });
        return "ready";
    }, sources, css, {width: 390, height: 640, interact: async win => {
        const run = (source: string) => win.webContents.executeJavaScript(source);
        const debugger_ = win.webContents.debugger;
        await debugger_.sendCommand("Emulation.setTouchEmulationEnabled", {enabled: true, maxTouchPoints: 1});
        const result = [];
        for (const theme of ["daylight", "midnight"]) {
            await run(`useTheme("${theme}")`);
            for (const type of ["doc", "more", "command-panel"]) {
                const trigger = await run(`buttonPoint("${type}")`);
                await debugger_.sendCommand("Input.dispatchTouchEvent", {type: "touchStart", touchPoints: [trigger]});
                await debugger_.sendCommand("Input.dispatchTouchEvent", {type: "touchEnd", touchPoints: []});
                await run(`waitForSheet(true, "${type}")`);
                const grip = await run("sheetGrip()");
                await debugger_.sendCommand("Input.dispatchTouchEvent", {type: "touchStart", touchPoints: [grip]});
                await debugger_.sendCommand("Input.dispatchTouchEvent", {type: "touchMove", touchPoints: [{...grip, y: grip.y + 180}]});
                await debugger_.sendCommand("Input.dispatchTouchEvent", {type: "touchEnd", touchPoints: []});
                await run(`waitForSheet(false, "${type}")`);
                result.push({theme, type, background: await run(`buttonBackground("${type}")`)});
            }
        }
        await debugger_.sendCommand("Emulation.setTouchEmulationEnabled", {enabled: false});
        const trigger = await run('buttonPoint("doc")');
        await debugger_.sendCommand("Input.dispatchMouseEvent", {type: "mouseMoved", ...trigger});
        const mouseBackground = await run('buttonBackground("doc")');
        return JSON.stringify({result, mouseBackground});
    }});
    const {result, mouseBackground} = JSON.parse(output);
    for (const {theme, type, background} of result) {
        assert.equal(background, "rgba(0, 0, 0, 0)", `${theme} ${type}`);
    }
    assert.notEqual(mouseBackground, "rgba(0, 0, 0, 0)");
});
