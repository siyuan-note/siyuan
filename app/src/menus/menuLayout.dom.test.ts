import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {compile, Logger} from "sass";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const browserCases = async (sources: Record<string, string>, css: string) => {
    const check: typeof assert = require("node:assert/strict");
    let mobile = false;
    const modules: Record<string, {exports: any}> = {};
    const externals = {
        "protyle/util/compatibility": {getEventName: () => "click", updateHotkeyTip: (value: string) => value},
        "util/functions": {isMobile: () => mobile},
        "util/zIndex": {isScrollAboveMenu: () => false},
        "layout/getTopBarHeight": {getTopBarHeight: () => 32},
        constants: {Constants: {TIMEOUT_DBLCLICK: 10, ATTRIBUTE_MENU_KEYMAP: "data-keymap"}},
        "protyle/undo": {electronUndo() {}},
        "util/escape": {escapeAttr: (value: string) => value},
        "menus/menuKeyboard": {setMenuInputCurrent() {}},
        "plugin/EventBusCore": {forEachPluginSubscriber() {}},
        "mobile/util/keyboardToolbar": {activeBlur() {}},
        "block/popoverLifecycle": {setPopoverMenuOpen() {}},
        "config/entryVisibility/runtime": {applyMenuEntryVisibility() {}},
        "menus/menuToggle": {},
    };
    const load = (name: string): any => {
        if (name in externals) {
            return externals[name as keyof typeof externals];
        }
        if (modules[name]) {
            return modules[name].exports;
        }
        check.ok(sources[name], `Unexpected menu fixture dependency: ${name}`);
        const module = {exports: {}};
        modules[name] = module;
        new Function("require", "module", "exports", sources[name])((dependency: string) => {
            const parts = name.split("/");
            parts.pop();
            dependency.split("/").forEach(part => {
                if (part === "..") {
                    parts.pop();
                } else if (part !== ".") {
                    parts.push(part);
                }
            });
            return load(parts.join("/"));
        }, module, module.exports);
        return module.exports;
    };
    const style = document.createElement("style");
    style.textContent = css + `
        :root { --b3-font-size: 16px; --b3-theme-surface-lighter: #aaa; }
        body { margin: 0; }
        button { font: inherit; }
        .fn__none { display: none !important; }
    `;
    document.head.append(style);
    Object.assign(window, {siyuan: {languages: {back: "Back"}, zIndex: 0,
        mobile: {size: {portrait: {height1: innerHeight}}}, menus: {}}});
    const {Menu, MenuItem}: typeof import("./Menu") = load("menus/Menu");
    const {Menu: PluginMenu}: typeof import("../plugin/Menu") = load("plugin/Menu");
    const settle = async () => {
        for (let i = 0; i < 3; i++) {
            await new Promise(resolve => requestAnimationFrame(resolve));
        }
    };
    const createMenu = () => {
        const element = document.createElement("div");
        element.id = "commonMenu";
        element.className = "b3-menu fn__none";
        element.innerHTML = '<div class="b3-menu__title fn__none"><span class="b3-menu__label"></span></div>' +
            '<div class="b3-menu__items"></div>';
        document.body.append(element);
        const menu = new Menu(element);
        window.siyuan.menus.menu = menu;
        return menu;
    };
    const addItems = (menu: InstanceType<typeof Menu>, count: number) => {
        for (let i = 0; i < count; i++) {
            menu.addItem({label: `Item ${i}`});
        }
    };
    const fitsViewport = (element: HTMLElement) => {
        const rect = element.getBoundingClientRect();
        check.ok(rect.top >= 31.5, `Menu top ${rect.top}`);
        check.ok(rect.bottom <= innerHeight + .5, `Menu bottom ${rect.bottom}, viewport ${innerHeight}`);
        check.ok(rect.left >= 0 && rect.right <= innerWidth + .5,
            `Menu horizontal bounds ${rect.left}, ${rect.right}, viewport ${innerWidth}`);
    };
    const fullyVisible = (element: Element) => check.ok(element.scrollHeight <= element.clientHeight + 1,
        `Content height ${element.scrollHeight}, visible ${element.clientHeight}`);
    const dispose = (menu: InstanceType<typeof Menu>) => {
        menu.remove();
        menu.element.remove();
    };

    const menu = createMenu();
    addItems(menu, 2);
    menu.popup({x: 760, y: 600});
    await settle();
    const reset = menu.resetPosition.bind(menu);
    let resets = 0;
    menu.resetPosition = () => { resets++; reset(); };
    addItems(menu, 10);
    await settle();
    check.equal(resets, 1);
    check.ok(menu.element.getBoundingClientRect().bottom <= 600);
    fullyVisible(menu.element.lastElementChild);
    fitsViewport(menu.element);
    await settle();
    check.equal(resets, 1, "Layout writes must not schedule another update");
    for (let i = 0; i < 10; i++) {
        menu.element.lastElementChild.lastElementChild.remove();
    }
    await settle();
    check.equal(menu.element.getBoundingClientRect().top, 600);
    for (const count of [3, 4, 2]) {
        addItems(menu, count);
        await settle();
        fullyVisible(menu.element.lastElementChild);
        fitsViewport(menu.element);
    }
    check.ok(menu.element.getBoundingClientRect().bottom <= 600);

    const label = menu.element.lastElementChild.querySelector(".b3-menu__label");
    label.innerHTML = '<div style="width: 160px; white-space: normal">Short</div>';
    await settle();
    const beforeTextChange = menu.element.getBoundingClientRect().height;
    label.firstElementChild.firstChild.textContent = "Long content ".repeat(40);
    await settle();
    check.ok(menu.element.getBoundingClientRect().height > beforeTextChange, "Text mutations resize the menu");
    fitsViewport(menu.element);
    check.ok(menu.element.lastElementChild.scrollHeight > menu.element.lastElementChild.clientHeight, "Long content scrolls");
    await require("electron").ipcRenderer.invoke("resize-menu-test", 640, 520);
    await settle();
    fitsViewport(menu.element);
    await require("electron").ipcRenderer.invoke("resize-menu-test", 1000, 800);
    await settle();
    fitsViewport(menu.element);
    dispose(menu);

    const themed = createMenu();
    themed.element.style.setProperty("--b3-ui-menu-padding", "24px 0");
    themed.element.style.setProperty("--b3-ui-menu-height", "48px");
    themed.element.style.fontSize = "32px";
    themed.element.style.borderWidth = "3px";
    addItems(themed, 2);
    themed.popup({x: 80, y: 650});
    addItems(themed, 30);
    await settle();
    fitsViewport(themed.element);
    check.ok(themed.element.lastElementChild.scrollHeight > themed.element.lastElementChild.clientHeight);
    dispose(themed);

    const anchored = createMenu();
    const anchor = document.createElement("button");
    anchor.style.cssText = "position:fixed;left:700px;top:580px;width:80px;height:30px";
    document.body.append(anchor);
    const rect = anchor.getBoundingClientRect();
    addItems(anchored, 2);
    anchored.popup({x: rect.left, y: rect.bottom, h: rect.height, w: rect.width, target: anchor});
    addItems(anchored, 40);
    await settle();
    fitsViewport(anchored.element);
    check.ok(anchored.element.getBoundingClientRect().bottom <= rect.top + .5);
    dispose(anchored);
    anchor.remove();

    const submenus = createMenu();
    submenus.addItem({label: "Parent", action: "iconMore", submenu: [
        {label: "Child", submenu: [{label: "Grandchild"}]},
    ]});
    submenus.popup({x: 720, y: 650});
    const parent = submenus.element.lastElementChild.firstElementChild;
    const submenu = parent.querySelector<HTMLElement>(":scope > .b3-menu__submenu");
    const nested = submenu.querySelector<HTMLElement>(".b3-menu__submenu");
    parent.classList.add("b3-menu__item--show");
    submenus.showSubMenu(submenu);
    for (let i = 0; i < 30; i++) {
        submenu.lastElementChild.append(new MenuItem({label: `Subitem ${i}`}, submenus).element);
    }
    await settle();
    fitsViewport(submenu);
    check.equal((nested.lastElementChild as HTMLElement).style.maxHeight, "");
    const child = submenu.lastElementChild.firstElementChild;
    child.classList.add("b3-menu__item--show");
    submenus.showSubMenu(nested);
    for (let i = 0; i < 30; i++) {
        nested.lastElementChild.append(new MenuItem({label: `Nested ${i}`}, submenus).element);
    }
    await settle();
    fitsViewport(submenu);
    fitsViewport(nested);
    submenu.dataset.anchor = "action";
    submenus.resetPosition();
    fitsViewport(submenu);
    dispose(submenus);

    const shared = createMenu();
    const independent = new PluginMenu(undefined, undefined, true);
    independent.addItem({label: "First"});
    independent.open({x: 400, y: 650});
    for (let i = 0; i < 12; i++) {
        independent.addItem({label: `Plugin ${i}`});
    }
    await settle();
    fitsViewport(independent.element);
    fullyVisible(independent.element.lastElementChild);
    check.ok(independent.element.getBoundingClientRect().bottom <= 650);
    independent.close();
    await settle();
    check.equal(independent.element.isConnected, false);
    dispose(shared);

    mobile = true;
    const sheet = createMenu();
    sheet.element.classList.add("b3-menu--fit");
    addItems(sheet, 2);
    sheet.fullscreen("bottom", undefined, {preserveKeyboard: true});
    await settle();
    const sheetHeight = sheet.element.getBoundingClientRect().height;
    const resetSheet = sheet.resetPosition.bind(sheet);
    let sheetResets = 0;
    sheet.resetPosition = () => { sheetResets++; resetSheet(); };
    addItems(sheet, 10);
    await settle();
    check.ok(sheet.element.getBoundingClientRect().height > sheetHeight);
    check.ok(sheet.element.getBoundingClientRect().height <= innerHeight * .9 + .5);
    check.equal(sheetResets, 1);
    await settle();
    check.equal(sheetResets, 1, "Sheet title updates must not cause a layout loop");
    addItems(sheet, 2);
    await Promise.resolve();
    sheet.remove();
    await settle();
    check.equal(sheetResets, 1, "Closing cancels the pending layout update");
    sheet.element.remove();
    return "Menu layout cases passed";
};

