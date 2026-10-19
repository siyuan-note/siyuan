const assert = require("node:assert/strict");
const {execFile} = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {test} = require("node:test");
const {promisify} = require("node:util");
const {ModuleKind, ScriptTarget, transpileModule} = require("typescript");
const sass = require("sass");

const runCases = async (sources, css, touch) => {
    const check = require("node:assert/strict");
    const load = (source, imports = {}) => {
        const api = {};
        new Function("require", "exports", source)(name => {
            check.ok(name in imports, name);
            return imports[name];
        }, api);
        return api;
    };
    document.head.innerHTML = "<style>" + css + "</style>";
    check.equal(matchMedia("(pointer: coarse)").matches, touch);
    window.siyuan = {languages: {previous: "Previous", next: "Next"}, config: {keymap: {general: {
        previousDatabaseRow: "ArrowUp", nextDatabaseRow: "ArrowDown",
    }}}};
    let rows = ["previous", "current", "next"];
    let release;
    let pending;
    const opened = [];
    const navigation = load(sources.navigation, {
        "../../../util/fetch": {fetchSyncPost: async () => ({code: 0, data: {
            view: {rows: rows.map(id => ({id, cells: [{id: id + "-value", value: {
                type: "block", isDetached: true, block: {content: id},
            }}]})), rowCount: rows.length}, target: {status: "visible"},
        }})},
        "../../../util/escape": {escapeAttr: String},
        "./renderData": {isAVRenderData: value => !!value?.view},
        "./virtualScroll": {getAVData: () => undefined},
        "./readonlyState": {getReadonlyAVSort: () => undefined},
    });
    const commands = load(sources.commands);
    let context;
    const executed = [];
    const shortcuts = load(sources.shortcuts, {
        "../protyle/util/hotKey": {matchHotKey: (key, event) => key === event.key},
        "./context": {captureCommandContext: () => context},
        "./databaseRowNavigation": commands,
        "./executor": {execByCommand: ({command}) => {
            executed.push(command);
            commands.getDatabaseRowNavigationButton(context, command)?.click();
        }},
    });
    const tick = () => new Promise(resolve => setTimeout(resolve, 0));
    const data = {avID: "av", databaseBlockID: "carrier", itemID: "current", navigation: {viewID: "view", query: ""}};
    const open = async next => { opened.push(next.itemID); await pending; return true; };
    for (const merged of [false, true]) {
        document.body.className = merged ? "mobile-topbar--merged" : "";
        document.body.innerHTML = `<div class="toolbar mobile-topbar">Title</div><div id="editor" class="protyle">
            <div class="protyle-breadcrumb"><button class="protyle-breadcrumb__icon" data-type="mobile-menu">Breadcrumb</button>
            <span class="protyle-breadcrumb__space${merged ? " protyle-breadcrumb__space--mobile-title" : ""}"></span>
            <div class="protyle-breadcrumb__plugin"></div>
            <button class="protyle-breadcrumb__icon" data-type="exit-focus">Exit focus</button>
            ${["command-panel", "readonly", "doc", "more"].map(type => `<button class="block__icon fn__flex-center" data-type="${type}"><svg></svg></button>`).join("")}
            </div><div class="protyle-content"><div class="protyle-wysiwyg" contenteditable="true">Content</div></div></div>`;
        const editor = document.getElementById("editor");
        const breadcrumb = editor.firstElementChild;
        navigation.mountDatabaseRowNavigation(editor, data, open, breadcrumb);
        await tick();
        const buttons = Array.from(editor.querySelectorAll("[data-row-navigation]"));
        const toolbar = buttons[0].parentElement;
        check.equal(toolbar.parentElement, breadcrumb);
        const menu = breadcrumb.querySelector('[data-type="mobile-menu"]');
        const control = breadcrumb.querySelector('[data-type="more"]').getBoundingClientRect();
        check.ok(control.right <= window.innerWidth, JSON.stringify({control, width: window.innerWidth}));
        check.equal(toolbar, breadcrumb.firstElementChild);
        check.equal(menu.getBoundingClientRect().height, 24);
        for (const button of buttons) {
            check.equal(button.disabled, false);
            const rect = button.getBoundingClientRect();
            check.equal(rect.height, control.height);
            check.equal(rect.width, control.width);
            check.equal(rect.top, control.top);
            check.ok(rect.right <= menu.getBoundingClientRect().left);
            check.ok(rect.right <= window.innerWidth);
            check.ok(button.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)), "navigation button must not be covered");
        }
        const inlinePositions = buttons.map(button => button.getBoundingClientRect().left - breadcrumb.getBoundingClientRect().left);
        const spacer = parseFloat(getComputedStyle(editor.querySelector(".protyle-content"), "::before").height);
        check.equal(spacer, merged ? 42 : 90);
        check.ok(breadcrumb.getBoundingClientRect().bottom <= spacer);
        editor.style.setProperty("--mobile-bar-translate-y", "calc(-1 * (var(--mobile-topbar-height) + var(--mobile-breadcrumb-height)))");
        if (merged) {
            check.equal(getComputedStyle(breadcrumb).transform, "none");
        } else {
            check.ok(toolbar.getBoundingClientRect().bottom <= 0, "navigation must hide together with mobile bars");
        }
        editor.style.removeProperty("--mobile-bar-translate-y");

        const editable = editor.querySelector("[contenteditable]");
        context = {environment: "browser-mobile", focus: "editor", activeElement: editable, protyle: {element: editor}};
        check.equal(commands.getDatabaseRowNavigationButton(context, "previousDatabaseRow"), buttons[0]);
        check.equal(commands.getDatabaseRowNavigationButton(context, "nextDatabaseRow"), buttons[1]);
        const key = (key, extras = {}) => new KeyboardEvent("keydown", {key, cancelable: true, ...extras});
        const composing = key("ArrowDown", {isComposing: true});
        check.equal(shortcuts.handleDatabaseRowShortcut({}, composing), false);
        check.equal(composing.defaultPrevented, false);
        const before = executed.length;
        check.equal(shortcuts.handleDatabaseRowShortcut({}, key("ArrowDown", {repeat: true})), true);
        check.equal(executed.length, before);
        pending = new Promise(resolve => { release = resolve; });
        const next = key("ArrowDown");
        check.equal(shortcuts.handleDatabaseRowShortcut({}, next), true);
        check.equal(next.defaultPrevented, true);
        await tick();
        check.ok(buttons.every(button => button.disabled));
        const count = opened.length;
        shortcuts.handleDatabaseRowShortcut({}, key("ArrowDown"));
        await tick();
        check.equal(opened.length, count, "loading must reject another navigation");
        release();
        await tick();
        check.equal(opened.at(-1), "next");

        rows = ["current", "next"];
        navigation.mountDatabaseRowNavigation(editor, data, open, breadcrumb);
        await tick();
        check.ok(editor.querySelector('[data-row-navigation="previous"]').disabled);
        const input = document.createElement("input");
        editor.append(input);
        context.activeElement = input;
        check.equal(shortcuts.handleDatabaseRowShortcut({}, key("ArrowDown")), false);
        context.activeElement = editable;
        context.focus = "dock";
        check.equal(commands.getDatabaseRowNavigationButton(context, "nextDatabaseRow"), undefined);
        context.focus = "editor";
        navigation.clearDatabaseRowNavigation(editor);
        check.equal(editor.querySelector("[data-database-row-navigation]"), null);
        check.equal(parseFloat(getComputedStyle(editor.querySelector(".protyle-content"), "::before").height), merged ? 42 : 90);
        check.equal(commands.getDatabaseRowNavigationButton(context, "nextDatabaseRow"), undefined);
        rows = ["previous", "current", "next"];

        const tab = document.createElement("div");
        tab.innerHTML = '<div class="protyle-db-row"></div>';
        document.body.append(tab);
        const row = tab.firstElementChild;
        navigation.mountDatabaseRowNavigation(row, data, open);
        await tick();
        const standalone = Array.from(row.querySelectorAll("[data-row-navigation]"), button => button.getBoundingClientRect());
        check.equal(standalone[0].width, control.width);
        check.equal(standalone[0].height, control.height);
        check.equal(standalone[0].left - row.getBoundingClientRect().left, 8);
        check.equal(standalone[1].left - standalone[0].right, 8);
        inlinePositions.forEach((left, index) => {
            check.equal(left, standalone[index].left - row.getBoundingClientRect().left);
        });
        context = {environment: "desktop", focus: "global", activeElement: document.body, activeTab: {element: tab}};
        check.equal(commands.getDatabaseRowNavigationButton(context, "nextDatabaseRow"), row.querySelector('[data-row-navigation="next"]'));
        tab.classList.add("fn__none");
        check.equal(commands.getDatabaseRowNavigationButton(context, "nextDatabaseRow"), undefined);
        tab.classList.remove("fn__none");
        tab.classList.add("b3-dialog");
        row.classList.add("protyle-db-row--mobile");
        context = {environment: "mobile", focus: "global", activeElement: document.body, protyle: {element: editor}};
        check.equal(commands.getDatabaseRowNavigationButton(context, "nextDatabaseRow"), row.querySelector('[data-row-navigation="next"]'));
        const otherDialog = document.createElement("div");
        otherDialog.className = "b3-dialog";
        document.body.append(otherDialog);
        context.activeElement = otherDialog;
        check.equal(commands.getDatabaseRowNavigationButton(context, "nextDatabaseRow"), undefined);
        otherDialog.remove();
        tab.remove();
    }
    return "Database row navigation cases passed";
};

