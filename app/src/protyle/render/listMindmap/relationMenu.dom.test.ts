import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {promisify} from "node:util";
import test from "node:test";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const browserCases = async (source: string, sources: Record<string, string>, css: string) => {
    const check: typeof assert = require("node:assert/strict");
    check.ok(document.hasFocus(), "hidden renderer receives native focus events");
    let mobile = false;
    const constants = {CUSTOM_SY_LIST_MINDMAP_DATA: "custom-sy-list-mindmap-data",
        TIMEOUT_DBLCLICK: 10, ATTRIBUTE_MENU_KEYMAP: "data-keymap"};
    const externals: Record<string, unknown> = {
        "protyle/util/compatibility": {getEventName: () => "click", isInMobileApp: () => false,
            updateHotkeyTip: (value: string) => value},
        "util/functions": {isMobile: () => mobile},
        "layout/getTopBarHeight": {getTopBarHeight: () => 0},
        constants: {Constants: constants},
        "protyle/undo": {electronUndo() {}},
        "util/escape": {escapeAttr: (value: string) => value || ""},
        "menus/menuKeyboard": {setMenuInputCurrent() {}},
        "plugin/EventBusCore": {forEachPluginSubscriber() {}},
        "mobile/util/keyboardToolbar": {activeBlur() {}},
        "block/popoverLifecycle": {setPopoverMenuOpen() {}},
        "config/entryVisibility/runtime": {applyMenuEntryVisibility() {}},
    };
    const modules: Record<string, {exports: any}> = {};
    const load = (name: string): any => {
        if (name in externals) { return externals[name]; }
        if (modules[name]) { return modules[name].exports; }
        check.ok(sources[name], `Unexpected menu dependency: ${name}`);
        const module = {exports: {}};
        modules[name] = module;
        new Function("require", "module", "exports", sources[name])((dependency: string) => {
            const parts = name.split("/");
            parts.pop();
            dependency.split("/").forEach(part => {
                if (part === "..") { parts.pop(); } else if (part !== ".") { parts.push(part); }
            });
            return load(parts.join("/"));
        }, module, module.exports);
        return module.exports;
    };
    const style = document.createElement("style");
    style.textContent = css + "body{margin:0}.fn__none{display:none!important}";
    document.head.append(style);
    Object.assign(window, {siyuan: {languages: {back: "Back"}, zIndex: 0, storage: {}, config: {appearance: {}},
        mobile: {size: {portrait: {height1: innerHeight}}}, menus: {}}});
    const {Menu: CommonMenu} = load("menus/Menu");
    const {Menu} = load("plugin/Menu");
    const {toggleMenu} = load("menus/menuToggle");
    const api = new Function("Constants", "mathRender", "tabsRender", "destroyTabsRender", source +
        "; return {ListMindmapView, readListMindmap, getMindmapRelationMenuItems};")(
        constants, () => {}, () => {}, () => {});
    const labels = new Proxy({}, {get: (_target, key) => String(key)});
    const settle = async () => {
        for (let i = 0; i < 4; i++) { await new Promise(resolve => requestAnimationFrame(resolve)); }
    };
    const input = async (element: Element, touch = false, hover = false) => {
        await Promise.all(element.closest(".b3-menu")?.getAnimations({subtree: true}).map(animation =>
            animation.finished.catch(() => {})) || []);
        const rect = element.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        check.ok(rect.width && rect.height && element.contains(document.elementFromPoint(x, y)),
            `Input reaches ${element.getAttribute("data-id") || element.getAttribute("aria-label")}; mobile=${mobile}; ` +
            `${JSON.stringify(rect.toJSON())}; hit=${document.elementFromPoint(x, y)?.outerHTML.slice(0, 250)}`);
        await require("electron").ipcRenderer.invoke("mindmap-menu-input", {x, y, touch, hover});
        await settle();
    };
    const lute = Lute.New();
    lute.SetProtyleWYSIWYG(true);
    for (const touch of [false, true]) {
        mobile = touch;
        document.body.className = touch ? "body--android" : "body--windows";
        const element = document.createElement("div");
        element.id = "commonMenu";
        element.className = "b3-menu fn__none";
        element.innerHTML = '<div class="b3-menu__title fn__none"><span class="b3-menu__label"></span></div>' +
            '<div class="b3-menu__items"></div>';
        const scrim = document.createElement("div");
        scrim.id = "commonMenuScrim";
        scrim.className = "b3-menu__scrim fn__none";
        document.body.append(scrim, element);
        const common = new CommonMenu(element);
        window.siyuan.menus.menu = common;
        const holder = document.createElement("div");
        holder.innerHTML = lute.Md2BlockDOM("- Root\n  - Alpha\n  - Middle\n  - Omega\n");
        const model = api.readListMindmap(holder.firstElementChild);
        const relation = {id: "free", from: model.root.children[0].id, to: model.root.children[2].id,
            label: "", pathStyle: "bezier", strokeStyle: "dashed"};
        model.metadata.relations = [relation];
        const host = document.createElement("div");
        host.style.cssText = "width:700px;--mindmap-view-height:400px;--b3-theme-primary:#3576ff";
        document.body.append(host);
        let changes = 0;
        const view = new api.ListMindmapView({host, model, labels, onExit() {},
            onRelationMenu: (anchor: HTMLElement, id: string) => toggleMenu({target: anchor, build: (_menu: unknown, session: any) => {
                check.equal(id, relation.id);
                const menu = new Menu();
                api.getMindmapRelationMenuItems(relation, (patch: object) => {
                    changes++;
                    Object.assign(relation, patch);
                    view.update(model);
                }, labels).forEach((item: IMenu) => menu.addItem(item));
                const rect = anchor.getBoundingClientRect();
                session.show(() => touch ? menu.fullscreen("bottom") : menu.open({x: rect.left, y: rect.bottom}));
            }}),
        });
        await settle();
        const select = () => {
            view.selectedId = undefined;
            view.selectedRelation = relation.id;
            view.inspector.hidden = false;
            view.updateSelection();
            view.renderInspector();
            view.draw();
        };
        const appearance = () => host.querySelector<HTMLElement>('[aria-label="listMindmapRelationAppearance"]');
        const selected = (stage: string) => {
            check.equal(view.selectedRelation, relation.id, `${stage}: relation stays selected (${touch})`);
            check.equal(view.inspector.hidden, false, `${stage}: inspector stays open (${touch})`);
            check.equal(view.interactionActive, true, `${stage}: map remains active (${touch})`);
            check.equal(getComputedStyle(view.inspector).visibility, "visible", stage);
            check.ok(host.querySelectorAll(".mindmap-view__route-handle").length >= 2, stage);
        };
        select();
        for (const [group, value] of [["relationPath", "straight"], ["relationStroke", "dotted"],
            ["relationPath", "rounded"], ["relationPath", "bezier"]]) {
            await input(appearance(), touch);
            selected("menu open");
            check.equal(common.data, appearance());
            await input(element.querySelector(`[data-id="${group}"]`), touch, !touch);
            selected("submenu open");
            const item = element.querySelector<HTMLElement>(`[data-id="${value}"]`);
            appearance().focus();
            item.focus();
            selected("menu focus transfer");
            await input(item, touch);
            selected("menu choice");
            check.equal(relation[group === "relationPath" ? "pathStyle" : "strokeStyle"], value);
            check.ok(element.classList.contains("fn__none"), "choice closes the menu");
        }
        check.equal(changes, 4, "each native pointer choice saves once");
        if (!touch) {
            await input(appearance());
            await input(appearance());
            selected("trigger toggles menu closed");
            check.ok(element.classList.contains("fn__none"));
        }
        await input(appearance(), touch);
        common.remove();
        selected("menu dismissal");
        const outside = document.createElement("button");
        outside.textContent = "Outside";
        outside.style.cssText = "position:absolute;left:20px;top:500px";
        document.body.append(outside);
        appearance().focus();
        outside.focus();
        check.equal(view.interactionActive, false, "focus leaving the map deactivates it");
        check.equal(view.inspector.hidden, true, "focus leaving the map hides its inspector");
        select();
        await input(appearance(), touch);
        appearance().focus();
        element.querySelector<HTMLElement>('[data-id="relationPath"]').focus();
        selected("menu focus transfer before leaving");
        check.equal(document.activeElement, element.querySelector('[data-id="relationPath"]'), "menu control receives DOM focus");
        check.ok(view.isOwnedMenuTarget(document.activeElement), "focused menu retains live ownership");
        outside.focus();
        check.equal(document.activeElement, outside, "outside control receives DOM focus");
        check.equal(view.interactionActive, false, "focus leaving the owned menu deactivates the map");
        check.equal(view.inspector.hidden, true, "focus leaving the owned menu hides its inspector");
        common.remove();
        select();
        await input(outside, touch);
        check.equal(view.selectedRelation, undefined, "outside input still clears selection");
        if (touch) {
            select();
            await input(appearance(), true);
            await input(scrim, true);
            check.equal(view.selectedRelation, undefined, "sheet scrim clears selection");
            common.remove();
        }
        const nestedHost = document.createElement("div");
        nestedHost.className = "mindmap-view";
        const nestedAnchor = document.createElement("button");
        nestedHost.append(nestedAnchor);
        host.append(nestedHost);
        for (const owner of [outside, nestedAnchor]) {
            select();
            toggleMenu({target: owner, build: (_menu: unknown, session: any) => {
                const menu = new Menu();
                menu.addItem({id: "unrelated", label: "Unrelated", click() {}});
                session.show(() => touch ? menu.fullscreen("bottom") : menu.open({x: 40, y: 450}));
            }});
            await settle();
            await input(element.querySelector('[data-id="unrelated"]'), touch);
            check.equal(view.selectedRelation, undefined, "another owner's menu clears this map selection");
            common.remove();
        }
        nestedHost.remove();
        select();
        common.data = appearance();
        element.dispatchEvent(new PointerEvent("pointerdown", {bubbles: true}));
        check.equal(view.selectedRelation, undefined, "hidden menus cannot retain stale ownership");
        view.destroy();
        host.remove();
        outside.remove();
        element.remove();
        scrim.remove();
    }
    return "mindmap-menu-pointer-ok";
};

