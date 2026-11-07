const {test} = require("node:test");
const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");
const {createRequire} = require("node:module");
const {execFile} = require("node:child_process");
const {promisify} = require("node:util");
const root = path.resolve(__dirname, "..");
const fromApp = createRequire(path.join(root, "package.json"));
const ts = fromApp("typescript");
const sass = fromApp("sass");
const compile = value => ts.transpileModule(value, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021}}).outputText;
test("asset menu previews preserve list geometry and pointer selection during image loading", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 45000,
}, async () => {
    const names = ["menus/Menu", "menus/menuPosition", "menus/menuMouseScroll", "menus/menuGroup", "menus/sheetOpen", "menus/sheetActions", "mobile/util/mobileSheetGesture", "mobile/util/keyboardSheetState", "util/setPosition", "protyle/util/hasClosest", "plugin/Menu", "asset/renderAssets", "asset/previewPath"];
    const sources = Object.fromEntries(names.map(name => [name, compile(fs.readFileSync(path.join(root, "src", name + ".ts"), "utf8"))]));
    const menuSource = ts.createSourceFile("protyle.ts", fs.readFileSync(path.join(root, "src/menus/protyle.ts"), "utf8"), ts.ScriptTarget.Latest, true);
    const declarations = ["renderAssetPreview", "renderAssetList", "buildAssetMenu"].map(name => menuSource.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(item => item.name.getText(menuSource) === name)).getText(menuSource)).join("\n");
    const css = sass.compile(path.join(root, "src/assets/scss/base.scss"), {logger: sass.Logger.silent}).css + "\n" + fs.readFileSync(path.join(root, "appearance/themes/daylight/theme.css"), "utf8");

    const browserCases = async ({sources, declarations, css, origin}) => {
        const assert = require("node:assert/strict");
        const {ipcRenderer} = require("electron");
        const modules = {};
        let mobile = false;
        const constants = {TIMEOUT_DBLCLICK: 10, ATTRIBUTE_MENU_KEYMAP: "data-keymap", MENU_BACKGROUND_ASSET: "background-asset", SIYUAN_ASSETS_IMAGE: [".png"], SIYUAN_ASSETS_AUDIO: [".mp3"], SIYUAN_ASSETS_VIDEO: [".mp4"]};
        const externals = {
            "protyle/util/compatibility": {getEventName: () => "click", isInMobileApp: () => mobile, updateHotkeyTip: value => value},
            "util/functions": {isMobile: () => mobile}, "util/zIndex": {isScrollAboveMenu: () => false},
            "layout/getTopBarHeight": {getTopBarHeight: () => 32}, constants: {Constants: constants},
            "protyle/undo": {electronUndo() {}}, "menus/menuKeyboard": {setMenuInputCurrent() {}},
            "plugin/EventBusCore": {forEachPluginSubscriber() {}}, "mobile/util/keyboardToolbar": {activeBlur() {}},
            "block/popoverLifecycle": {setPopoverMenuOpen() {}}, "config/entryVisibility/runtime": {applyMenuEntryVisibility() {}},
            "menus/menuToggle": {}, "util/escape": {escapeAttr: value => String(value ?? ""), escapeHtml: value => String(value ?? "")},
            "util/pathName": {getAssetExtension: value => value.slice(value.lastIndexOf("."))},
            "layout/getAll": {}, dayjs: {}, "asset/html": {}, "util/imageURL": {},
        };
        const load = name => {
            if (Object.hasOwn(externals, name)) return externals[name];
            if (modules[name]) return modules[name].exports;
            assert.ok(sources[name], "Unexpected dependency " + name);
            const module = {exports: {}};
            modules[name] = module;
            new Function("require", "module", "exports", sources[name])(dependency => {
                if (!dependency.startsWith(".")) return load(dependency);
                const parts = name.split("/"); parts.pop();
                for (const part of dependency.split("/")) {
                    if (part === "..") parts.pop(); else if (part !== ".") parts.push(part);
                }
                return load(parts.join("/"));
            }, module, module.exports);
            return module.exports;
        };
        const style = document.createElement("style");
        style.textContent = css + ":root{--b3-font-size:16px;--b3-font-family:Arial;--b3-theme-surface-lighter:#999;--b3-menu-background:#fff;--b3-theme-on-surface:#333;}body{margin:0;}button,input{font:inherit;}";
        document.head.append(style);
        window.siyuan = {zIndex: 0, config: {appearance: {}}, languages: {back: "Back", emptyContent: "Empty"}, menus: {}, storage: {}, mobile: {size: {portrait: {height1: innerHeight}}}};
        const {Menu} = load("menus/Menu");
        const {Menu: PluginMenu} = load("plugin/Menu");
        const {renderAssetsPreview} = load("asset/renderAssets");
        const items = ["portrait-one", "portrait-two", "landscape"].map(name => ({path: origin + "/" + name + ".png", hName: name + ".png"}));
        const build = new Function("Menu", "Constants", "isMobile", "fetchPost", "renderAssetsPreview", "hasClosestByClassName", "hasClosestByAttribute", "upDownHint", "hintRenderAssets", "focusByRange", declarations + "\nreturn buildAssetMenu;")(
            PluginMenu, constants, () => mobile, (_url, _data, callback) => setTimeout(() => callback({data: _data.k === "no results" ? [] : items}), 0), renderAssetsPreview,
            load("protyle/util/hasClosest").hasClosestByClassName, load("protyle/util/hasClosest").hasClosestByAttribute,
            () => null, () => {}, () => {});
        const element = document.createElement("div");
        element.id = "commonMenu"; element.className = "b3-menu fn__none";
        element.innerHTML = '<div class="b3-menu__title fn__none"><span class="b3-menu__label"></span></div><div class="b3-menu__items"></div>';
        document.body.append(element);
        const menu = new Menu(element);
        window.siyuan.menus.menu = menu;
        let clicks = [];
        build({}, {x: 120, y: 570, h: 28, w: 100}, url => clicks.push(url));
        const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
        const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
        const events = [];
        const capture = phase => {
            const preview = element.querySelector("#preview");
            const image = preview?.querySelector("img");
            const list = element.querySelector(".b3-list");
            const bounds = item => item ? {top: item.getBoundingClientRect().top, height: item.getBoundingClientRect().height, bottom: item.getBoundingClientRect().bottom} : null;
            const result = {phase, menu: bounds(element), list: bounds(list), input: bounds(element.querySelector("input")), image: bounds(image), complete: image?.complete, naturalHeight: image?.naturalHeight, rows: Array.from(list?.children || []).map(bounds)};
            events.push(result); return result;
        };
        await sleep(30); await frame();
        capture("initial loading");
        await sleep(220); await frame();
        const initial = capture("initial loaded");
        for (const index of [1, 0, 2, 0]) {
            element.querySelectorAll(".b3-list-item")[index].dispatchEvent(new MouseEvent("mouseover", {bubbles: true}));
            capture("hover loading");
            await frame(); await sleep(180); await frame(); capture("hover loaded");
        }
        for (const entry of events) {
            assert.ok(Math.abs(entry.menu.height - initial.menu.height) < 1, JSON.stringify(entry));
            assert.ok(Math.abs(entry.rows[0].top - initial.rows[0].top) < 1, JSON.stringify(entry));
        }
        const before = element.querySelector("#preview img");
        element.querySelector(".b3-list-item__text").dispatchEvent(new MouseEvent("mouseover", {bubbles: true}));
        assert.equal(element.querySelector("#preview img"), before, "Same resource retains its loaded image");
        const row = element.querySelectorAll(".b3-list-item")[2];
        const rect = row.getBoundingClientRect();
        const x = rect.left + 20, y = rect.top + rect.height / 2;
        await ipcRenderer.invoke("asset-probe-pointer", x, y);
        await sleep(200); await frame();
        assert.equal(document.elementFromPoint(x, y)?.closest(".b3-list-item")?.dataset.value, row.dataset.value);
        await ipcRenderer.invoke("asset-probe-click", x, y);
        await sleep(30);
        assert.deepEqual(clicks, [row.dataset.value]);
        const input = element.querySelector("input");
        input.value = "no results";
        input.dispatchEvent(new InputEvent("input", {bubbles: true}));
        await sleep(100); await frame();
        assert.equal(element.querySelector("#preview").textContent, "Empty");
        assert.ok(Math.abs(element.getBoundingClientRect().height - initial.menu.height) < 1);
        menu.remove();
        await ipcRenderer.invoke("asset-probe-resize", 1000, 400);
        build({}, {x: 20, y: 160, h: 28, w: 100}, () => {});
        await sleep(200); await frame();
        const shortBounds = element.getBoundingClientRect();
        assert.ok(shortBounds.top >= 32 && shortBounds.bottom <= innerHeight);
        assert.ok(element.querySelector("input").getBoundingClientRect().bottom <= shortBounds.bottom);
        menu.remove();
        await ipcRenderer.invoke("asset-probe-resize", 480, 720);
        build({}, {x: 20, y: 160, h: 28, w: 100}, () => {});
        await sleep(250); await frame();
        assert.equal(getComputedStyle(element.querySelector("#preview")).display, "none");
        assert.equal(element.querySelector(".asset-menu--preview"), null);
        return "Asset menu preview geometry and selection passed";

    };

    const source = `const __name = value => value; (${browserCases.toString()})(${JSON.stringify({sources, declarations: compile(declarations.replace(/\/\/\/ #if MOBILE\s*([\s\S]*?)\/\/\/ #else\s*([\s\S]*?)\/\/\/ #endif/g, "$2")), css, origin: "__ORIGIN__"})})`;
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-asset-menu-layout-"));
    const runtime = path.join(temporary, "run.cjs");
    const body = `const {app, BrowserWindow, ipcMain} = require("electron");
    const http = require("node:http");
    app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
    app.commandLine.appendSwitch("disable-gpu");
    app.whenReady().then(async () => {
        const fixtures = {};
        const server = http.createServer((req, res) => {
            setTimeout(() => {
                res.writeHead(200, {"Content-Type": "image/png", "Cache-Control": "no-store"});
                res.end(fixtures[req.url]);
            }, 80);
        });
        await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
        const win = new BrowserWindow({show: false, width: 1000, height: 800, useContentSize: true,
            webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true, backgroundThrottling: false}});
        ipcMain.handle("asset-probe-resize", (_event, w, h) => win.setContentSize(w, h));
        ipcMain.handle("asset-probe-pointer", (event, x, y) =>
            event.sender.sendInputEvent({type: "mouseMove", x: Math.round(x), y: Math.round(y)}));
        ipcMain.handle("asset-probe-click", (event, x, y) => {
            for (const type of ["mouseDown", "mouseUp"]) {
                event.sender.sendInputEvent({type, x: Math.round(x), y: Math.round(y), button: "left", clickCount: 1});
            }
        });
        try {
            await win.loadURL("about:blank");
            const images = await win.webContents.executeJavaScript(\`[
                ["portrait-one", 240, 720], ["portrait-two", 320, 800], ["landscape", 1400, 280]
            ].map(([name, width, height]) => {
                const canvas = document.createElement("canvas");
                canvas.width = width; canvas.height = height;
                canvas.getContext("2d").fillRect(0, 0, width, height);
                return [name, canvas.toDataURL("image/png").split(",")[1]];
            })\`);
            for (const [name, data] of images) fixtures["/" + name + ".png"] = Buffer.from(data, "base64");
            console.log(await win.webContents.executeJavaScript(${JSON.stringify(source)}
                .replace("__ORIGIN__", "http://127.0.0.1:" + server.address().port)));
            win.destroy(); server.close(); app.exit(0);
        } catch (error) {
            console.error(error);
            win.destroy(); server.close(); app.exit(1);
        }
    });`;
    fs.writeFileSync(runtime, body);
    const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(fromApp("electron"), [runtime], {env, timeout: 40000, windowsHide: true, maxBuffer: 1024 * 1024});
        require("node:assert/strict").match(result.stdout, /Asset menu preview geometry and selection passed/);
    } finally {
        require("node:assert/strict").equal(path.dirname(path.resolve(temporary)), path.resolve(os.tmpdir()));
        fs.rmSync(temporary, {recursive: true, force: true});
    }
});
