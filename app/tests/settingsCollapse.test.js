const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const runCases = async sources => {
    const check = require("node:assert/strict");
    window.siyuan = {languages: {expand: "Expand", collapse: "Collapse"}};
    const modules = {};
    const load = id => {
        if (modules[id]) return modules[id];
        const exports = {};
        modules[id] = exports;
        new Function("require", "exports", sources[id])(relative => {
            const target = pathFor(id, relative);
            if (target in sources) return load(target);
            return {};
        }, exports);
        return exports;
    };
    const pathFor = (id, relative) => {
        const parts = id.split("/").slice(0, -1);
        for (const part of relative.split("/")) {
            if (part === "..") parts.pop();
            else if (part !== ".") parts.push(part);
        }
        return parts.join("/");
    };
    const render = load("config/render/render");
    const collapse = load("config/setting/collapse");
    const mount = load("config/setting/mount");
    const group = (id, title) => render.genConfigGroup(
        `<label class="b3-label config-item" data-config-item-id="${id}"><input value="draft"></label>`,
        title, {"data-config-group-id": id});
    const html = group("general", "General") + group("advanced", "Advanced") +
        render.genConfigGroup("Untitled", undefined, {"data-config-group-id": "untitled"});
    render.buildGroupedItemsView = () => ({html, items: []});
    for (const mobile of [false, true]) {
        document.body.innerHTML = `<div class="config__panel"><div class="${mobile ? "config config--mobile" : "config__tab-container"}">${html}</div></div>`;
        const root = document.body.firstElementChild.firstElementChild;
        const other = document.createElement("div");
        other.innerHTML = group("general", "Other tab");
        root.after(other);
        const init = () => collapse.initSettingGroupCollapse(root);
        const button = () => root.querySelector("button");
        const content = () => root.querySelector(".config-items");
        const hidden = () => getComputedStyle(content()).display === "none";
        await mount.mountSettingTab("editor", root);
        collapse.initSettingGroupCollapse(other);
        check.equal(root.querySelectorAll("button").length, 2, "Untitled groups have no toggle");
        check.equal(hidden(), false);
        button().querySelector("use").dispatchEvent(new MouseEvent("click", {bubbles: true}));
        check.equal(hidden(), true, "Clicks on the icon collapse the group");
        check.equal(button().getAttribute("aria-expanded"), "false");
        check.equal(button().getAttribute("aria-label"), "Expand - General");
        check.equal(getComputedStyle(other.querySelector(".config-items")).display === "none", false,
            "Matching group IDs in other tabs stay independent");
        const input = root.querySelector("input");
        input.value = "unsaved";
        button().click();
        check.equal(root.querySelector("input"), input);
        check.equal(input.value, "unsaved", "Toggling preserves control state");
        button().click();
        mount.applySettingTabSearchVisibility(root, new Set(["general"]), new Set(["general"]));
        check.equal(hidden(), false, "Search reveals collapsed matches");
        check.equal(button().disabled, true);
        button().click();
        mount.clearSettingTabSearch(document.body);
        check.equal(hidden(), true, "Clearing search restores the collapse choice");
        await mount.mountSettingTab("editor", root);
        init();
        check.equal(hidden(), true, "Rebuilding a tab retains its collapse choice");
        // 原生键盘输入验证按钮语义与重复初始化后的事件绑定。
        button().focus();
        await require("electron").ipcRenderer.invoke("settings-collapse-key", "Space");
        await new Promise(resolve => setTimeout(resolve, 30));
        check.equal(hidden(), false, "Space expands the focused button");
        check.equal(document.activeElement, button(), "Focus stays on the toggle");
        await require("electron").ipcRenderer.invoke("settings-collapse-key", "Return");
        await new Promise(resolve => setTimeout(resolve, 30));
        check.equal(hidden(), true, "Return collapses the focused button");
    }
    return "Settings collapse passed on desktop and mobile";
};

const runElectron = async () => {
    const {app, BrowserWindow, ipcMain} = require("electron");
    const ts = require("typescript");
    const appRoot = path.join(__dirname, "..");
    const ids = ["config/setting/collapse", "config/setting/mount", "config/render/render", "util/escape"];
    const sources = Object.fromEntries(ids.map(id => [id, ts.transpileModule(
        fs.readFileSync(path.join(appRoot, "src", `${id}.ts`), "utf8"), {
            compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
        }).outputText]));
    const css = require("sass").compile(path.join(appRoot, "src/assets/scss/base.scss"), {
        logger: {warn() {}, debug() {}},
    }).css;
    app.setPath("userData", process.argv[2]);
    app.commandLine.appendSwitch("disable-gpu");
    await app.whenReady();
    const win = new BrowserWindow({show: false, webPreferences: {
        nodeIntegration: true, contextIsolation: false, backgroundThrottling: false, offscreen: true,
    }});
    ipcMain.handle("settings-collapse-key", (_event, keyCode) => {
        win.webContents.sendInputEvent({type: "keyDown", keyCode});
        if (keyCode === "Return") win.webContents.sendInputEvent({type: "char", keyCode: "\r"});
        win.webContents.sendInputEvent({type: "keyUp", keyCode});
    });
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        await win.webContents.insertCSS(css);
        console.log(await win.webContents.executeJavaScript(`(${runCases.toString()})(${JSON.stringify(sources)})`));
    } finally {
        win.destroy();
    }
    app.exit(0);
};

if (process.versions.electron && process.type === "browser") {
    runElectron().catch(error => {
        console.error(error);
        require("electron").app.exit(1);
    });
} else {
    const {test} = require("node:test");
    const {execFile} = require("node:child_process");
    const {promisify} = require("node:util");
    test("settings groups collapse, retain drafts and restore after search and rebuild", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY
            ? "Real Electron DOM verification requires DISPLAY or WAYLAND_DISPLAY" : false,
        timeout: 60000,
    }, async () => {
        const profile = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-settings-collapse-"));
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        try {
            const {stdout} = await promisify(execFile)(require("electron"), [__filename, profile], {
                env, windowsHide: true, timeout: 55000,
            });
            assert.match(stdout, /Settings collapse passed on desktop and mobile/);
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            fs.rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
