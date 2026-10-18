import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {compile, Logger} from "sass";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const browserCases = async (sources: Record<string, string>, languages: Record<string, string>) => {
    const check: typeof assert = require("node:assert/strict");
    let saves = 0;
    let backs = 0;
    const modules: Record<string, {exports: any}> = {};
    const content = () => '<div class="b3-menu__items"><input class="b3-text-field" value="Draft">' +
        '<div style="height:1600px">Database settings</div></div>';
    const externals = {
        "protyle/util/compatibility": {getEventName: () => "click", isInMobileApp: () => true},
        "util/functions": {isMobile: () => true},
        "util/zIndex": {isScrollAboveMenu: () => true},
        "layout/getTopBarHeight": {getTopBarHeight: () => 0},
        constants: {Constants: {TIMEOUT_DBLCLICK: 10, TIMEOUT_TRANSITION: 0}},
        "protyle/undo": {}, "menus/menuKeyboard": {}, "menus/menuMouseScroll": {},
        "plugin/EventBusCore": {forEachPluginSubscriber() {}},
        "mobile/util/keyboardToolbar": {activeBlur() {}},
        "block/popoverLifecycle": {setPopoverMenuOpen() {}},
        "config/entryVisibility/runtime": {applyMenuEntryVisibility() {}},
        "protyle/render/av/panels/registry": {
            getAVPanelDescriptor: () => ({
                render: (context: {html: string}) => {
                    context.html = '<div class="b3-menu__items"><button class="b3-menu__item" data-type="nobg">' +
                        '<span class="block__icon block__icon--menu-back" data-type="go-config"><svg><use xlink:href="#iconLeft"></use></svg></span>' +
                        '<span class="b3-menu__label ft__center">Fields</span></button>' +
                        '<input class="b3-text-field" value="Draft"><div style="height:1600px">Fields</div></div>';
                    return true;
                },
                bind: (context: {closeCB: () => void}) => { context.closeCB = () => saves++; },
            }),
            dispatchAVPanelAction: (context: {menuElement: HTMLElement}, action: {type: string}) => {
                check.equal(action.type, "go-config");
                backs++;
                context.menuElement.innerHTML = content();
                return "handled";
            },
        },
        "protyle/render/av/panels/drag": {bindAVPanelDrag() {}},
        "protyle/render/av/panels/inputs": {bindAVPanelInputs() {}},
        "protyle/render/av/viewType": {}, "protyle/wysiwyg/transaction": {}, "util/fetch": {},
        "protyle/render/av/automationPosition": {}, "protyle/render/av/select": {}, "protyle/render/av/filter": {},
        "protyle/ui/hideElements": {}, "protyle/render/av/view": {getFieldsByData: (): IAVColumn[] => []},
        "protyle/util/selection": {focusBlock() {}}, "protyle/render/av/row": {},
        "protyle/render/av/groups": {getPageSize: () => ({})},
        "protyle/render/av/color": {applyAVColorPalette() {}, getAVCustomColors: (): string[] => []},
        "protyle/render/av/panelTarget": {}, "protyle/render/av/selectPosition": {},
    };
    const load = (name: string): any => {
        if (name in externals) {
            return externals[name as keyof typeof externals];
        }
        if (modules[name]) {
            return modules[name].exports;
        }
        check.ok(sources[name], `Unexpected sheet dependency: ${name}`);
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
    Object.assign(window, {siyuan: {languages, zIndex: 0, storage: {}, menus: {},
        mobile: {size: {portrait: {height1: innerHeight}, landscape: {height1: innerHeight}}}}});
    const viewport = new EventTarget();
    Object.assign(viewport, {height: innerHeight, offsetTop: 0});
    Object.defineProperty(window, "visualViewport", {configurable: true, value: viewport});
    const settle = async () => {
        await new Promise(resolve => setTimeout(resolve, 180));
        await new Promise(resolve => requestAnimationFrame(resolve));
    };
    const {Menu}: typeof import("./Menu") = load("menus/Menu");
    const {openMenuPanel}: typeof import("../protyle/render/av/openMenuPanel") = load("protyle/render/av/openMenuPanel");
    const common = document.createElement("div");
    common.id = "commonMenu";
    common.className = "b3-menu fn__none";
    common.innerHTML = '<div class="b3-menu__title"><span class="b3-menu__label"></span></div>' +
        '<div class="b3-menu__items"><button class="b3-menu__item">Database</button></div>';
    common.dataset.sheetExpandable = "true";
    document.body.append(common);
    const parent = new Menu(common);
    parent.addItem({label: "A long database property label that needs more than one line", submenu: [{label: "Option"}]});
    window.siyuan.menus.menu = parent;
    parent.fullscreen();
    await settle();
    check.ok(Math.abs(common.getBoundingClientRect().height - innerHeight * .56) < 1);
    (common.lastElementChild.lastElementChild as HTMLElement).click();
    await settle();
    const title = common.firstElementChild;
    const titleLabel = title.querySelector(".b3-menu__label").getBoundingClientRect();
    const titleActions = title.querySelector(".b3-menu__actions").getBoundingClientRect();
    check.ok(titleLabel.right <= titleActions.left);
    check.ok(titleActions.right <= innerWidth);
    common.dispatchEvent(new CustomEvent("click", {detail: "back"}));
    await settle();
    const expand = common.querySelector<HTMLButtonElement>('[data-type="sheet-expand"]');
    expand.click();
    await settle();
    check.ok(Math.abs(common.getBoundingClientRect().height - innerHeight) < 1);
    check.equal(expand.getAttribute("aria-expanded"), "true");
    check.ok(expand.getBoundingClientRect().width > 20);
    expand.click();
    await settle();
    check.ok(Math.abs(common.getBoundingClientRect().height - innerHeight * .56) < 1);

    const block = document.createElement("div");
    block.className = "av";
    block.dataset.nodeId = "block";
    block.dataset.avId = "database";
    block.innerHTML = '<div class="av__views"></div>';
    document.body.append(block);
    const subElement = document.createElement("div");
    subElement.classList.add("fn__none");
    // 数据库面板关闭时不应误判为正在搜索资源。
    const protyle = {toolbar: {subElement}} as unknown as IProtyle;
    openMenuPanel({type: "config", data: {} as IAV, blockElement: block, keepMenuOpen: true, protyle});
    await settle();
    const panel = document.querySelector<HTMLElement>(".av__panel");
    const menu = panel.lastElementChild as HTMLElement;
    const back = menu.querySelector<HTMLButtonElement>('[data-type="sheet-back"]');
    check.equal(back.classList.contains("fn__none"), false);
    check.ok(Math.abs(menu.getBoundingClientRect().height - innerHeight * .56) < 1);
    menu.querySelector<HTMLButtonElement>('[data-type="sheet-expand"]').click();
    await settle();
    check.ok(Math.abs(menu.getBoundingClientRect().height - innerHeight) < 1);
    const input = menu.querySelector("input");
    input.focus();
    input.value = "Changed";
    back.click();
    await settle();
    check.equal(backs, 1);
    check.equal(saves, 0);
    check.equal(panel.isConnected, true);
    check.equal(menu.classList.contains("b3-menu--expanded"), true);
    check.ok(Math.abs(menu.getBoundingClientRect().height - innerHeight) < 1);
    check.equal(menu.querySelector('[data-type="sheet-back"]').classList.contains("fn__none"), true);
    const items = menu.querySelector<HTMLElement>(".b3-menu__items");
    check.ok(items.clientHeight > 200 && items.scrollHeight > items.clientHeight);
    check.equal(common.classList.contains("fn__none"), false);

    Object.assign(viewport, {height: innerHeight - 260, offsetTop: 0});
    viewport.dispatchEvent(new Event("resize"));
    await settle();
    check.ok(Math.abs(menu.getBoundingClientRect().bottom - (innerHeight - 260)) < 1);
    check.ok(Math.abs(menu.getBoundingClientRect().top) < 1);
    Object.assign(viewport, {height: innerHeight});
    viewport.dispatchEvent(new Event("resize"));
    await settle();
    check.ok(Math.abs(menu.getBoundingClientRect().height - innerHeight) < 1);
    const touch = (type: string, y: number) => {
        const event = new Event(type, {bubbles: true, cancelable: true});
        Object.assign(event, {touches: [{clientX: 80, clientY: y}], changedTouches: [{clientX: 80, clientY: y}]});
        menu.firstElementChild.dispatchEvent(event);
    };
    touch("touchstart", 100);
    touch("touchmove", 280);
    touch("touchend", 280);
    await settle();
    check.ok(Math.abs(menu.getBoundingClientRect().height - innerHeight * .56) < 1);
    touch("touchstart", 200);
    touch("touchmove", 60);
    touch("touchend", 60);
    await settle();
    check.ok(Math.abs(menu.getBoundingClientRect().height - innerHeight) < 1);
    await new Promise(resolve => setTimeout(resolve, 310));
    menu.querySelector<HTMLButtonElement>('[data-type="sheet-close"]').click();
    await settle();
    check.equal(saves, 1);
    check.equal(panel.isConnected, false);
    check.equal(common.classList.contains("fn__none"), false);
    common.querySelector<HTMLButtonElement>('[data-type="sheet-close"]').click();
    await settle();
    check.equal(common.classList.contains("fn__none"), true);
    check.equal(common.hasAttribute("data-sheet-expandable"), false);
    check.equal(common.querySelector(".b3-menu__actions"), null);
    parent.append(document.createElement("button"));
    parent.fullscreen();
    await settle();
    check.equal(common.querySelector(".b3-menu__actions"), null);
    parent.remove();
    return "Database sheets passed";
};

test("mobile database sheets expand, preserve navigation and edits, and fit the keyboard viewport", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 30000,
}, async () => {
    const sources = Object.fromEntries(["menus/Menu", "menus/menuGroup", "menus/menuPosition", "menus/sheetOpen", "menus/sheetActions",
        "util/escape", "util/setPosition", "protyle/util/hasClosest", "protyle/render/av/openMenuPanel",
        "protyle/render/av/mobilePanel"].map(name => [name, transpileModule(readFileSync(path.join(__dirname, "..", name + ".ts"), "utf8"), {
        compilerOptions: {target: ScriptTarget.ES2021, module: ModuleKind.CommonJS},
    }).outputText]));
    const css = compile(path.join(__dirname, "../assets/scss/mobile.scss"), {logger: Logger.silent}).css;
    const languages = JSON.parse(readFileSync("appearance/langs/en.json", "utf8"));
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-database-sheet-test-"));
    const script = path.join(temporary, "run.cjs");
    const source = `const __name = value => value; (${browserCases.toString()})(${JSON.stringify(sources)}, ${JSON.stringify(languages)})`;
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, width: 390, height: 844, useContentSize: true,
        webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true}});
    try {
        await win.loadURL("about:blank");
        await win.webContents.insertCSS(${JSON.stringify(css)});
        await win.webContents.insertCSS(require("node:fs").readFileSync(${JSON.stringify(path.resolve("appearance/themes/daylight/theme.css"))}, "utf8"));
        await win.webContents.executeJavaScript(require("node:fs").readFileSync(${JSON.stringify(path.resolve("appearance/icons/litheness/icon.js"))}, "utf8"));
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(source)}));
        win.setContentSize(320, 640);
        await win.loadURL("about:blank");
        await win.webContents.insertCSS(${JSON.stringify(css)});
        await win.webContents.insertCSS(require("node:fs").readFileSync(${JSON.stringify(path.resolve("appearance/themes/midnight/theme.css"))}, "utf8"));
        await win.webContents.insertCSS("body {font-size: 20px; --b3-font-size-editor: 24px;}");
        await win.webContents.executeJavaScript(require("node:fs").readFileSync(${JSON.stringify(path.resolve("appearance/icons/litheness/icon.js"))}, "utf8"));
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
            {env, timeout: 25000, windowsHide: true});
        assert.match(result.stdout, /Database sheets passed/);
    } finally {
        assert.equal(path.dirname(path.resolve(temporary)), path.resolve(tmpdir()));
        assert.ok(path.basename(temporary).startsWith("siyuan-database-sheet-test-"));
        rmSync(temporary, {recursive: true, force: true});
    }
});