test("database row navigation remains visible on mobile and scopes keyboard commands to the current preview", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 60000,
}, async () => {
    const sources = Object.fromEntries(Object.entries({
        navigation: "protyle/render/av/databaseRowNavigation.ts",
        commands: "command/databaseRowNavigation.ts",
        shortcuts: "command/databaseRowShortcut.ts",
    }).map(([key, file]) => [key, transpileModule(fs.readFileSync(path.join(__dirname, "../src", file), "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText]));
    const css = sass.compile(path.join(__dirname, "../src/assets/scss/mobile.scss"), {logger: sass.Logger.silent}).css;
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-row-navigation-test-"));
    const script = path.join(temporary, "run.cjs");
    fs.writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true}});
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        win.webContents.debugger.attach("1.3");
        for (const touch of [false, true]) {
            await win.webContents.debugger.sendCommand("Emulation.setTouchEmulationEnabled", {enabled: touch});
            for (const width of [320, 390]) {
                win.setContentSize(width, 844);
                console.log(await win.webContents.executeJavaScript(${JSON.stringify("(" + runCases.toString() + ")(" + JSON.stringify(sources) + "," + JSON.stringify(css) + ",")} + touch + ")"));
            }
        }
        win.destroy(); app.exit(0);
    } catch (error) { console.error(error); win.destroy(); app.exit(1); }
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron"), [script], {env, timeout: 50000, windowsHide: true});
        assert.equal(result.stdout.match(/Database row navigation cases passed/g)?.length, 4);
    } catch (error) {
        console.error(error.stdout, error.stderr);
        throw error;
    } finally {
        if (path.dirname(path.resolve(temporary)) === path.resolve(os.tmpdir()) &&
            path.basename(temporary).startsWith("siyuan-row-navigation-test-")) {
            fs.rmSync(temporary, {recursive: true, force: true, maxRetries: 5});
        }
    }
});
