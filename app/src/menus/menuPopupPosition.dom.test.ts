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
        "protyle/util/compatibility": {getEventName: () => "click", isInMobileApp: () => false},
        "util/functions": {isMobile: () => mobile},
        "layout/getTopBarHeight": {getTopBarHeight: () => 32},
        constants: {Constants: {TIMEOUT_DBLCLICK: 10}},
        "protyle/undo": {},
        "util/escape": {escapeAttr: (value: string) => value || ""},
        "menus/menuKeyboard": {},
        "plugin/EventBusCore": {forEachPluginSubscriber() {}},
        "mobile/util/keyboardToolbar": {activeBlur() {}},
        "block/popoverLifecycle": {setPopoverMenuOpen() {}},
        "config/entryVisibility/runtime": {applyMenuEntryVisibility() {}},
    };
    const load = (name: string): any => {
        if (name in externals) {
            return externals[name as keyof typeof externals];
        }
        if (modules[name]) {
            return modules[name].exports;
        }
        check.ok(sources[name], `Unexpected dependency: ${name}`);
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
        .fn__none { display: none !important; }
        .test-menu-right { right: 60px; }
    `;
    document.head.append(style);
    Object.assign(window, {siyuan: {languages: {back: "Back"}, zIndex: 0, storage: {},
        config: {appearance: {}}, mobile: {size: {portrait: {height1: innerHeight}}}, menus: {}}});
    const {Menu}: typeof import("./Menu") = load("menus/Menu");
    const settle = async () => {
        for (let i = 0; i < 3; i++) {
            await new Promise(resolve => requestAnimationFrame(resolve));
        }
    };
    const resize = async (width: number, height: number) => {
        await require("electron").ipcRenderer.invoke("resize-popup-test", width, height);
        await settle();
        check.equal(innerWidth, width);
        check.equal(innerHeight, height);
    };
    const create = () => {
        const element = document.createElement("div");
        element.className = "b3-menu fn__none";
        element.innerHTML = '<div class="b3-menu__title fn__none"><span class="b3-menu__label"></span></div>' +
            '<div class="b3-menu__items"><div style="width:360px;height:40px">Menu content</div></div>';
        document.body.append(element);
        const menu = new Menu(element);
        window.siyuan.menus.menu = menu;
        return menu;
    };
    const dispose = (menu: InstanceType<typeof Menu>) => {
        menu.remove();
        menu.element.remove();
    };
    const anchor = document.createElement("button");
    anchor.style.cssText = "position:fixed;left:620px;top:100px;width:80px;height:30px";
    document.body.append(anchor);
    const evidence: {mode: string, isLeft: boolean, anchored: boolean, widths: number[], expected: number}[] = [];
    for (const anchored of [false, true]) {
        for (const isLeft of [true, false]) {
            const rect = anchor.getBoundingClientRect();
            const options = anchored ? {x: isLeft ? rect.right : rect.left, y: rect.bottom,
                h: rect.height, w: rect.width, isLeft, target: anchor} : {x: 700, y: 130, isLeft};
            const control = create();
            control.popup({...options});
            await settle();
            const expected = control.element.getBoundingClientRect();
            dispose(control);
            for (const mode of ["none", "inline", "css", "after-open"]) {
                const menu = create();
                if (mode === "css") {
                    menu.element.classList.add("test-menu-right");
                } else if (mode === "inline") {
                    menu.element.style.right = "60px";
                }
                menu.popup({...options});
                await settle();
                if (mode === "after-open") {
                    menu.element.style.right = "60px";
                }
                const widths: number[] = [];
                const sample = () => widths.push(menu.element.getBoundingClientRect().width);
                if (mode !== "after-open") {
                    sample();
                }
                for (let i = 0; i < 6; i++) {
                    const item = document.createElement("div");
                    item.style.height = "20px";
                    item.textContent = "Extra item";
                    menu.element.lastElementChild.append(item);
                    await settle();
                    sample();
                    item.remove();
                    await settle();
                    sample();
                }
                window.visualViewport.dispatchEvent(new Event("resize"));
                await settle();
                sample();
                window.visualViewport.dispatchEvent(new Event("scroll"));
                await settle();
                sample();
                for (const width of [760, 920, 854]) {
                    await resize(width, 640);
                    sample();
                }
                evidence.push({mode, isLeft, anchored, widths, expected: expected.width});
                const actual = menu.element.getBoundingClientRect();
                if (widths.every(width => Math.abs(width - expected.width) <= .5)) {
                    check.ok(Math.abs(actual.left - expected.left) <= .5, `${mode}: left anchor restored`);
                    check.ok(Math.abs(actual.top - expected.top) <= .5, `${mode}: top anchor restored`);
                }
                dispose(menu);
            }
        }
    }
    anchor.remove();
    const failed = evidence.filter(row => row.widths.some(width => Math.abs(width - row.expected) > .5));
    check.equal(failed.length, 0, JSON.stringify(failed));

    await resize(360, 640);
    mobile = true;
    const sheet = create();
    sheet.popup({x: 40, y: 60});
    await settle();
    check.ok(sheet.element.classList.contains("b3-menu--sheet"));
    check.equal(sheet.element.style.right, "");
    const sheetBounds = () => {
        const rect = sheet.element.getBoundingClientRect();
        check.equal(rect.left, 0);
        check.equal(rect.right, innerWidth);
    };
    sheetBounds();
    for (let i = 0; i < 3; i++) {
        const item = document.createElement("div");
        item.style.height = "50px";
        sheet.element.lastElementChild.append(item);
        await settle();
        sheetBounds();
        item.remove();
        await settle();
        sheetBounds();
    }
    await resize(420, 700);
    sheetBounds();
    dispose(sheet);
    mobile = false;
    const fullscreen = create();
    fullscreen.fullscreen("all");
    await settle();
    check.ok(fullscreen.element.classList.contains("b3-menu--fullscreen"));
    check.equal(fullscreen.element.style.right, "");
    check.equal(fullscreen.element.getBoundingClientRect().width, innerWidth);
    dispose(fullscreen);
    return "Popup right-offset layout cases passed: " + JSON.stringify(evidence.map(row => ({
        ...row, widths: [...new Set(row.widths)],
    })));
};

test("popup menus release right offsets before measuring both positioning branches", {timeout: 45000}, async () => {
    const sources = Object.fromEntries(["menus/Menu", "menus/menuPosition", "menus/menuMouseScroll", "menus/menuGroup",
        "menus/sheetOpen", "menus/sheetActions", "mobile/util/mobileSheetGesture", "mobile/util/keyboardSheetState",
        "util/setPosition", "util/zIndex", "protyle/util/hasClosest"].map(name => [name,
        transpileModule(readFileSync(path.join(__dirname, "..", name + ".ts"), "utf8"), {
            compilerOptions: {target: ScriptTarget.ES2021, module: ModuleKind.CommonJS},
        }).outputText]));
    const css = compile(path.join(__dirname, "../assets/scss/component/_menu.scss"), {logger: Logger.silent}).css;
    const source = `const __name = value => value; (${browserCases.toString()})(${JSON.stringify(sources)}, ${JSON.stringify(css)})`;
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-popup-position-test-"));
    const script = path.join(temporary, "run.cjs");
    writeFileSync(script, `const {app, BrowserWindow, ipcMain} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, width: 854, height: 640, useContentSize: true,
        webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true, backgroundThrottling: false}});
    ipcMain.handle("resize-popup-test", (_event, width, height) => win.setContentSize(width, height));
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
    const env: NodeJS.ProcessEnv = {...process.env, XDG_CACHE_HOME: path.join(temporary, "cache"),
        XDG_CONFIG_HOME: path.join(temporary, "config"), XDG_DATA_HOME: path.join(temporary, "data")};
    delete env.ELECTRON_RUN_AS_NODE;
    const flags = process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY ?
        ["--no-sandbox", "--ozone-platform=headless", "--ozone-override-screen-size=1200,1000"] : [];
    try {
        const result = await promisify(execFile)(require("electron") as unknown as string, [...flags, script],
            {env, timeout: 40000, windowsHide: true});
        assert.match(result.stdout, /Popup right-offset layout cases passed/);
        console.info(result.stdout.trim());
    } finally {
        rmSync(temporary, {recursive: true, force: true});
    }
});
