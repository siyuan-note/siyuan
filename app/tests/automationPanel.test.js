const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const runCases = async (sources, css, mobile) => {
    const assert = require("node:assert/strict");
    const path = require("node:path").posix;
    const tick = () => new Promise(resolve => setTimeout(resolve, 30));
    document.head.innerHTML = "";
    document.body.innerHTML = '<div class="av__panel"><div class="b3-menu"></div></div>';
    document.body.className = "body--windows";
    new Function(sources.icons)();
    const style = document.createElement("style");
    style.textContent = css;
    document.head.append(style);
    const menu = document.querySelector(".b3-menu");
    if (mobile) {
        menu.classList.add("b3-menu--fullscreen", "b3-menu--sheet");
        // 与移动端数据库底部面板的初始高度一致，内容通过面板内部滚动访问。
        menu.style.height = "56vh";
    }
    const lang = sources.languages;
    const currentCondition = {column: "status", operator: "=", value: {type: "select", mSelect: [{content: "Done"}]}};
    const database = {id: "source", name: "Tasks", keyValues: [
        {key: {id: "status", name: "Status", type: "select", options: [{name: "Done"}]}},
        {key: {id: "finished", name: "Completion time", type: "date"}},
        {key: {id: "relation", name: "Time logs", type: "relation", relation: {avID: "target"}}},
    ], automations: {spec: 1, rules: [{id: "rule", name: "Record completion time", enabled: false, trigger: "changed", keyID: "status",
        conditions: [currentCondition], actions: [{type: "edit", target: "current", fields: {finished: {mode: "currentTime"}}}]}]}};
    const targetDatabase = {...database, id: "target", name: "Time logs"};
    const transactions = [];
    let fieldMenu;
    let nextID = 0;
    window.Lute = {NewNodeID: () => `generated-${++nextID}`};
    window.siyuan = {languages: lang, config: {}, notebooks: [], menus: {menu: {remove() {}}}};
    const mocks = {
        "plugin/Menu": {Menu: class {items = []; addItem(item) {this.items.push(item);} open() {fieldMenu = {items: this.items};}}},
        "util/fetch": {fetchSyncPost: async (url, request) => url.includes("getHPathByID") ? {code: 0, data: "/Tasks"} :
            {code: 0, data: {av: request.id === "source" ? database : targetDatabase}}},
        "protyle/wysiwyg/transaction": {transaction: (_protyle, perform, undo) => transactions.push(structuredClone({perform, undo}))},
        "protyle/render/av/view": {getFieldsByData: data => data.view.columns},
        "protyle/render/av/col": {getColIconByType: () => "iconDatabase"},
        "protyle/render/av/color": {getAVColorStyle: () => ""},
        "protyle/render/av/cell": {getCellValueText: value => value.text?.content || ""},
        "protyle/render/av/relation": {openSearchAV: options => options.callback({dataset: {avId: "target"}})},
    };
    const cache = {};
    const load = name => {
        if (mocks[name]) return mocks[name];
        if (cache[name]) return cache[name];
        if (!sources[name]) return {};
        const exports = {};
        cache[name] = exports;
        new Function("exports", "require", sources[name])(exports, request => request === "dayjs" ? {default: require("dayjs")} :
            load(path.normalize(path.join(path.dirname(name), request))));
        return exports;
    };
    await load("protyle/render/av/automation").openAutomationMenu({protyle: {options: {}, block: {rootID: "document"}},
        blockElement: {dataset: {nodeId: "carrier"}}, avID: "source", menuElement: menu, onResize() {}});
    const get = selector => {const element = menu.querySelector(selector); assert.ok(element, selector); return element;};
    const change = async (selector, value) => {
        const element = get(selector);
        element.value = value;
        element.dispatchEvent(new Event("change", {bubbles: true}));
        await tick();
    };
    const click = async selector => {get(selector).dispatchEvent(new MouseEvent("click", {bubbles: true})); await tick();};
    const latest = () => transactions.at(-1).perform[0].data.rules[0];
    const sections = menu.querySelectorAll("section");
    assert.equal(sections.length, 3);
    assert.ok(sections[0].contains(get("[data-trigger]")));
    assert.ok(sections[1].contains(get("[data-source-conditions]")));
    assert.ok(sections[2].contains(get("[data-actions]")));
    assert.equal(get("[data-rule]").labels[0].textContent.includes(lang.automationRule), true);
    assert.equal(get("[data-enabled]").labels[0].textContent.trim(), lang.enable);
    assert.equal(get("[data-trigger-field] option").textContent, lang.automationAnyField);
    assert.equal(get("[data-status]").textContent, lang.automationReady);
    assert.equal(transactions.length, 0, "opening settings must preserve the stored rule");
    const originalConditions = structuredClone(database.automations.rules[0].conditions);
    await change("[data-target]", "related");
    await change("[data-relation]", "relation");
    assert.equal(get("[data-status]").classList.contains("ft__error"), true);
    await click('[data-action="add-field"]');
    fieldMenu.items.find(item => item.label === "Completion time").click();
    await tick();
    await change("[data-mode]", "currentTime");
    assert.deepEqual(latest().conditions, originalConditions);
    assert.deepEqual(latest().actions[0].fields, {finished: {mode: "currentTime", value: {type: "date"}}});
    assert.equal(get("[data-status]").textContent, lang.automationReady);
    await click("[data-target-filters] [data-add-condition]");
    fieldMenu.items.find(item => item.label === "Completion time").click();
    await tick();
    assert.equal(latest().actions[0].filters[0].column, "finished");
    assert.deepEqual(latest().conditions, originalConditions);
    await click('[data-target-filters] [data-action="remove-condition"]');
    assert.equal(latest().actions[0].filters.length, 0);
    assert.deepEqual(latest().conditions, originalConditions);
    get("[data-enabled]").click();
    assert.equal(latest().enabled, true);
    assert.equal(get("[data-status]").classList.contains("fn__none"), true);
    await change("[data-action-type]", "add");
    assert.equal(get("[data-target]").labels[0].querySelector("span").textContent, lang.database);
    assert.equal(get("[data-target-filters]").textContent, "");
    await change("[data-action-type]", "edit");
    assert.equal(get("[data-target]").labels[0].querySelector("span").textContent, lang.automationTarget);
    await change("[data-trigger]", "added");
    assert.equal(menu.querySelector("[data-trigger-field]"), null);
    assert.deepEqual(latest().conditions, originalConditions);
    await change("[data-trigger]", "changed");
    await change("[data-target]", "filtered");
    await click('[data-action="database"]');
    assert.equal(latest().actions[0].avID, "target");
    assert.ok(get("[data-target-filters] [data-add-condition]"));
    assert.deepEqual(latest().conditions, originalConditions);
    await change("[data-target]", "current");
    await click('[data-action="add-field"]');
    fieldMenu.items.find(item => item.label === "Completion time").click();
    await tick();
    await change("[data-mode]", "currentTime");
    const theme = document.createElement("style");
    document.head.append(theme);
    for (const width of mobile ? [360, 740] : [560, 1000]) {
        await require("electron").ipcRenderer.invoke("automation-size", width, 900);
        for (const fontSize of ["", "28px"]) {
            menu.style.fontSize = fontSize;
            await tick();
            for (const element of [menu, get(".av__automation-body"), ...menu.querySelectorAll("section, [data-index]")]) {
                assert.ok(element.scrollWidth <= element.clientWidth + 1, `${mobile}/${width}/${fontSize}: content overflows`);
            }
        }
        menu.style.fontSize = "";
        for (const name of ["daylight", "midnight"]) {
            theme.textContent = sources[name];
            get(".b3-menu__items").scrollTop = 0;
            await require("electron").ipcRenderer.invoke("automation-capture", `${mobile ? "mobile" : "desktop"}-${width}-${name}`);
            get('[data-action="add-action"]').scrollIntoView({block: "nearest"});
            await tick();
            assert.ok(get('[data-action="add-action"]').getBoundingClientRect().bottom <= 901,
                `${mobile}/${width}: actions remain reachable by scrolling: ${JSON.stringify(get('[data-action="add-action"]').getBoundingClientRect())}`);
            await require("electron").ipcRenderer.invoke("automation-capture", `${mobile ? "mobile" : "desktop"}-${width}-${name}-actions`);
        }
    }
    await change("[data-trigger]", "block");
    assert.equal(get("[data-source-conditions]").closest("section").textContent.includes(lang.automationBlockConditions), true);
    assert.equal(menu.querySelector("[data-add-condition]"), null);
    assert.ok(get("[data-scope]"));
    assert.equal(get('[data-action="preview-collection"]').disabled, true);
    assert.equal(get("[data-status]").textContent, lang.automationReady);
    get("[data-enabled]").click();
    assert.equal(latest().enabled, true);
    assert.equal(get('[data-action="preview-collection"]').disabled, false);
    assert.equal(latest().actions[0].type, "collect");
    assert.deepEqual(database.automations.rules[0].conditions, [currentCondition]);
};

