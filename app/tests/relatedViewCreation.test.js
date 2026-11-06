const assert = require("node:assert/strict");
const {readFileSync, mkdtempSync, rmSync} = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const sources = () => {
    const ts = require("typescript");
    return Object.fromEntries(["protyle/render/av/relatedViewConfig", "protyle/render/av/relation", "menus/Menu",
        "menus/menuToggle", "util/escape"].map(name => [name, ts.transpileModule(
        readFileSync(path.join(__dirname, "../src", name + ".ts"), "utf8"), {
            compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS},
        }).outputText]));
};

const cases = async (compiled, languages) => {
    const check = require("node:assert/strict");
    const tick = () => new Promise(resolve => setTimeout(resolve, 0));
    const operations = [], requests = [];
    let mobile = false;
    const common = document.createElement("div");
    document.body.append(common);
    const menu = {element: common, remove() { common.innerHTML = ""; common.classList.add("fn__none"); },
        append(element) { common.append(element); }, fullscreen() { common.classList.remove("fn__none"); }, showSubMenu() {}};
    window.siyuan = {config: {readonly: false}, languages, menus: {menu}};
    window.Lute = {NewNodeID: () => "back-relation"};
    const noop = () => {};
    const dependencies = {
        isMobile: () => mobile,
        updateHotkeyTip: value => value.replace("⌘", "Ctrl+"), updateMenuItemGroupClasses: noop,
        fetchSyncPost: async (url, payload) => {
            requests.push({url, payload});
            return {code: 0, data: {av: {views: [{id: "first", type: "table", name: "Table"},
                {id: "second", type: "table", name: '⌘ <Orders> "2026"'}]}}};
        },
        transaction: (_editor, forward, undo) => operations.push({forward, undo}),
        updateAttrViewCellAnimation: noop, focusBlock: noop,
    };
    const modules = {};
    const load = name => {
        if (modules[name]) return modules[name];
        if (!compiled[name]) return dependencies;
        const exports = modules[name] = {};
        new Function("require", "exports", compiled[name])(specifier => {
            if (specifier === "dayjs") return () => ({format: () => "20261106000000"});
            const parts = name.split("/"); parts.pop();
            for (const part of specifier.split("/")) {
                if (part === "..") parts.pop();
                else if (part !== ".") parts.push(part);
            }
            return load(parts.join("/"));
        }, exports);
        return exports;
    };
    const config = load("protyle/render/av/relatedViewConfig");
    const relation = load("protyle/render/av/relation");
    for (mobile of [false, true]) {
        const field = {id: "relation", type: "relation", name: "Related"};
        const editor = {disabled: false};
        const panel = document.createElement("div");
        panel.innerHTML = `<div class="b3-menu__items"><div class="b3-menu__item" data-col-id="relation"></div>
<input data-type="name" value="Related"><button class="b3-menu__item" data-type="goSearchAV" data-av-id=""></button>
<input data-type="colName" data-old-value="" value="Back"><input class="b3-switch" data-type="backRelation">
${config.getRelatedViewConfigHTML(field, editor)}<button data-type="confirm">Confirm</button></div>`;
        document.body.append(panel);
        const content = panel.firstElementChild;
        const toggle = panel.querySelector('[data-type="relatedViewEnabled"]');
        await config.bindRelatedViewConfig(editor, "source", field, content, "source-carrier");
        check.equal(toggle.disabled, true);
        const source = panel.querySelector('[data-type="goSearchAV"]');
        source.dataset.avId = "target";
        source.dataset.blockId = "target-carrier";
        await tick();
        check.equal(toggle.disabled, false, "target selection enables the existing menu without reopening");
        check.deepEqual(requests.at(-1).payload, {id: "target", blockID: "target-carrier"});
        const start = operations.length;
        toggle.click();
        check.equal(toggle.checked, true);
        const selector = panel.querySelector('[data-type="relatedViewTarget"]');
        check.equal(selector.querySelector(".b3-menu__label").textContent, languages._attrView.relatedDatabaseView);
        check.equal(selector.querySelector(".b3-menu__accelerator").textContent, "Table");
        selector.click();
        const choices = mobile ? common.querySelectorAll(".b3-menu__item") : selector.querySelectorAll(".b3-menu__submenu .b3-menu__item");
        choices[1].click();
        check.equal(panel.querySelector('[data-type="relatedViewTarget"] .b3-menu__accelerator').textContent, '⌘ <Orders> "2026"');
        check.equal(operations.length, start, "new relation settings wait for confirmation");
        panel.querySelector('[data-type="confirm"]').addEventListener("click", () => relation.updateRelation({
            protyle: editor, avID: "source", avElement: panel, colsData: [field],
            blockElement: {getAttribute: () => "source-carrier", querySelector: () => null},
        }));
        panel.querySelector('[data-type="confirm"]').click();
        check.equal(operations.length, start + 1);
        check.equal(panel.isConnected, false);
        check.equal(operations.at(-1).forward.find(item => item.action === "setAttrViewRelationDetail").data.viewID, "second");
        check.equal(operations.at(-1).undo.find(item => item.action === "setAttrViewRelationDetail").data, null);
    }
    return "Related creation DOM cases passed";
};

if (process.versions.electron && process.type === "browser") {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", process.argv[2]);
    app.commandLine.appendSwitch("disable-gpu");
    app.whenReady().then(async () => {
        const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false,
            offscreen: true, backgroundThrottling: false}});
        try {
            await win.loadURL("data:text/html,<html><body></body></html>");
            const languages = JSON.parse(readFileSync(path.join(__dirname, "../appearance/langs/en.json"), "utf8"));
            console.log(await win.webContents.executeJavaScript(`(${cases.toString()})(${JSON.stringify(sources())}, ${JSON.stringify(languages)})`));
            win.destroy(); app.exit(0);
        } catch (error) { console.error(error); win.destroy(); app.exit(1); }
    });
} else {
    require("node:test").test("related creation enables the current menu and saves selected views through native desktop and mobile controls", {timeout: 60000}, async () => {
        const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE;
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-related-creation-"));
        try {
            const args = [__filename, profile];
            if (process.platform === "linux" && !env.DISPLAY && !env.WAYLAND_DISPLAY) args.push("--ozone-platform=headless");
            if (process.platform === "linux" && process.getuid?.() === 0) args.push("--no-sandbox");
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), args, {env, timeout: 55000, windowsHide: true});
            assert.match(stdout, /Related creation DOM cases passed/);
        } finally { rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100}); }
    });
}