test("relationship menus preserve selection through native mouse and touch choices but dismiss outside their owner", {
    timeout: 45000,
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
}, async () => {
    const compile = (file: string) => transpileModule(readFileSync(path.join(__dirname, file), "utf8")
        .replace(/^import [\s\S]*?;\r?\n/gm, "").replace(/^export /gm, ""), {
        compilerOptions: {target: ScriptTarget.ES2021},
    }).outputText;
    const source = ["../../wysiwyg/listContext.ts", "summary.ts", "connectors.ts", "appearance.ts", "relationGeometry.ts", "model.ts",
        "fold.ts", "routing.ts", "pan.ts", "../av/richTextValue.ts", "view.ts", "relationMenu.ts"].map(compile).join("\n");
    const sources = Object.fromEntries(["menus/Menu", "plugin/Menu", "menus/menuToggle", "menus/overlayOwnership",
        "menus/menuPosition", "menus/menuMouseScroll", "menus/menuGroup", "menus/sheetOpen", "menus/sheetActions",
        "mobile/util/mobileSheetGesture", "mobile/util/keyboardSheetState", "util/setPosition", "util/zIndex",
        "protyle/util/hasClosest"].map(name => [name,
        transpileModule(readFileSync(path.join(__dirname, "../../..", name + ".ts"), "utf8"), {
            compilerOptions: {target: ScriptTarget.ES2021, module: ModuleKind.CommonJS},
        }).outputText]));
    const css = require("sass").compile(path.resolve(__dirname, "../../../assets/scss/base.scss"), {
        logger: require("sass").Logger.silent,
    }).css + readFileSync(path.resolve(__dirname, "../../../../appearance/themes/daylight/theme.css"), "utf8");
    const directory = mkdtempSync(path.join(tmpdir(), "siyuan-relation-menu-"));
    const script = path.join(directory, "run.cjs");
    const browserSource = transpileModule(`(${browserCases.toString()})`, {compilerOptions: {target: ScriptTarget.ES2021}})
        .outputText.trim().replace(/^"use strict";\s*/, "").replace(/;$/, "");
    writeFileSync(script, `const {app, BrowserWindow, ipcMain} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(directory, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, width: 900, height: 800,
        webPreferences: {nodeIntegration: true, contextIsolation: false, backgroundThrottling: false, offscreen: true}});
    win.webContents.debugger.attach("1.3");
    ipcMain.handle("mindmap-menu-input", async (_event, {x, y, touch, hover}) => {
        win.webContents.focus();
        if (touch) {
            await win.webContents.debugger.sendCommand("Emulation.setTouchEmulationEnabled", {enabled: true});
            try {
                await win.webContents.debugger.sendCommand("Input.dispatchTouchEvent", {type: "touchStart", touchPoints: [{x, y}]});
                await win.webContents.debugger.sendCommand("Input.dispatchTouchEvent", {type: "touchEnd", touchPoints: []});
            } finally {
                await win.webContents.debugger.sendCommand("Emulation.setTouchEmulationEnabled", {enabled: false});
            }
        } else {
            for (const type of hover ? ["mouseMove"] : ["mouseMove", "mouseDown", "mouseUp"]) {
                win.webContents.sendInputEvent({type, x: Math.round(x), y: Math.round(y), button: "left", clickCount: 1});
            }
        }
    });
    try {
        await win.loadURL("about:blank");
        await win.webContents.debugger.sendCommand("Emulation.setFocusEmulationEnabled", {enabled: true});
        await win.webContents.executeJavaScript(require("fs").readFileSync(${JSON.stringify(path.resolve("stage/protyle/js/lute/lute.min.js"))}, "utf8"));
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(
        `const __name = value => value; (${browserSource})(${JSON.stringify(source)}, ${JSON.stringify(sources)}, ${JSON.stringify(css)})`)}));
        win.destroy(); app.exit(0);
    } catch (error) { console.error(error); win.destroy(); app.exit(1); }
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron") as string, [script], {env, windowsHide: true, timeout: 43000});
        assert.match(result.stdout, /mindmap-menu-pointer-ok/);
    } finally {
        assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
        assert.ok(path.basename(directory).startsWith("siyuan-relation-menu-"));
        rmSync(directory, {recursive: true, force: true});
    }
});