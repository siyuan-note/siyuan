const assert = require("node:assert/strict");
const {mkdtempSync, readFileSync, rmSync, writeFileSync} = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const {test} = require("node:test");
const {ModuleKind, ScriptTarget, transpileModule} = require("typescript");
const sass = require("sass");

const compile = file => transpileModule(readFileSync(path.join(__dirname, file), "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

const checkDialog = async (css, languages, sources, mobile, rtl) => {
    const check = require("node:assert/strict");
    const pause = () => new Promise(resolve => setTimeout(resolve, 180));
    document.head.innerHTML = "<style></style>";
    document.querySelector("style").textContent = css;
    document.body.innerHTML = "";
    document.documentElement.dir = rtl ? "rtl" : "ltr";
    document.body.className = mobile ? "body--android" : "body--windows";
    const menu = document.createElement("div");
    let sequence = 0;
    window.siyuan = {languages, dialogs: [], zIndex: 1, menus: {menu: {element: menu}}, storage: {}};
    const load = (source, dependencies) => {
        const exports = {};
        new Function("exports", "require", source)(exports, name => {
            check.ok(dependencies[name], `missing dependency: ${name}`);
            return dependencies[name];
        });
        return exports;
    };
    const {Dialog} = load(sources.dialog, {
        "../util/genID": {genUUID: () => `import-dialog-${++sequence}`},
        "../util/zIndex": {getZIndex: () => 0, isAbove: () => false},
        "./moveResize": {moveResize() {}}, "../util/functions": {isMobile: () => mobile},
        "../protyle/util/compatibility": {isNotCtrl: () => true}, "../protyle": {},
        "../constants": {Constants: {TIMEOUT_OPENDIALOG: 0, TIMEOUT_DBLCLICK: 0}},
        "../block/panelOwnership": {getDialogBlockPanel: () => undefined, destroyDialogBlockPanels() {}},
        "./anchoredInput": {getAnchoredInputMask: () => undefined},
    });
    const escape = load(sources.escape, {});
    const conflicts = Array.from({length: 40}, (_, index) => `20261030000000-notebook-${index}`);
    conflicts.push("<unsafe-notebook>");
    const requests = [];
    const imported = load(sources.importData, {
        "../dialog": {Dialog}, "../util/escape": escape,
        "../util/functions": {isMobile: () => mobile},
        "../util/contractFormData": {ContractFormData: class {}},
        "../dialog/message": {showMessage: message => check.fail(message)},
        "../util/fetch": {fetchSyncPost: async (url, data) => {
            requests.push({url, data});
            if (url.endsWith("prepareDataImport")) return {code: 0, data: {id: "test-plan", conflicts, encrypted: conflicts}};
            if (url.endsWith("commitDataImport")) return {code: 0, data: {skipped: conflicts}};
            return {code: 0};
        }},
    });
    await imported.importDataFile(new File(["test"], "Data.zip"));
    await pause();
    const dialog = window.siyuan.dialogs.at(-1);
    const password = dialog.element.querySelector('[data-type="password"]');
    const label = dialog.element.querySelector('[data-type="password-label"]');
    check.equal(getComputedStyle(label).display, "none");
    dialog.element.querySelector('[value="overwrite"]').click();
    await pause();
    check.notEqual(getComputedStyle(label).display, "none");
    check.ok(label.textContent.includes(languages.dataImportMasterPassword));
    check.ok(label.textContent.includes(languages.dataImportPasswordTip));
    check.equal(password.required, true);
    check.equal(dialog.element.querySelector('[data-type="import"]').disabled, true);
    const bounds = element => element.getBoundingClientRect();
    const visibleActions = current => {
        const container = current.element.querySelector(".b3-dialog__container");
        const content = current.element.querySelector(".b3-dialog__content");
        const actions = current.element.querySelector(".b3-dialog__action");
        const rect = bounds(container);
        check.ok(rect.top >= -1 && rect.bottom <= innerHeight + 1, `dialog fits viewport: ${rect.top}..${rect.bottom}/${innerHeight}`);
        check.ok(bounds(actions).bottom <= innerHeight + 1, "actions remain in the viewport");
        check.ok(content.scrollWidth <= content.clientWidth + 1, "content has no horizontal overflow");
        // Resize handles extend outside the container; the body owns the scrollbar.
        const body = current.element.querySelector(".b3-dialog__body");
        check.ok(body.scrollWidth <= body.clientWidth + 1, "dialog body has no horizontal overflow");
        for (const button of actions.querySelectorAll("button")) {
            check.ok(bounds(button).top >= bounds(actions).top && bounds(button).bottom <= innerHeight + 1);
        }
        return content;
    };
    const content = visibleActions(dialog);
    const intro = dialog.element.querySelector(".data-import__section");
    const list = dialog.element.querySelector(".data-import__list");
    const mode = dialog.element.querySelector(".data-import__mode");
    const edge = rtl ? "right" : "left";
    for (const element of [list, mode, password]) {
        check.ok(Math.abs(bounds(element)[edge] - bounds(intro)[edge]) < 1, "form sections share the content edge");
    }
    check.ok(list.scrollHeight > list.clientHeight, "long conflict list scrolls independently");
    check.equal(list.tabIndex, 0, "conflict list supports keyboard scrolling");
    check.equal(dialog.element.querySelector("unsafe-notebook"), null);
    check.ok(content.textContent.includes("<unsafe-notebook>"));
    dialog.element.querySelectorAll('input[type="radio"]').forEach(input => input.toggleAttribute("checked", input.checked));
    window.__dataImportLayoutSnapshot = document.documentElement.innerHTML;
    content.scrollTop = content.scrollHeight;
    check.ok(bounds(password).bottom <= bounds(content).bottom + 1, "password remains reachable by scrolling");
    password.value = "secret";
    password.dispatchEvent(new Event("input", {bubbles: true}));
    dialog.element.querySelector('[value="skip"]').click();
    dialog.element.querySelector('[data-type="import"]').click();
    await pause();
    const commit = requests.find(item => item.url.endsWith("commitDataImport"));
    check.equal(commit.data.mode, "skip");
    check.equal(Object.hasOwn(commit.data, "password"), false);
    const completed = window.siyuan.dialogs.at(-1);
    check.notEqual(completed, dialog);
    visibleActions(completed);
    completed.element.querySelector('[data-type="confirm"]').click();
    await pause();
    check.ok(requests.some(item => item.url.endsWith("reloadUI")));
    check.equal(window.siyuan.dialogs.length, 0);
};

if (process.versions.electron && process.type === "browser") {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", process.argv[2]);
    app.whenReady().then(async () => {
        const win = new BrowserWindow({show: false, frame: false, webPreferences: {
            nodeIntegration: true, contextIsolation: false, offscreen: true, backgroundThrottling: false,
        }});
        try {
            const sources = {dialog: compile("../src/dialog/index.ts"), escape: compile("../src/util/escape.ts"),
                importData: compile("../src/menus/importData.ts")};
            for (const name of ["base", "mobile"]) {
                const styles = sass.compile(path.join(__dirname, `../src/assets/scss/${name}.scss`), {logger: sass.Logger.silent}).css;
                for (const theme of ["daylight", "midnight"]) {
                    const css = readFileSync(path.join(__dirname, `../appearance/themes/${theme}/theme.css`), "utf8") + styles;
                    for (const language of ["zh-CN", "ja", "ar"]) {
                        const languages = JSON.parse(readFileSync(path.join(__dirname, `../appearance/langs/${language}.json`), "utf8"));
                        for (const [width, height] of [[900, 500], [375, 600], [375, 300]]) {
                            win.setContentSize(width, height);
                            await win.loadURL("data:text/html,<html><body></body></html>");
                            const result = await win.webContents.executeJavaScript(`(async () => {
                                try { await (${checkDialog.toString()})(${[
                                    css, languages, sources, name === "mobile", language === "ar",
                                ].map(value => JSON.stringify(value)).join(",")}); return ""; }
                                catch (error) { return error.stack; }
                            })()`);
                            assert.equal(result, "", `${name}/${theme}/${language}/${width}x${height}: ${result}`);
                            if (process.env.SIYUAN_DATA_IMPORT_SCREENSHOTS && theme === "daylight" &&
                                ((name === "base" && language === "zh-CN" && width === 900) ||
                                 (name === "mobile" && language === "ja" && height === 300))) {
                                await win.webContents.executeJavaScript("document.documentElement.innerHTML = window.__dataImportLayoutSnapshot");
                                await win.webContents.executeJavaScript("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
                                const screenshot = await win.webContents.capturePage();
                                writeFileSync(path.join(process.env.SIYUAN_DATA_IMPORT_SCREENSHOTS, `${name}-${language}-${width}x${height}.png`), screenshot.toPNG());
                            }
                        }
                    }
                }
            }
            console.log("Data import dialog layouts passed");
            app.exit(0);
        } catch (error) { console.error(error); app.exit(1); }
    });
} else {
    test("Data.zip import dialogs keep password fields and actions reachable on desktop and mobile", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 120000,
    }, async () => {
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-data-import-"));
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 115000});
            assert.match(stdout, /Data import dialog layouts passed/);
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(profile).startsWith("siyuan-data-import-"));
            rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
