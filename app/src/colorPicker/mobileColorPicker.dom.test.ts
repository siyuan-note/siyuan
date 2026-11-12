import * as assert from "node:assert/strict";
import {test} from "node:test";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join, resolve} from "node:path";
import {promisify} from "node:util";
import {compile} from "sass";

const browserCases = async (directory: string, css: string, theme: string) => {
    const check: typeof assert = require("node:assert/strict");
    const fs = require("node:fs");
    const path = require("node:path");
    const ts = require(path.join(directory, "node_modules/typescript"));
    const style = document.createElement("style");
    style.textContent = theme + css;
    document.head.append(style);
    document.documentElement.dataset.frontend = "mobile";
    const sidebar = document.createElement("div"); sidebar.id = "sidebar"; document.body.append(sidebar);
    const languages = {color: "Color", originalValue: "Original", new: "Draft", cancel: "Cancel", confirm: "Confirm"};
    const menu = document.createElement("div"); document.body.append(menu);
    Object.assign(window, {siyuan: {dialogs: [], storage: {}, config: {}, isReady: true, languages, zIndex: 0,
        menus: {menu: {element: menu, remove() {}}},
        mobile: {size: {portrait: {height1: innerHeight}, landscape: {height1: innerHeight}}}}});
    let uuid = 0;
    const overrides = {
        "util/functions": {isMobile: () => true},
        "util/genID": {genUUID: () => String(++uuid)},
        "util/zIndex": {isAbove: () => false, getZIndex: () => 0},
        "dialog/moveResize": {moveResize() {}}, "dialog/message": {showMessage() {}}, "protyle": {},
        "block/panelOwnership": {destroyDialogBlockPanels() {}, getDialogBlockPanel() {}},
        "dialog/anchoredInput": {getAnchoredInputMask() {}},
        "protyle/util/compatibility": {isNotCtrl: () => true, isInMobileApp: () => false},
        "protyle/util/browserCompatibility": {isIOSPlatform: () => false},
        "mobile/util/mobileAppUtil": {callMobileAppShowKeyboard() {}},
        "constants": {Constants: {TIMEOUT_OPENDIALOG: 0, TIMEOUT_DBLCLICK: 0}},
    };
    const modules = new Map();
    const load = (name: string, parent = ""): any => {
        const key = path.posix.normalize(path.posix.join(parent, name));
        if (key in overrides) return overrides[key as keyof typeof overrides];
        if (modules.has(key)) return modules.get(key);
        let file = path.join(directory, "src", key + ".ts");
        let moduleKey = key;
        if (!fs.existsSync(file)) { file = path.join(directory, "src", key, "index.ts"); moduleKey += "/index"; }
        const exports = {}; modules.set(key, exports);
        const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
            compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
        }).outputText;
        new Function("exports", "require", code)(exports, (dependency: string) => load(dependency, path.posix.dirname(moduleKey)));
        return exports;
    };
    const api = load("colorPicker/index");
    const owner = document.createElement("button"); document.body.append(owner);
    const wait = () => new Promise(resolve => setTimeout(resolve, 240));
    const open = () => api.openInternalColorPicker({value: "#123456", ownerElement: owner});
    const current = () => (window as any).siyuan.dialogs.at(-1).element as HTMLElement;
    const handle = open();
    const root = current();
    await wait();
    check.ok(root.classList.contains("mobile-bottom-sheet-dialog"));
    const sheet = root.querySelector<HTMLElement>(".mobile-bottom-sheet");
    check.ok(sheet.querySelector(".b3-menu__title"));
    check.equal(sheet.querySelector(".b3-dialog__close"), null);
    const bounds = sheet.getBoundingClientRect();
    check.ok(bounds.top >= -1 && bounds.bottom <= innerHeight + 1);
    check.ok(Math.abs(bounds.bottom - innerHeight) <= 1, "the color editor is anchored to the viewport bottom");
    const hex = root.querySelector<HTMLInputElement>('input[type="text"]');
    hex.value = "#abcdef"; hex.dispatchEvent(new Event("input", {bubbles: true}));
    root.querySelector<HTMLElement>(".b3-button--cancel").click();
    check.equal((await handle.result).type, "cancel");
    await wait();
    const confirmed = open();
    await wait();
    const edited = current().querySelector<HTMLInputElement>('input[type="text"]');
    edited.value = "#abc"; edited.dispatchEvent(new Event("input", {bubbles: true}));
    current().querySelector<HTMLElement>(".b3-dialog__action .b3-button:not(.b3-button--cancel)").click();
    check.deepEqual(await confirmed.result, {type: "confirm", value: {hex: "#aabbcc", rgb: {r: 170, g: 187, b: 204}}, changed: true});
    await wait();
    const dismissed = open(); await wait();
    current().querySelector<HTMLElement>(".b3-dialog__scrim").click();
    check.deepEqual(await dismissed.result, {type: "cancel", reason: "dismiss"});
};

for (const scheme of ["daylight", "midnight"]) {
    test(`mobile color picker uses the shared bottom sheet and retains confirmation/cancellation in ${scheme}`, {
        timeout: 45000, skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    }, async () => {
        const temporary = mkdtempSync(join(tmpdir(), "siyuan-mobile-color-"));
        const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE;
        try {
            const css = compile("src/assets/scss/mobile.scss", {logger: {warn() {}}}).css;
            const theme = readFileSync(`appearance/themes/${scheme}/theme.css`, "utf8");
            const expression = `const __name=value=>value; (${browserCases.toString()})(${JSON.stringify(resolve("."))},${JSON.stringify(css)},${JSON.stringify(theme)})`;
            const script = join(temporary, "run.cjs");
            writeFileSync(script, `const {app,BrowserWindow}=require("electron");app.setPath("userData",${JSON.stringify(join(temporary, "profile"))});
app.whenReady().then(async()=>{const win=new BrowserWindow({show:false,width:390,height:780,webPreferences:{nodeIntegration:true,contextIsolation:false}});
try{await win.loadURL("about:blank");await win.webContents.executeJavaScript(${JSON.stringify(expression)});app.exit(0);}
catch(error){console.error(error);app.exit(1);}});`);
            await promisify(execFile)(require("electron"), [script], {env, windowsHide: true, timeout: 40000});
        } finally {
            assert.equal(dirname(resolve(temporary)), resolve(tmpdir()));
            rmSync(temporary, {recursive: true, force: true, maxRetries: 5});
        }
    });
}
