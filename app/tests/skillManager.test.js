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
    const viewportListeners = new Map();
    const addViewportListener = viewport.addEventListener.bind(viewport);
    const removeViewportListener = viewport.removeEventListener.bind(viewport);
    viewport.addEventListener = (type, listener) => {
        if (!viewportListeners.has(listener)) {
            viewportListeners.set(listener, new Set());
        }
        viewportListeners.get(listener).add(type);
        addViewportListener(type, listener);
    };
    viewport.removeEventListener = (type, listener) => {
        viewportListeners.get(listener)?.delete(type);
        if (viewportListeners.get(listener)?.size === 0) {
            viewportListeners.delete(listener);
        }
        removeViewportListener(type, listener);
    };
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
    const textFiles = new Map([
        ["directory-id/.config.json", "\ufeff{\r\n  \"enabled\": true\r\n}\r\n"],
        ["directory-id/run.py", "print('text only')\n"],
        ["directory-id/README", "No extension\n"],
    ]);
    const readOnlyFiles = new Map([
        ["directory-id/image.png", "binary"],
        ["directory-id/legacy.txt", "encoding"],
        ["directory-id/large.txt", "tooLarge"],
    ]);
    const entries = [
        {path: "directory-id", isDir: true, editable: false},
        {path: "directory-id/SKILL.md", isDir: false, editable: true},
        {path: "directory-id/resources", isDir: true, editable: false},
        {path: "directory-id/resources/notes.md", isDir: false, editable: true},
        ...Array.from(textFiles.keys(), path => ({path, isDir: false, editable: false})),
        ...Array.from(readOnlyFiles.keys(), path => ({path, isDir: false, editable: true})),
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
                return {code: 0, data: {entries: entries.map(entry => ({...entry}))}};
            }
            if (request.action === "read") {
                const entry = entries.find(item => item.path === request.path);
                assert.ok(entry, request.path);
                if (readOnlyFiles.has(request.path)) {
                    return {code: 0, data: {revision: "revision-1", readOnlyReason: readOnlyFiles.get(request.path)}};
                }
                return {code: 0, data: {
                    revision: "revision-1",
                    ...(textFiles.has(request.path) ? {content: textFiles.get(request.path)} :
                        entry.editable ? {content: request.path.endsWith("SKILL.md") ? stored : "Resource text"} : {}),
                }};
            }
            if (request.action === "write") {
                if (conflict) {
                    return {code: -1, msg: "File changed", data: null};
                }
                if (request.path.endsWith("SKILL.md")) {
                    stored = request.content;
                } else {
                    textFiles.set(request.path, request.content);
                    if (!entries.some(entry => entry.path === request.path)) {
                        entries.push({path: request.path, isDir: false, editable: true});
                    }
                }
                return {code: 0, data: {revision: "revision-2"}};
            }
            if (request.action === "move") {
                const entry = entries.find(entry => entry.path === request.path);
                entry.path = request.target;
                textFiles.set(request.target, textFiles.get(request.path));
                textFiles.delete(request.path);
                return {code: 0, data: {}};
            }
            if (request.action === "remove") {
                entries.splice(entries.findIndex(entry => entry.path === request.path), 1);
                textFiles.delete(request.path);
                return {code: 0, data: {}};
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
    let settingsRoot;
    if (mobile) {
        document.body.innerHTML = `<div id="model" class="side-panel fn__flex-column" style="transform: translateX(0px)">
            <div class="toolbar"><span class="toolbar__text">AI</span></div>
            <div id="modelMain" class="fn__flex-1"><div class="config config--mobile config--mobile-items">
                <div style="height: 1800px"><input id="setting-draft" value="Keep settings state"></div>
            </div></div>
        </div>`;
        settingsRoot = document.querySelector(".config");
        document.querySelector("#setting-draft").focus({preventScroll: true});
        settingsRoot.scrollTop = 100;
        assert.equal(settingsRoot.scrollTop, 100);
    }
    const openManager = () => load("ai/skills/manager").openSkillManager(settingsRoot);
    const currentHost = () => mobile ? settingsRoot.querySelector(".skill-manager-page") : window.siyuan.dialogs[0].element;
    openManager();
    await tick();
    await tick();
    const dialog = window.siyuan.dialogs[0];
    const host = currentHost();
    const manager = host.matches(".skill-manager") ? host : host.querySelector(".skill-manager");
    assert.ok(manager);
    await new Promise(resolve => setTimeout(resolve, 180));
    assert.equal(host.classList.contains("mobile-bottom-sheet-dialog"), false);
    assert.equal(host.querySelector(".b3-menu__title--root"), null);
    const container = mobile ? host : host.querySelector(".b3-dialog__container");
    if (mobile) {
        assert.equal(window.siyuan.dialogs.length, 0, "mobile management is a settings page");
        assert.equal(host.querySelector('[role="dialog"]'), null);
        assert.ok(document.querySelector("#setting-draft").closest("[inert]"), "parent settings cannot receive input");
        assert.ok(document.querySelector("#model > .toolbar").hasAttribute("inert"));
        const bounds = container.getBoundingClientRect();
        assert.ok(Math.abs(bounds.left) < 1 && Math.abs(bounds.right - window.innerWidth) < 1,
            "the mobile page spans the viewport width");
        assert.ok(Math.abs(bounds.top) < 1 && Math.abs(bounds.bottom - window.innerHeight) < 1,
            "the mobile page covers the parent settings toolbar and content");
        assert.equal(getComputedStyle(manager.querySelector(".skill-manager__editor")).display, "none");
    }
    assert.equal(Boolean(manager.querySelector('[data-action="open"]')), mode === "desktop");
    if (capture) {
        await require("electron").ipcRenderer.invoke("skill-manager-capture", `${mode}-${window.innerWidth}-list`);
    }
    const button = action => host.querySelector(`[data-action="${action}"]`);
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
        assert.equal(document.activeElement, button("back"), "opening a file focuses its page navigation");
        viewport.height = 360;
        viewport.dispatchEvent(new Event("resize"));
        await tick();
        const bounds = container.getBoundingClientRect();
        assert.ok(bounds.bottom <= 361, "the page stays above the keyboard");
        assert.ok(source.getBoundingClientRect().height > 60, "the keyboard leaves usable source space");
        assert.ok(button("save").getBoundingClientRect().bottom <= source.getBoundingClientRect().top,
            "save stays in the page header above the source editor");
        assert.ok(button("save").getBoundingClientRect().bottom <= bounds.bottom, "save stays within the page");
        viewport.offsetTop = 80;
        viewport.dispatchEvent(new Event("scroll"));
        await tick();
        const shiftedBounds = container.getBoundingClientRect();
        assert.ok(Math.abs(shiftedBounds.top - 80) < 1 && shiftedBounds.bottom <= 441,
            "the page follows a keyboard-panned visual viewport");
        viewport.offsetTop = 0;
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
        assert.equal(prompt.element.classList.contains("mobile-bottom-sheet-dialog"), false);
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
    const backOrClose = () => mobile ? button("back").click() : dialog.destroy();
    backOrClose();
    await cancelConfirm();
    assert.ok(host.isConnected);
    assert.equal(source.value, edited + "Unsaved");
    backOrClose();
    await acceptConfirm();
    if (mobile) {
        assert.ok(host.isConnected, "returning from the editor keeps the file list open");
        backOrClose();
        await tick();
        assert.ok(settingsRoot.isConnected);
        assert.equal(settingsRoot.scrollTop, 100, "returning to settings preserves its scroll position");
        assert.equal(document.querySelector("#setting-draft").value, "Keep settings state");
        assert.equal(document.querySelector("#setting-draft").closest("[inert]"), null);
        assert.equal(document.querySelector("#model > .toolbar").hasAttribute("inert"), false);
        assert.equal(document.activeElement.id, "setting-draft", "returning to settings restores focus");
        assert.equal(viewportListeners.size, 0, "leaving the page removes viewport listeners");
    }
    assert.equal(host.isConnected, false);
    assert.equal(window.siyuan.dialogs.length, 0);

    conflict = false;
    openManager();
    await tick();
    await tick();
    const next = window.siyuan.dialogs[0];
    const nextHost = currentHost();
    const nextManager = nextHost.matches(".skill-manager") ? nextHost : nextHost.querySelector(".skill-manager");
    nextManager.querySelector('[data-path="directory-id"] .skill-manager__file').click();
    await tick();
    await tick();
    nextManager.querySelector('[data-path="directory-id/image.png"] .skill-manager__file').click();
    await tick();
    await tick();
    assert.equal(nextHost.querySelector('[data-action="save"]').disabled, true);
    assert.equal(nextManager.querySelector('[data-action="rename"]').disabled, true);
    assert.equal(nextManager.querySelector('[data-action="remove"]').disabled, true);
    const lang = window.siyuan.languages;
    assert.equal(nextManager.querySelector(".skill-manager__hint").textContent,
        lang.agentSkillBinaryTip + (mode === "desktop" ? " " + lang.agentSkillOpenLocationTip : ""));
    if (mode === "desktop") {
        nextManager.querySelector('[data-action="open"]').click();
        assert.equal(opened[0][0], "D:/workspace/data/storage/ai/agent/skills/directory-id/image.png");
    }
    if (mobile) {
        nextHost.querySelector('[data-action="back"]').click();
        await tick();
    }
    nextManager.querySelector('[data-action="newSkill"]').click();
    await tick();
    const prompt = window.siyuan.dialogs[window.siyuan.dialogs.length - 1];
    assert.notEqual(prompt, next);
    assert.equal(prompt.element.classList.contains("mobile-bottom-sheet-dialog"), false);
    prompt.element.querySelector("[data-input-cancel]").click();
    await tick();
    const nextButton = action => nextHost.querySelector(`[data-action="${action}"]`);
    const returnToList = async () => {
        if (mobile && nextManager.classList.contains("skill-manager--editing")) {
            nextButton("back").click();
            await tick();
        }
    };
    const nextChoose = async file => {
        await returnToList();
        nextManager.querySelector(`[data-path="${file}"] .skill-manager__file`).click();
        await tick();
        await tick();
    };
    for (const [file, reason] of readOnlyFiles) {
        await nextChoose(file);
        const tip = {binary: lang.agentSkillBinaryTip, encoding: lang.agentSkillEncodingTip, tooLarge: lang.agentSkillTooLargeTip}[reason];
        assert.ok(nextManager.querySelector(".skill-manager__hint").textContent.startsWith(tip));
        assert.equal(nextButton("rename").disabled, true);
        assert.equal(nextButton("remove").disabled, true);
        assert.equal(nextManager.querySelector("textarea").disabled, true);
    }
    for (const [file, content] of textFiles) {
        await nextChoose(file);
        const editor = nextManager.querySelector("textarea");
        assert.equal(editor.disabled, false, "read response supersedes stale list editability");
        assert.equal(editor.value, content.replace(/\r\n/g, "\n"));
        editor.value += "edited\n";
        editor.dispatchEvent(new Event("input", {bubbles: true}));
        nextButton("save").click();
        await tick();
        await tick();
        const saved = requests.filter(request => request.action === "write").at(-1);
        assert.equal(saved.path, file);
        assert.equal(saved.content, content + (content.includes("\r\n") ? "edited\r\n" : "edited\n"));
        assert.equal(nextButton("rename").disabled, false);
        assert.equal(nextButton("remove").disabled, false);
    }
    const nameAction = async (action, name) => {
        await returnToList();
        nextButton(action).click();
        await tick();
        const inputDialog = window.siyuan.dialogs.at(-1);
        inputDialog.element.querySelector("input").value = name;
        inputDialog.element.querySelector("[data-input-confirm]").click();
        for (let i = 0; i < 6; i++) {
            await tick();
        }
    };
    for (const name of ["settings.yaml", "LICENSE"]) {
        await nameAction("newFile", name);
        assert.ok(textFiles.has("directory-id/" + name), "new text files keep their chosen extension or lack of one");
        assert.equal(nextManager.querySelector("textarea").disabled, false, "empty files are editable");
    }
    await nameAction("rename", ".env");
    assert.ok(textFiles.has("directory-id/.env"));
    assert.equal(textFiles.has("directory-id/LICENSE"), false);
    await returnToList();
    nextButton("remove").click();
    await tick();
    await acceptConfirm();
    for (let i = 0; i < 4; i++) {
        await tick();
    }
    assert.equal(textFiles.has("directory-id/.env"), false);
    if (mobile) {
        settingsRoot.remove();
    } else {
        next.destroy();
    }
    await tick();
    assert.equal(window.siyuan.dialogs.length, 0);
    assert.equal(viewportListeners.size, 0, "unmounting settings removes viewport listeners");
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
