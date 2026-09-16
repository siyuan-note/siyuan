const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const runCases = async (appDirectory, mode, capture) => {
    const assert = require("node:assert/strict");
    const fs = require("node:fs");
    const path = require("node:path");
    const ts = require(path.join(appDirectory, "node_modules/typescript"));
    const tick = () => new Promise(resolve => setTimeout(resolve, 30));
    const mobile = mode === "mobile";
    const viewport = new EventTarget();
    viewport.height = window.innerHeight;
    viewport.offsetTop = 0;
    if (mobile) {
        Object.defineProperty(window, "visualViewport", {value: viewport, configurable: true});
    }
    const requests = [];
    const opened = [];
    const messages = [];
    const original = "---\r\nname: Display Name\r\ndescription: Review notes\r\n---\r\nOriginal\r\n";
    let stored = original;
    let conflict = false;
    let id = 0;
    const entries = [
        {path: "directory-id", isDir: true, editable: false},
        {path: "directory-id/SKILL.md", isDir: false, editable: true},
        {path: "directory-id/resources", isDir: true, editable: false},
        {path: "directory-id/resources/notes.md", isDir: false, editable: true},
        {path: "directory-id/image.png", isDir: false, editable: false},
        ...Array.from({length: 40}, (_, index) => ({path: `extra-${index}`, isDir: true, editable: false})),
    ];
    window.siyuan = {
        dialogs: [], zIndex: 1, storage: {},
        languages: JSON.parse(fs.readFileSync(path.join(appDirectory, "appearance/langs/en.json"), "utf8")),
        config: {system: {dataDir: "D:/workspace/data"}},
        menus: {menu: {element: document.createElement("div"), remove() {}}},
    };
    const overrides = {
        "util/genID": {genUUID: () => String(++id)},
        "util/zIndex": {isAbove: () => false},
        "dialog/moveResize": {moveResize() {}},
        "util/functions": {isMobile: () => mobile, isBrowser: () => mode === "browser"},
        "util/hostCapabilities": {getHostCapabilities: () => ({localFileSystem: mode !== "remote"})},
        "protyle/util/compatibility": {isNotCtrl: () => true},
        "constants": {Constants: {TIMEOUT_OPENDIALOG: 0, TIMEOUT_DBLCLICK: 0, DIALOG_CONFIRM: "confirm"}},
        "editor/util": {openBy: (...args) => opened.push(args)},
        "editor/rename": {replaceFileName: value => value.replace(/\//g, "\uff0f")},
        "dialog/message": {showMessage: (...args) => messages.push(args)},
        "util/fetch": {fetchSyncPost: async (url, request) => {
            assert.equal(url, "/api/ai/agent/manageSkills");
            requests.push({...request});
            await tick();
            if (request.action === "list") {
                return {code: 0, data: {entries}};
            }
            if (request.action === "read") {
                const entry = entries.find(item => item.path === request.path);
                assert.ok(entry, request.path);
                return {code: 0, data: {
                    revision: "revision-1",
                    ...(entry.editable ? {content: request.path.endsWith("SKILL.md") ? stored : "Resource text"} : {}),
                }};
            }
            if (request.action === "write") {
                if (conflict) {
                    return {code: -1, msg: "File changed", data: null};
                }
                stored = request.content;
                return {code: 0, data: {revision: "revision-2"}};
            }
            throw new Error(`Unexpected action: ${request.action}`);
        }},
    };
    const cache = new Map();
    const load = (name, parent = "") => {
        const key = path.posix.normalize(path.posix.join(parent, name)).replace(/\.ts$/, "");
        if (overrides[key]) {
            return overrides[key];
        }
        if (cache.has(key)) {
            return cache.get(key);
        }
        const sourceRoot = path.join(appDirectory, "src");
        let file = path.join(sourceRoot, key + ".ts");
        let moduleKey = key;
        if (!fs.existsSync(file)) {
            file = path.join(sourceRoot, key, "index.ts");
            moduleKey += "/index";
        }
        assert.ok(path.resolve(file).startsWith(path.resolve(sourceRoot) + path.sep));
        const output = ts.transpileModule(fs.readFileSync(file, "utf8"), {
            compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
        }).outputText;
        const exports = {};
        cache.set(key, exports);
        new Function("require", "exports", output)(dependency => load(dependency, path.posix.dirname(moduleKey)), exports);
        return exports;
    };
    load("ai/skills/manager").openSkillManager();
    await tick();
    await tick();
    const dialog = window.siyuan.dialogs[0];
    const manager = dialog.element.querySelector(".skill-manager");
    assert.ok(manager);
    await new Promise(resolve => setTimeout(resolve, 180));
    assert.equal(dialog.element.classList.contains("mobile-bottom-sheet-dialog"), mobile);
    const container = dialog.element.querySelector(".b3-dialog__container");
    if (mobile) {
        const bounds = container.getBoundingClientRect();
        assert.ok(bounds.top > 0, "the mobile sheet leaves space above its handle");
        assert.ok(bounds.bottom <= window.innerHeight + 1, "the mobile sheet fits in the viewport");
        assert.equal(getComputedStyle(manager.querySelector(".skill-manager__editor")).display, "none");
    }
    assert.equal(Boolean(manager.querySelector('[data-action="open"]')), mode === "desktop");
    if (capture) {
        await require("electron").ipcRenderer.invoke("skill-manager-capture", `${mode}-${window.innerWidth}-list`);
    }
    const button = action => manager.querySelector(`[data-action="${action}"]`);
    assert.equal(getComputedStyle(button("back")).display === "none", !mobile);
    const choose = async file => {
        const row = Array.from(manager.querySelectorAll("li[data-path]")).find(item => item.dataset.path === file);
        assert.ok(row, file);
        row.querySelector(".skill-manager__file").click();
        await tick();
        await tick();
    };
    await choose("directory-id");
    const files = manager.querySelector(".skill-manager__files");
    files.scrollTop = 35;
    const previousScroll = files.scrollTop;
    assert.ok(previousScroll > 0, "the file list scrolls independently");
    await choose("directory-id/SKILL.md");
    const source = manager.querySelector(".skill-manager__source");
    assert.equal(source.value, original.replace(/\r\n/g, "\n"));
    assert.ok(source.getBoundingClientRect().height > 120, "the source editor has usable height");
    if (mobile) {
        assert.equal(getComputedStyle(manager.querySelector(".skill-manager__sidebar")).display, "none");
        viewport.height = 360;
        viewport.dispatchEvent(new Event("resize"));
        await tick();
        const bounds = container.getBoundingClientRect();
        assert.ok(bounds.bottom <= 361, "the drawer stays above the keyboard");
        assert.ok(source.getBoundingClientRect().height > 60, "the keyboard leaves usable source space");
        assert.ok(button("save").getBoundingClientRect().bottom <= bounds.bottom, "save stays within the drawer");
        viewport.height = window.innerHeight;
        viewport.dispatchEvent(new Event("resize"));
        await tick();
    }
    if (capture) {
        await require("electron").ipcRenderer.invoke("skill-manager-capture", `${mode}-${window.innerWidth}-editor`);
    }
    assert.equal(button("rename").disabled, true);
    assert.equal(button("remove").disabled, true);
    const setSource = text => {
        source.value = text;
        source.dispatchEvent(new Event("input", {bubbles: true}));
    };
    const edited = source.value.replace("Original", "Updated");
    setSource(edited);
    button("save").click();
    await tick();
    await tick();
    const write = requests.find(request => request.action === "write");
    assert.equal(write.path, "directory-id/SKILL.md");
    assert.equal(write.revision, "revision-1");
    assert.equal(write.content, edited.replace(/\n/g, "\r\n"));
    assert.equal(button("save").disabled, true);

    conflict = true;
    setSource(edited + "Unsaved");
    button("save").click();
    await tick();
    await tick();
    assert.equal(source.value, edited + "Unsaved");
    assert.equal(button("save").disabled, false);

    const cancelConfirm = async () => {
        const prompt = window.siyuan.dialogs[window.siyuan.dialogs.length - 1];
        assert.notEqual(prompt, dialog);
        assert.equal(prompt.element.classList.contains("mobile-bottom-sheet-dialog"), mobile);
        prompt.element.querySelector('[data-action="cancel"]').click();
        await tick();
    };
    const acceptConfirm = async () => {
        const prompt = window.siyuan.dialogs[window.siyuan.dialogs.length - 1];
        assert.notEqual(prompt, dialog);
        prompt.element.querySelector('[data-action="confirm"]').click();
        await tick();
        await tick();
    };
    if (mobile) {
        assert.equal(manager.classList.contains("skill-manager--editing"), true);
        button("back").click();
        await cancelConfirm();
        assert.equal(manager.classList.contains("skill-manager--editing"), true);
        assert.equal(source.value, edited + "Unsaved");
        button("back").click();
        await acceptConfirm();
        assert.equal(manager.classList.contains("skill-manager--editing"), false);
        assert.equal(source.value, edited);
        assert.equal(files.scrollTop, previousScroll);
        await choose("directory-id/SKILL.md");
        setSource(edited + "Unsaved");
    }
    dialog.destroy();
    await cancelConfirm();
    assert.ok(dialog.element.isConnected);
    assert.equal(source.value, edited + "Unsaved");
    dialog.destroy();
    await acceptConfirm();
    assert.equal(dialog.element.isConnected, false);
    assert.equal(window.siyuan.dialogs.length, 0);

    load("ai/skills/manager").openSkillManager();
    await tick();
    await tick();
    const next = window.siyuan.dialogs[0];
    const nextManager = next.element.querySelector(".skill-manager");
    nextManager.querySelector('[data-path="directory-id"] .skill-manager__file').click();
    await tick();
    await tick();
    nextManager.querySelector('[data-path="directory-id/image.png"] .skill-manager__file').click();
    await tick();
    await tick();
    assert.equal(nextManager.querySelector('[data-action="save"]').disabled, true);
    assert.equal(nextManager.querySelector('[data-action="rename"]').disabled, true);
    assert.equal(nextManager.querySelector('[data-action="remove"]').disabled, true);
    if (mode === "desktop") {
        nextManager.querySelector('[data-action="open"]').click();
        assert.equal(opened[0][0], "D:/workspace/data/storage/ai/agent/skills/directory-id/image.png");
    }
    nextManager.querySelector('[data-action="newSkill"]').click();
    await tick();
    const prompt = window.siyuan.dialogs[window.siyuan.dialogs.length - 1];
    assert.notEqual(prompt, next);
    assert.equal(prompt.element.classList.contains("mobile-bottom-sheet-dialog"), mobile);
    prompt.element.querySelector("[data-input-cancel]").click();
    await tick();
    next.destroy();
    await tick();
    assert.equal(window.siyuan.dialogs.length, 0);
};

if (process.versions.electron && process.type === "browser") {
    const {app, BrowserWindow, ipcMain} = require("electron");
    app.setPath("userData", process.argv[2]);
    app.whenReady().then(async () => {
        const win = new BrowserWindow({show: false, webPreferences: {
            nodeIntegration: true, contextIsolation: false, backgroundThrottling: false, offscreen: true,
        }});
        let code = 0;
        try {
            const captureDirectory = process.env.SIYUAN_SKILL_MANAGER_CAPTURE_DIR;
            if (captureDirectory) {
                fs.mkdirSync(captureDirectory, {recursive: true});
                ipcMain.handle("skill-manager-capture", async (_event, stage) => {
                    assert.match(stage, /^[a-z]+-\d+-(list|editor)$/);
                    await new Promise(resolve => setTimeout(resolve, 200));
                    const screenshot = await win.webContents.capturePage();
                    fs.writeFileSync(path.join(captureDirectory, `${stage}.png`), screenshot.toPNG());
                });
            }
            const sass = require("sass");
            const styles = {};
            for (const name of ["base", "mobile"]) {
                styles[name] = sass.compile(path.join(__dirname, `../src/assets/scss/${name}.scss`), {
                    logger: {warn() {}, debug() {}},
                }).css;
            }
            for (const [mode, width, height] of [["desktop", 1100, 844], ["browser", 1100, 844],
                ["remote", 1100, 844], ["mobile", 390, 844], ["mobile", 320, 640]]) {
                win.setContentSize(width, height);
                await win.loadURL("data:text/html,<html><body></body></html>");
                await win.webContents.insertCSS(styles[mode === "mobile" ? "mobile" : "base"] +
                    ":root {--b3-font-size: 16px; --b3-font-family: sans-serif; --b3-font-family-code: monospace; --mobile-top-safe-area: 0px; --b3-theme-surface: #f6f6f6; --b3-theme-background: #fff; --b3-theme-on-background: #222; --b3-theme-on-surface: #666; --b3-border-color: #ddd; --b3-theme-surface-lighter: #ddd; --b3-border-radius: 4px; --b3-border-radius-b: 8px; --b3-theme-primary: #3573f0;}");
                await win.webContents.executeJavaScript(`(${runCases.toString()})(${JSON.stringify(path.join(__dirname, ".."))}, ${JSON.stringify(mode)}, ${Boolean(captureDirectory)})`);
            }
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
    test("skill manager preserves source and drafts across conflicts, dialogs and mobile navigation", async () => {
        const profile = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-skill-manager-"));
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        try {
            await promisify(execFile)(require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 60000});
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            fs.rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