if (process.versions.electron && process.type === "browser") {
    const {app, BrowserWindow, ipcMain} = require("electron");
    app.setPath("userData", process.argv[2]);
    app.whenReady().then(async () => {
        const win = new BrowserWindow({show: false, width: 1000, height: 900,
            webPreferences: {nodeIntegration: true, contextIsolation: false, backgroundThrottling: false, offscreen: true}});
        let code = 0;
        try {
            ipcMain.handle("automation-size", (_event, width, height) => win.setContentSize(width, height));
            ipcMain.handle("automation-capture", async (_event, name) => {
                if (!process.env.SIYUAN_AUTOMATION_CAPTURE_DIR) return;
                assert.match(name, /^(desktop|mobile)-\d+-(daylight|midnight)(-actions)?$/);
                win.webContents.invalidate();
                await new Promise(resolve => setTimeout(resolve, 150));
                fs.writeFileSync(path.join(process.env.SIYUAN_AUTOMATION_CAPTURE_DIR, name + ".png"), (await win.webContents.capturePage()).toPNG());
            });
            const ts = require("typescript");
            const sass = require("sass");
            const sources = {icons: fs.readFileSync(path.join(__dirname, "../appearance/icons/litheness/icon.js"), "utf8"),
                languages: JSON.parse(fs.readFileSync(path.join(__dirname, "../appearance/langs/zh-CN.json"), "utf8"))};
            for (const name of ["automation", "capabilities", "capabilities.generated", "filter", "filterTree", "fieldValueEditor", "blockCollection"]) {
                sources[`protyle/render/av/${name}`] = ts.transpileModule(fs.readFileSync(path.join(__dirname, `../src/protyle/render/av/${name}.ts`), "utf8"), {
                    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
                }).outputText;
            }
            sources["util/escape"] = ts.transpileModule(fs.readFileSync(path.join(__dirname, "../src/util/escape.ts"), "utf8"), {
                compilerOptions: {module: ts.ModuleKind.CommonJS},
            }).outputText;
            for (const name of ["daylight", "midnight"]) sources[name] = fs.readFileSync(path.join(__dirname, `../appearance/themes/${name}/theme.css`), "utf8");
            for (const mobile of [false, true]) {
                await win.loadURL("data:text/html,<html><body></body></html>");
                const css = sources.daylight + sass.compile(path.join(__dirname, `../src/assets/scss/${mobile ? "mobile" : "base"}.scss`), {logger: sass.Logger.silent}).css;
                await win.webContents.executeJavaScript(`(${runCases.toString()})(${JSON.stringify(sources)}, ${JSON.stringify(css)}, ${mobile})`);
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
    test("automation guidance preserves source and target filters, explicit activation, collection and responsive layout", async () => {
        const profile = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-automation-panel-"));
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
