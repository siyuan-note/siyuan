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
        "protyle/util/compatibility": {getEventName: () => "click", isInMobileApp: () => false,
            updateHotkeyTip: (value: string) => value},
        "util/functions": {isMobile: () => mobile},
        "util/zIndex": {isScrollAboveMenu: () => false},
        "layout/getTopBarHeight": {getTopBarHeight: () => 32},
        constants: {Constants: {TIMEOUT_DBLCLICK: 10, ATTRIBUTE_MENU_KEYMAP: "data-keymap",
            LOCAL_MENU_MOUSE_SCROLL: "menuMouseScroll"}},
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
    Object.assign(window, {siyuan: {languages: {back: "Back"}, zIndex: 0, storage: {},
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

    const pointer = (element: HTMLElement, ratio: number, pointerType = "mouse", buttons = 0) => {
        const rect = element.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height * ratio;
        const target = document.elementFromPoint(x, y);
        check.ok(target && element.contains(target), "Pointer must hit the intended menu panel");
        target.dispatchEvent(new PointerEvent("pointermove", {bubbles: true, pointerType, buttons, clientX: x, clientY: y}));
        return {x, y};
    };
    const following = createMenu();
    let clicked = -1;
    for (let i = 0; i < 80; i++) {
        following.addItem({label: `Mouse item ${i}`, click: () => { clicked = i; return true; }});
    }
    following.popup({x: 60, y: 40});
    await settle();
    const followingItems = following.element.lastElementChild as HTMLElement;
    const maxScroll = () => followingItems.scrollHeight - followingItems.clientHeight;
    pointer(followingItems, .3);
    pointer(followingItems, .6);
    check.equal(followingItems.scrollTop, 0, "The preference defaults to off");
    window.siyuan.storage.menuMouseScroll = true;
    pointer(followingItems, .3);
    check.equal(followingItems.scrollTop, 0, "Entering establishes an anchor without jumping");
    pointer(followingItems, .55);
    const middleScroll = followingItems.scrollTop;
    check.ok(middleScroll > 0 && middleScroll < maxScroll(), "Movement in the middle of the menu scrolls its contents");
    const middlePoint = pointer(followingItems, .55);
    await settle();
    check.equal(followingItems.scrollTop, middleScroll, "A stationary pointer does not keep scrolling");
    const hit = document.elementFromPoint(middlePoint.x, middlePoint.y).closest<HTMLElement>(".b3-menu__item");
    check.ok(hit.classList.contains("b3-menu__item--current"), "Highlight follows the item under the pointer after scrolling");
    hit.click();
    check.equal(clicked, Number(hit.textContent.trim().replace("Mouse item ", "")), "Click activates the highlighted item");
    pointer(followingItems, .8);
    check.ok(followingItems.scrollTop > middleScroll);
    pointer(followingItems, .55);
    check.ok(Math.abs(followingItems.scrollTop - middleScroll) <= 1, "Reversing direction scrolls back");
    pointer(followingItems, .99);
    check.equal(followingItems.scrollTop, maxScroll(), "The last item is reachable");
    pointer(followingItems, .01);
    check.equal(followingItems.scrollTop, 0, "The first item is reachable");
    pointer(followingItems, .5, "touch");
    pointer(followingItems, .8, "touch");
    check.equal(followingItems.scrollTop, 0, "Touch movement preserves native scrolling");
    pointer(followingItems, .3);
    pointer(followingItems, .7, "mouse", 1);
    check.equal(followingItems.scrollTop, 0, "Dragging does not scroll the menu");
    pointer(followingItems, .3);
    pointer(followingItems, .55);
    followingItems.scrollTop = 100;
    followingItems.dispatchEvent(new WheelEvent("wheel", {bubbles: true, deltaY: -30}));
    pointer(followingItems, .6);
    check.equal(followingItems.scrollTop, 100, "Wheel scrolling establishes a new anchor");
    pointer(followingItems, .7);
    const beforeLeave = followingItems.scrollTop;
    following.element.dispatchEvent(new PointerEvent("pointerleave"));
    pointer(followingItems, .4);
    check.equal(followingItems.scrollTop, beforeLeave, "Reentering does not jump");
    following.addItem({label: "Loaded later"});
    await settle();
    check.equal(followingItems.scrollTop, beforeLeave, "Layout measurement preserves the existing scroll position");
    const beforeMutationMove = followingItems.scrollTop;
    pointer(followingItems, .6);
    check.equal(followingItems.scrollTop, beforeMutationMove, "Dynamic content establishes a new anchor");
    window.siyuan.storage.menuMouseScroll = false;
    pointer(followingItems, .8);
    check.equal(followingItems.scrollTop, beforeMutationMove, "Disabling takes effect on an open menu");
    window.siyuan.storage.menuMouseScroll = true;
    followingItems.scrollTop = 0;
    following.resetMouseScroll();
    const nativePointer = (type: string, x: number, y: number) =>
        require("electron").ipcRenderer.invoke("menu-test-pointer", type, Math.round(x), Math.round(y));
    await nativePointer("mouseMove", 0, 0);
    await settle();
    const nativeRect = followingItems.getBoundingClientRect();
    const nativeX = nativeRect.left + nativeRect.width / 2;
    await nativePointer("mouseMove", nativeX, nativeRect.top + nativeRect.height * .3);
    await settle();
    const nativeY = nativeRect.top + nativeRect.height * .55;
    await nativePointer("mouseMove", nativeX, nativeY);
    await settle();
    check.ok(followingItems.scrollTop > 0, "Real browser mouse movement scrolls the whole menu");
    const nativeHit = document.elementFromPoint(Math.round(nativeX), Math.round(nativeY)).closest<HTMLElement>(".b3-menu__item");
    check.ok(nativeHit.classList.contains("b3-menu__item--current"), "Native hover matches the scrolled target");
    await nativePointer("mouseDown", nativeX, nativeY);
    await nativePointer("mouseUp", nativeX, nativeY);
    check.equal(clicked, Number(nativeHit.textContent.trim().replace("Mouse item ", "")), "Native click selects the visible item");
    dispose(following);

    window.siyuan.storage.menuMouseScroll = true;
    const mouseSubmenus = createMenu();
    mouseSubmenus.addItem({label: "Scrollable children", submenu: Array.from({length: 80}, (_, i) => ({label: `Child ${i}`}))});
    addItems(mouseSubmenus, 50);
    mouseSubmenus.popup({x: 40, y: 40});
    await settle();
    const mouseParent = mouseSubmenus.element.lastElementChild.firstElementChild;
    mouseParent.dispatchEvent(new MouseEvent("mouseover", {bubbles: true}));
    const mouseSubmenu = mouseParent.querySelector<HTMLElement>(".b3-menu__submenu");
    const mouseChildren = mouseSubmenu.lastElementChild as HTMLElement;
    pointer(mouseChildren, .3);
    pointer(mouseChildren, .65);
    check.ok(mouseChildren.scrollTop > 0, "Submenus support movement across their own visible area");
    const mouseRootItems = mouseSubmenus.element.lastElementChild as HTMLElement;
    check.equal(mouseRootItems.scrollTop, 0, "Moving within a submenu leaves its parent stationary");
    pointer(mouseRootItems, .3);
    pointer(mouseRootItems, .65);
    check.ok(mouseRootItems.scrollTop > 0);
    check.equal(mouseParent.classList.contains("b3-menu__item--show"), false, "Scrolling the parent closes its detached submenu");
    dispose(mouseSubmenus);

    const lazyMouse = createMenu();
    for (let i = 0; i < 60; i++) {
        lazyMouse.addItem({label: `Lazy ${i}`, loadSubmenu: async () => [{label: `Loaded ${i}`}]});
    }
    lazyMouse.popup({x: 40, y: 40});
    await settle();
    const lazyItems = lazyMouse.element.lastElementChild as HTMLElement;
    pointer(lazyItems, .3);
    pointer(lazyItems, .6);
    await settle();
    const lazyScroll = lazyItems.scrollTop;
    check.ok(lazyScroll > 0, "Asynchronous submenu loading preserves the parent's scroll position");
    const loadedMenu = lazyItems.querySelector(".b3-menu__item--show > .b3-menu__submenu");
    check.match(loadedMenu.textContent, /Loaded \d+/, "The item under a scrolled pointer loads its asynchronous submenu");
    pointer(lazyItems, .75);
    check.ok(lazyItems.scrollTop > lazyScroll, "Loading a child does not interrupt scrolling of its unchanged parent");
    dispose(lazyMouse);

    const form = createMenu();
    form.addItem({type: "empty", label: '<input class="b3-text-field" style="height:32px"><div style="height:80px;overflow:auto"><div style="height:400px">Custom list</div></div>'});
    addItems(form, 50);
    form.popup({x: 40, y: 40});
    await settle();
    const formItems = form.element.lastElementChild as HTMLElement;
    const input = formItems.querySelector("input");
    input.focus();
    pointer(formItems, .4);
    pointer(formItems, .7);
    check.equal(formItems.scrollTop, 0, "Editing a menu input keeps the form stationary");
    input.blur();
    const customList = input.nextElementSibling as HTMLElement;
    pointer(customList, .2);
    pointer(customList, .7);
    check.equal(formItems.scrollTop, 0, "Nested scrollable widgets keep their own interaction");
    dispose(form);

    const pluginShared = createMenu();
    const followingPlugin = new PluginMenu(undefined, undefined, true);
    for (let i = 0; i < 80; i++) followingPlugin.addItem({label: `Plugin scroll ${i}`});
    followingPlugin.open({x: 40, y: 40});
    await settle();
    const pluginItems = followingPlugin.element.lastElementChild as HTMLElement;
    pointer(pluginItems, .3);
    pointer(pluginItems, .7);
    check.ok(pluginItems.scrollTop > 0, "Independent plugin menus share the same mouse scrolling behavior");
    followingPlugin.close();
    check.equal(followingPlugin.element.isConnected, false);
    dispose(pluginShared);

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
    const sheetItems = sheet.element.lastElementChild as HTMLElement;
    pointer(sheetItems, .3);
    pointer(sheetItems, .7);
    check.equal(sheetItems.scrollTop, 0, "Mobile sheets ignore mouse-follow scrolling even with a saved preference");
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

test("menus adapt to layout changes and optional whole-menu mouse scrolling", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 45000,
}, async () => {
    const sources = Object.fromEntries(["menus/Menu", "menus/menuPosition", "menus/menuMouseScroll", "menus/menuGroup", "menus/sheetOpen",
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
    ipcMain.handle("menu-test-pointer", (event, type, x, y) =>
        event.sender.sendInputEvent({type, x, y, button: "left", clickCount: 1}));
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