test("menus adapt to dynamic content, viewport changes, themes and mobile sheets", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 45000,
}, async () => {
    const sources = Object.fromEntries(["menus/Menu", "menus/menuPosition", "menus/menuGroup", "menus/sheetOpen",
        "util/setPosition", "protyle/util/hasClosest", "plugin/Menu"].map(name => [name,
        transpileModule(readFileSync(path.join(__dirname, "..", name + ".ts"), "utf8"), {
            compilerOptions: {target: ScriptTarget.ES2021, module: ModuleKind.CommonJS},
        }).outputText]));
    const css = compile(path.join(__dirname, "../assets/scss/component/_menu.scss"), {logger: Logger.silent}).css;
    const source = `const __name = value => value; (${browserCases.toString()})(${JSON.stringify(sources)}, ${JSON.stringify(css)})`;
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-menu-layout-test-"));
    const script = path.join(temporary, "run.cjs");
    writeFileSync(script, `const {app, BrowserWindow, ipcMain} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, width: 1000, height: 800, useContentSize: true,
        webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true, backgroundThrottling: false}});
    ipcMain.handle("resize-menu-test", (_event, width, height) => win.setContentSize(width, height));
    try {
        await win.loadURL("about:blank");
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(source)}));
        win.destroy();
        app.exit(0);
    } catch (error) {
        console.error(error);
        win.destroy();
        app.exit(1);
    }
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron") as unknown as string, [script],
            {env, timeout: 40000, windowsHide: true});
        assert.match(result.stdout, /Menu layout cases passed/);
    } finally {
        assert.equal(path.dirname(path.resolve(temporary)), path.resolve(tmpdir()));
        assert.ok(path.basename(temporary).startsWith("siyuan-menu-layout-test-"));
        rmSync(temporary, {recursive: true, force: true});
    }
});
