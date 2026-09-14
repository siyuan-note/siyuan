const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const runCases = async (source) => {
    const assert = require("node:assert/strict");
    const tick = () => new Promise(resolve => setTimeout(resolve, 20));
    let id = 0;
    window.siyuan = {dialogs: [], zIndex: 1, menus: {menu: {element: document.createElement("div"), remove() {}}}};
    const modules = {
        "../util/genID": {genUUID: () => String(++id)},
        "../util/zIndex": {isAbove: () => false},
        "./moveResize": {moveResize() {}},
        "../util/functions": {isMobile: () => false},
        "../protyle/util/compatibility": {isNotCtrl: () => true},
        "../constants": {Constants: {TIMEOUT_OPENDIALOG: 0, TIMEOUT_DBLCLICK: 0}},
    };
    const exports = {};
    new Function("require", "exports", source)(name => {
        assert.ok(name in modules, name);
        return modules[name];
    }, exports);
    const {Dialog} = exports;
    const trigger = document.createElement("button");
    trigger.textContent = "Open";
    document.body.append(trigger);
    const open = (options = {}) => {
        const dialog = new Dialog({content: "<input>", ...options});
        dialog.element.querySelector("input").focus();
        return dialog;
    };
    trigger.focus();
    let dialog = open();
    dialog.destroy();
    await tick();
    assert.equal(document.activeElement, trigger);

    const parent = open();
    const parentInput = document.activeElement;
    const child = open();
    child.destroy();
    await tick();
    assert.equal(document.activeElement, parentInput);
    parent.destroy();
    await tick();
    assert.equal(document.activeElement, trigger);

    const other = document.createElement("button");
    document.body.append(other);
    dialog = open({destroyCallback: () => other.focus()});
    dialog.destroy();
    await tick();
    assert.equal(document.activeElement, other);

    trigger.focus();
    dialog = open();
    dialog.destroy();
    other.focus();
    await tick();
    assert.equal(document.activeElement, other);

    trigger.focus();
    const lower = open();
    const upper = open();
    const upperInput = document.activeElement;
    lower.destroy();
    await tick();
    assert.equal(document.activeElement, upperInput);
    upper.destroy();
    await tick();
    assert.equal(document.activeElement, document.body);

    for (const unavailable of ["hidden", "disabled", "removed"]) {
        trigger.hidden = false;
        trigger.disabled = false;
        document.body.append(trigger);
        trigger.focus();
        dialog = open();
        if (unavailable === "removed") {
            trigger.remove();
        } else {
            trigger[unavailable] = true;
        }
        dialog.destroy();
        await tick();
        assert.equal(document.activeElement, document.body);
    }

    const editor = document.createElement("div");
    editor.contentEditable = "true";
    editor.textContent = "Editor content";
    document.body.append(editor);
    editor.focus();
    const range = document.createRange();
    range.setStart(editor.firstChild, 3);
    range.collapse(true);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
    let callbacks = 0;
    dialog = open({destroyCallback: () => callbacks++});
    dialog.destroy();
    dialog.destroy();
    await tick();
    assert.equal(callbacks, 1);
    assert.equal(document.activeElement, editor);
    assert.equal(window.getSelection().anchorOffset, 3);
    assert.equal(window.siyuan.dialogs.length, 0);
};

if (process.versions.electron && process.type === "browser") {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", process.argv[2]);
    app.whenReady().then(async () => {
        const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false}});
        let code = 0;
        try {
            await win.loadURL("data:text/html,<html><body></body></html>");
            win.webContents.debugger.attach("1.3");
            await win.webContents.debugger.sendCommand("Emulation.setFocusEmulationEnabled", {enabled: true});
            const ts = require("typescript");
            const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, "../src/dialog/index.ts"), "utf8"), {
                compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
            }).outputText;
            await win.webContents.executeJavaScript(`(${runCases.toString()})(${JSON.stringify(source)})`);
        } catch (error) {
            console.error(error);
            code = 1;
        } finally {
            win.destroy();
            app.exit(code);
        }
    });
} else {
    const {test} = require("node:test");
    const {execFile} = require("node:child_process");
    const {promisify} = require("node:util");
    test("dialog focus restoration respects callbacks, nested dialogs and unavailable targets", async () => {
        const profile = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-dialog-focus-"));
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        try {
            await promisify(execFile)(require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 30000});
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            fs.rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
