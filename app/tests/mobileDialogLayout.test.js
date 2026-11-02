const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const runCases = async appDirectory => {
    const assert = require("node:assert/strict");
    const fs = require("node:fs");
    const path = require("node:path");
    const ts = require(path.join(appDirectory, "node_modules/typescript"));
    const wait = () => new Promise(resolve => setTimeout(resolve, 200));
    let id = 0;
    window.siyuan = {dialogs: [], zIndex: 1, storage: {},
        mobile: {size: {portrait: {height1: innerHeight}, landscape: {height1: innerWidth}}},
        languages: JSON.parse(fs.readFileSync(path.join(appDirectory, "appearance/langs/en.json"), "utf8")),
        menus: {menu: {element: document.createElement("div"), remove() {}}}};
    const overrides = {
        "util/genID": {genUUID: () => String(++id)},
        "util/zIndex": {isAbove: () => false},
        "dialog/moveResize": {moveResize() {}},
        "util/functions": {isMobile: () => true},
        "protyle": {},
        "dialog/message": {showMessage() {}},
        "protyle/util/compatibility": {isNotCtrl: () => true, isInMobileApp: () => false, updateHotkeyTip: value => value},
        "constants": {Constants: {TIMEOUT_OPENDIALOG: 0, TIMEOUT_DBLCLICK: 0}},
    };
    const cache = new Map();
    const load = (name, parent = "") => {
        const key = path.posix.normalize(path.posix.join(parent, name)).replace(/\.ts$/, "");
        if (overrides[key]) return overrides[key];
        if (cache.has(key)) return cache.get(key);
        let file = path.join(appDirectory, "src", key + ".ts");
        let moduleKey = key;
        if (!fs.existsSync(file)) { file = path.join(appDirectory, "src", key, "index.ts"); moduleKey += "/index"; }
        const exports = {};
        cache.set(key, exports);
        const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
            compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
        }).outputText;
        new Function("require", "exports", code)(name => load(name, path.posix.dirname(moduleKey)), exports);
        return exports;
    };
    const {MobileDialog} = load("dialog/mobileDialog");
    const dialog = new MobileDialog({title: "Text", mobileSheet: {expandable: true},
        content: '<div class="b3-dialog__content"><div style="height:1800px">Long content</div></div><div class="b3-dialog__action"><button class="b3-button" data-confirm>Confirm</button></div>'});
    await wait();
    assert.equal(dialog.element.querySelectorAll("[data-type=sheet-expand]").length, 1);
    assert.equal(dialog.element.querySelectorAll("[data-type=sheet-close]").length, 0);
    assert.equal(dialog.element.querySelector(".b3-dialog__close"), null);
    const actions = dialog.element.querySelector(".b3-dialog__action");
    const confirm = dialog.element.querySelector("[data-confirm]");
    const panel = dialog.element.querySelector("[role=dialog]");
    assert.equal(getComputedStyle(actions).display, "flex");
    const before = confirm.getBoundingClientRect();
    assert.ok(before.bottom <= panel.getBoundingClientRect().bottom);
    const content = dialog.element.querySelector(".b3-dialog__content");
    content.scrollTop = 500;
    assert.equal(confirm.getBoundingClientRect().top, before.top);
    dialog.setSheetMode("expanded");
    await wait();
    assert.ok(Math.abs(actions.getBoundingClientRect().bottom - panel.getBoundingClientRect().bottom) < 1);
    dialog.destroy();
    await wait();
    const sheet = new MobileDialog({title: "Panel", content: "Content", mobileSheet: {expandable: true}});
    await wait();
    assert.equal(getComputedStyle(sheet.element.querySelector(".mobile-sheet-actions > div")).display, "flex");
    const expand = sheet.element.querySelector("[data-type=sheet-expand]").getBoundingClientRect();
    assert.equal(sheet.element.querySelector("[data-type=sheet-close]"), null);
    assert.equal(sheet.element.querySelector(".b3-dialog__close"), null);
    assert.ok(expand.height > 0);
    sheet.setSheetMode("expanded");
    await wait();
    assert.ok(Math.abs(sheet.element.querySelector(".mobile-sheet-actions").getBoundingClientRect().bottom -
        sheet.element.querySelector("[role=dialog]").getBoundingClientRect().bottom) < 1);
    sheet.destroy();
    await wait();
    const root = document.createElement("div");
    root.innerHTML = load("asset/pdf/viewerTemplate").getPdfViewerHTML();
    document.body.append(root);
    const password = root.querySelector("#passwordDialog");
    const {openPdfMobileOverlay} = load("asset/pdf/mobileOverlay");
    const overlay = openPdfMobileOverlay(password, () => {});
    await wait();
    const buttonRow = overlay.dialog.element.querySelector(".b3-dialog__action");
    assert.ok(buttonRow);
    assert.equal(buttonRow.previousElementSibling, password);
    assert.equal(overlay.dialog.element.querySelector("#passwordSubmit").textContent, window.siyuan.languages.confirm);
    assert.ok(overlay.dialog.element.querySelector("#password").classList.contains("b3-text-field"));
    overlay.dialog.destroy();
    await overlay.closed;
    assert.equal(password.querySelector(".buttonRow"), buttonRow);
    assert.equal(root.querySelectorAll("#passwordSubmit").length, 1);
    const properties = root.querySelector("#documentPropertiesDialog");
    const propertiesOverlay = openPdfMobileOverlay(properties, () => {});
    await wait();
    assert.equal(propertiesOverlay.dialog.element.querySelector(".b3-dialog__action"), null);
    assert.equal(propertiesOverlay.dialog.element.querySelector("#documentPropertiesClose"), null);
    assert.equal(propertiesOverlay.dialog.element.querySelector(".b3-dialog__close"), null);
    await propertiesOverlay.dialog.requestClose("back");
    await propertiesOverlay.closed;
    assert.equal(properties.querySelectorAll("#documentPropertiesClose").length, 1);
    root.remove();
};

if (process.versions.electron && process.type === "browser") {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", process.argv[2]);
    app.whenReady().then(async () => {
        const win = new BrowserWindow({show: false, width: 390, height: 844,
            webPreferences: {nodeIntegration: true, contextIsolation: false, backgroundThrottling: false, offscreen: true}});
        let code = 0;
        try {
            await win.loadURL("data:text/html,<html><body></body></html>");
            const css = require("sass").compile(path.join(__dirname, "../src/assets/scss/mobile.scss"),
                {logger: {warn() {}, debug() {}}}).css;
            await win.webContents.insertCSS(css);
            await win.webContents.executeJavaScript(`(${runCases.toString()})(${JSON.stringify(path.join(__dirname, ".."))})`);
        } catch (error) { console.error(error); code = 1; }
        finally { win.destroy(); app.exit(code); }
    });
} else {
    const {test} = require("node:test");
    const {execFile} = require("node:child_process");
    const {promisify} = require("node:util");
    test("mobile sheets keep one bottom action bar and restore moved PDF controls", async () => {
        const profile = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-mobile-dialog-"));
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        try { await promisify(execFile)(require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 60000}); }
        finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            fs.rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
