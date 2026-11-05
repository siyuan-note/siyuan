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
        "asset/pdf/pdfjs": {PasswordResponses: {NEED_PASSWORD: 1, INCORRECT_PASSWORD: 2}},
    };
    const cache = new Map();
    const load = (name, parent = "") => {
        const key = path.posix.normalize(path.posix.join(parent, name)).replace(/\.ts$/, "");
        if (overrides[key]) return overrides[key];
        if (cache.has(key)) return cache.get(key);
        let file = path.join(appDirectory, "src", key + ".ts");
        let moduleKey = key;
        if (!fs.existsSync(file)) file = path.join(appDirectory, "src", key + ".js");
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
    window.shortViewportDialogModule = {MobileDialog};
    const dialog = new MobileDialog({title: "Text",
        content: '<div class="b3-dialog__content"><div style="height:1800px">Long content</div></div><div class="b3-dialog__action"><button class="b3-button" data-confirm>Confirm</button></div>'});
    await wait();
    assert.equal(dialog.element.querySelectorAll("[data-type=sheet-expand]").length, 0);
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
    const sheet = new MobileDialog({title: "Panel", content: "Content"});
    await wait();
    assert.equal(sheet.element.querySelector(".mobile-sheet-actions"), null);
    assert.equal(sheet.element.querySelector("[data-type=sheet-expand]"), null);
    assert.equal(sheet.element.querySelector("[data-type=sheet-close]"), null);
    assert.equal(sheet.element.querySelector(".b3-dialog__close"), null);
    assert.equal(sheet.element.querySelector(".b3-dialog__action"), null);
    sheet.setSheetMode("expanded");
    await wait();
    assert.ok(Math.abs(sheet.element.querySelector("[role=dialog]").getBoundingClientRect().height - innerHeight) < 1);
    sheet.destroy();
    await wait();
    const root = document.createElement("div");
    root.className = "pdf-viewer--mobile";
    root.style.height = "500px";
    root.innerHTML = load("asset/pdf/viewerTemplate").getPdfViewerHTML();
    document.body.append(root);
    const backgroundEditor = document.createElement("div");
    backgroundEditor.contentEditable = "true";
    backgroundEditor.textContent = "PDF link in the background editor";
    document.body.append(backgroundEditor);
    backgroundEditor.focus();
    const password = root.querySelector("#passwordDialog");
    const {openPdfMobileOverlay} = load("asset/pdf/mobileOverlay");
    const overlay = openPdfMobileOverlay(password, () => {});
    await wait();
    const buttonRow = overlay.dialog.element.querySelector(".b3-dialog__action");
    assert.ok(buttonRow);
    assert.equal(buttonRow.previousElementSibling, password);
    assert.equal(overlay.dialog.element.querySelector("#passwordSubmit").textContent, window.siyuan.languages.confirm);
    assert.ok(overlay.dialog.element.querySelector("#password").classList.contains("b3-text-field"));
    password.querySelector("input").focus();
    overlay.dialog.destroy();
    await overlay.closed;
    assert.equal(password.querySelector(".buttonRow"), buttonRow);
    assert.equal(root.querySelectorAll("#passwordSubmit").length, 1);
    const {OverlayManager} = load("asset/pdf/overlay_manager");
    const {PasswordPrompt} = load("asset/pdf/password_prompt");
    const prompt = new PasswordPrompt({dialog: password, label: root.querySelector("#passwordText"),
        input: root.querySelector("#password"), submitButton: root.querySelector("#passwordSubmit"),
        cancelButton: root.querySelector("#passwordCancel")}, new OverlayManager());
    let retry;
    let accepted = false;
    await prompt.setUpdateCallback(() => {
        void prompt.setUpdateCallback(() => { accepted = true; }, 2);
        retry = prompt.open();
    }, 1);
    backgroundEditor.focus();
    await prompt.open();
    await wait();
    prompt.input.value = "wrong";
    prompt.input.focus();
    prompt.submitButton.click();
    await retry;
    await wait();
    assert.equal(document.activeElement, prompt.input, "wrong-password retries retain input focus");
    prompt.input.value = "accepted";
    prompt.submitButton.click();
    await prompt.finish();
    assert.equal(accepted, true);
    assert.equal(document.activeElement, root.querySelector("#viewerContainer"),
        "verified PDFs focus the reader after the password sheet is disposed");
    let cancelled = false;
    await prompt.setUpdateCallback(value => { cancelled = value instanceof Error; }, 1);
    await prompt.open();
    await wait();
    prompt.cancelButton.click();
    await prompt.finish();
    assert.equal(cancelled, true);
    assert.equal(document.activeElement, root.querySelector("#viewerContainer"));
    const properties = root.querySelector("#documentPropertiesDialog");
    const propertiesOverlay = openPdfMobileOverlay(properties, () => {});
    await wait();
    assert.equal(propertiesOverlay.dialog.element.querySelector(".b3-dialog__action"), null);
    assert.equal(propertiesOverlay.dialog.element.querySelector("#documentPropertiesClose"), null);
    assert.equal(propertiesOverlay.dialog.element.querySelector(".b3-dialog__close"), null);
    await propertiesOverlay.dialog.requestClose("back");
    await propertiesOverlay.closed;
    assert.equal(document.activeElement, root.querySelector("#viewerContainer"));
    assert.equal(properties.querySelectorAll("#documentPropertiesClose").length, 1);
    const nextInput = document.createElement("input");
    document.body.append(nextInput);
    const replacedOverlay = openPdfMobileOverlay(properties, () => nextInput.focus());
    await wait();
    replacedOverlay.dialog.destroy();
    await replacedOverlay.closed;
    assert.equal(document.activeElement, nextInput, "PDF cleanup preserves focus transferred by the closing callback");
    await prompt.setUpdateCallback(() => {}, 1);
    backgroundEditor.focus();
    await prompt.open();
    await wait();
    password.addEventListener("close", () => nextInput.focus(), {once: true});
    prompt.input.value = "accepted";
    prompt.submitButton.click();
    await prompt.finish();
    assert.equal(document.activeElement, nextInput, "password completion preserves focus acquired by another control");
    await prompt.setUpdateCallback(() => {}, 1);
    await prompt.open();
    await wait();
    root.remove();
    prompt.cancelButton.click();
    await prompt.finish();
    assert.equal(document.activeElement, nextInput, "a removed reader never takes focus from its replacement");
    nextInput.remove();
    backgroundEditor.remove();

    document.documentElement.dataset.frontend = "mobile";
    document.body.className = "body--android";
    const {bindMobileSheetLayout} = load("mobile/util/mobileSheetLayout");
    for (const color of ["rgb(245, 245, 245)", "rgb(30, 30, 30)"]) {
        document.body.style.setProperty("--b3-theme-surface", color);
        for (const withActions of [true, false]) {
            const nativeSheet = new MobileDialog({title: "Sync direction",
                content: `<div class="b3-dialog__content"><div style="height:${withActions ? 80 : 1800}px">Choices</div></div>` +
                    (withActions ? '<div class="b3-dialog__action"><button class="b3-button">Confirm</button></div>' : "")});
            await wait();
            const panel = nativeSheet.element.querySelector(".mobile-sheet-panel");
            const footer = panel.querySelector(".b3-dialog__action");
            for (const mode of ["standard", "expanded"]) {
                for (const inset of [0, 24, 32, 15.75, 0]) {
                    document.documentElement.style.setProperty("--android-navigation-bar-height", `${inset}px`);
                    nativeSheet.setSheetMode(mode);
                    const box = panel.getBoundingClientRect();
                    assert.ok(Math.abs(box.bottom - innerHeight) < 1, "drawer background reaches the viewport bottom");
                    assert.equal(getComputedStyle(panel).backgroundColor, color);
                    if (withActions) {
                        assert.ok(Math.abs(footer.getBoundingClientRect().bottom - (innerHeight - inset)) < 1,
                            "drawer buttons stay above the gesture area without double compensation");
                    } else {
                        assert.equal(footer, null, "content-only drawers never get an empty footer");
                    }
                    assert.equal(getComputedStyle(nativeSheet.element.querySelector(".b3-dialog")).paddingBottom, "0px");
                    if (inset > 0) {
                        assert.equal(document.elementFromPoint(innerWidth / 2, innerHeight - inset / 2), panel,
                            "the gesture area is painted by the drawer rather than the underlying page");
                    }
                }
            }
            nativeSheet.destroy();
            await wait();
        }
        const progress = document.createElement("div");
        progress.className = "sync-checkout";
        progress.style.zIndex = String(++window.siyuan.zIndex);
        progress.innerHTML = '<div class="sync-checkout__panel b3-dialog__loading"><div>Progress</div><div class="sync-checkout__actions"><button class="b3-button">Cancel</button></div></div>';
        document.body.append(progress);
        const panel = progress.firstElementChild;
        const layout = bindMobileSheetLayout(progress, panel, {standalone: true});
        for (const inset of [0, 24, 32, 0]) {
            document.documentElement.style.setProperty("--android-navigation-bar-height", `${inset}px`);
            layout.resize();
            assert.ok(Math.abs(panel.getBoundingClientRect().bottom - innerHeight) < 1,
                "standalone progress sheets also paint to the viewport bottom");
            assert.equal(getComputedStyle(panel).paddingBottom, `${24 + inset}px`, "progress sheets preserve their content padding");
            assert.ok(panel.querySelector("button").getBoundingClientRect().bottom <= innerHeight - inset);
        }
        layout.dispose();
        progress.remove();
    }
    document.documentElement.style.setProperty("--android-navigation-bar-height", "24px");
    assert.equal(getComputedStyle(document.body, "::after").height, "48px", "document gesture fading remains available");
    assert.equal(getComputedStyle(document.body, "::after").pointerEvents, "none");
    document.documentElement.style.removeProperty("--android-navigation-bar-height");
    document.body.style.removeProperty("--b3-theme-surface");
    for (const [frontend, platform] of [["mobile", "ios"], ["browser-mobile", "android"]]) {
        document.documentElement.dataset.frontend = frontend;
        document.body.className = `body--${platform}`;
        document.body.style.setProperty("--mobile-bottom-bar-safe-area", "24px");
        const sheet = new MobileDialog({title: "Other frontend", content: "Content"});
        await wait();
        const panel = sheet.element.querySelector(".mobile-bottom-sheet");
        assert.equal(getComputedStyle(sheet.element.querySelector(".b3-dialog")).paddingBottom, "24px");
        assert.equal(getComputedStyle(panel).paddingBottom, "0px");
        assert.ok(Math.abs(panel.getBoundingClientRect().bottom - (innerHeight - 24)) < 1);
        sheet.destroy();
        await wait();
    }
    document.body.style.removeProperty("--mobile-bottom-bar-safe-area");
};

