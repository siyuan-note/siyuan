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
        const content = () => root.querySelector(".config-items");
        const hidden = () => getComputedStyle(content()).display === "none";
        await mount.mountSettingTab("editor", root);
        check.equal(root.querySelectorAll("button").length, 0, "Settings groups have no collapse toggle");
        check.equal(hidden(), false);
        const input = root.querySelector("input");
        input.value = "unsaved";
        root.querySelector(".config-title").click();
        check.equal(hidden(), false, "Clicking a title keeps its settings visible");
        check.equal(root.querySelector("input"), input);
        mount.applySettingTabSearchVisibility(root, new Set(["general"]), new Set(["general"]));
        check.equal(hidden(), false, "Matching settings stay visible during search");
        check.equal(getComputedStyle(root.querySelector('[data-config-group-id="advanced"]')).display, "none");
        check.equal(input.value, "unsaved", "Searching preserves control state");
        mount.clearSettingTabSearch(document.body);
        check.notEqual(getComputedStyle(root.querySelector('[data-config-group-id="advanced"]')).display, "none");
        check.equal(hidden(), false, "Clearing search keeps groups expanded");
        await mount.mountSettingTab("editor", root);
        check.equal(hidden(), false, "Rebuilding keeps settings expanded");
    }
    return "Settings groups passed on desktop and mobile";
};

const runElectron = async () => {
    const {app, BrowserWindow} = require("electron");
    const ts = require("typescript");
    const appRoot = path.join(__dirname, "..");
    const ids = ["config/setting/mount", "config/render/render", "util/escape"];
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
    test("settings groups stay expanded and preserve search filtering and drafts", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY
            ? "Real Electron DOM verification requires DISPLAY or WAYLAND_DISPLAY" : false,
        timeout: 60000,
    }, async () => {
        const profile = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-settings-groups-"));
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        try {
            const {stdout} = await promisify(execFile)(require("electron"), [__filename, profile], {
                env, windowsHide: true, timeout: 55000,
            });
            assert.match(stdout, /Settings groups passed on desktop and mobile/);
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            fs.rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