const runShortViewportCase = async () => {
    const check = require("node:assert/strict");
    const wait = () => new Promise(resolve => setTimeout(resolve, 250));
    const {MobileDialog} = window.shortViewportDialogModule;
    window.siyuan.mobile.size.landscape.height1 = 350;
    window.siyuan.mobile.size.isLandscape = true;
    const dialog = new MobileDialog({title: "Color", content:
        '<div class="b3-dialog__content"><label class="b3-label b3-label--inner">Name<input class="b3-text-field fn__block"></label><div style="height:600px"></div></div>' +
        '<div class="b3-dialog__action"><button class="b3-button">Confirm</button></div>'});
    await new Promise(resolve => setTimeout(resolve, 1250));
    const input = dialog.element.querySelector("input");
    input.focus();
    input.scrollIntoView({block: "nearest"});
    const button = dialog.element.querySelector("button").getBoundingClientRect();
    const field = input.getBoundingClientRect();
    check.ok(button.top >= 0 && button.bottom <= innerHeight, "confirm stays above the landscape keyboard: " +
        JSON.stringify({button, height: innerHeight, panel: dialog.element.querySelector("[role=dialog]").getBoundingClientRect(),
            header: getComputedStyle(dialog.element.querySelector(".b3-dialog__header")).display}));
    check.ok(field.top >= 0 && field.bottom <= button.top, "the current input fits above the action row");
    check.equal(dialog.element.querySelector(".b3-dialog__close"), null);
    dialog.destroy();
    await wait();
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
            const error = await win.webContents.executeJavaScript(`(async () => {
                try { await (${runCases.toString()})(${JSON.stringify(path.join(__dirname, ".."))}); }
                catch (error) { return error.stack; }
            })()`);
            assert.equal(error, undefined);
            win.setContentSize(824, 103);
            const shortError = await win.webContents.executeJavaScript(`(async () => {
                try { await (${runShortViewportCase.toString()})(); }
                catch (error) { return error.stack; }
            })()`);
            assert.equal(shortError, undefined);
            console.log("Mobile dialog layout cases passed");
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
        try {
            const result = await promisify(execFile)(require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 60000});
            assert.match(result.stdout, /Mobile dialog layout cases passed/);
        }
        finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            fs.rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
