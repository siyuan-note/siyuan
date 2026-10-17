const assert = require("node:assert/strict");
const {readFileSync, mkdtempSync, rmSync} = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const source = () => {
    const ts = require("typescript");
    const file = path.join(__dirname, "../src/menus/layouts.ts");
    const ast = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    const statement = ast.statements.find(item => ts.isVariableStatement(item) &&
        item.declarationList.declarations.some(declaration => declaration.name.getText(ast) === "getLayoutSubMenu"));
    return ts.transpileModule(statement.getText(ast).replace("export const", "const"), {
        compilerOptions: {target: ts.ScriptTarget.ES2021},
    }).outputText;
};

const cases = async (compiled) => {
    const check = require("node:assert/strict");
    const calls = [];
    class MenuItem {
        constructor(options) {
            this.element = document.createElement("div");
            this.element.className = "b3-menu__item";
            this.element.innerHTML = '<span class="b3-menu__label"></span><div class="b3-menu__submenu"></div>';
            this.element.querySelector("span").textContent = options.label;
            this.element.addEventListener("click", event => options.click(this.element, event));
        }
    }
    const root = document.createElement("div");
    document.body.append(root);
    window.siyuan = {
        storage: {layouts: [{name: "Alpha"}, {name: "Beta"}]},
        languages: {searchPlaceholder: "Search", openBy: "Open", mainWindowLayouts: "Main window layouts",
            windowWorkspaces: "Window layouts", save: "Save", layoutSelectedCount: "Selected ${x}"},
        menus: {menu: {element: root, remove: () => calls.push("remove")}},
    };
    const getLayoutSubMenu = new Function("MenuItem", "Constants", "isBrowser", "getWindowWorkspaces",
        "getLayoutActions", "escapeHtml", "openLayout", "openWindowWorkspace", "openSelectedLayouts",
        "editLayout", "ipcRenderer", compiled + "; return getLayoutSubMenu;")(
        MenuItem, {LOCAL_LAYOUTS: "layouts"}, () => false,
        () => [{id: "one", name: "One"}, {id: "two", name: "Two"}], () => [], value => value,
        name => calls.push(name), id => calls.push(id), (main, ids) => calls.push({main, ids}), () => {},
        {invoke: () => Promise.resolve([])});
    const item = getLayoutSubMenu()[0];
    root.innerHTML = item.label;
    item.bind(root);
    await Promise.resolve();
    const main = name => root.querySelector(`[data-name="${name}"] input`);
    const detached = id => root.querySelector(`[data-workspace-id="${id}"] input`);
    const count = () => root.querySelector("[data-type='selected-count']").textContent;
    const open = root.querySelector("[data-id='open-selected']");
    const search = root.querySelector(".b3-text-field");
    const filter = value => {
        search.value = value;
        search.dispatchEvent(new InputEvent("input", {bubbles: true}));
    };
    check.equal(main("Alpha").type, "radio");
    check.equal(main("Alpha").name, main("Beta").name);
    check.notEqual(main("Alpha").name, "");
    check.equal(detached("one").type, "checkbox");
    check.equal(open.disabled, true);
    main("Alpha").click();
    main("Beta").click();
    check.equal(main("Alpha").checked, false);
    check.equal(main("Beta").checked, true);
    check.equal(count(), "Selected 1");
    main("Beta").click();
    check.equal(main("Beta").checked, false);
    check.equal(count(), "Selected 0");
    check.equal(open.disabled, true);
    main("Alpha").parentElement.click();
    check.equal(main("Alpha").checked, true);
    main("Alpha").parentElement.click();
    check.equal(main("Alpha").checked, false);
    detached("one").click();
    detached("two").click();
    detached("one").click();
    check.equal(detached("two").checked, true);
    check.equal(count(), "Selected 1");
    detached("one").click();
    main("Alpha").click();
    check.equal(count(), "Selected 3");
    filter("Beta");
    check.equal(main("Alpha"), null);
    check.equal(count(), "Selected 3");
    filter("");
    check.equal(main("Alpha").checked, true);
    filter("Beta");
    main("Beta").click();
    filter("");
    check.equal(main("Alpha").checked, false);
    check.equal(main("Beta").checked, true);
    check.equal(detached("one").checked, true);
    check.equal(detached("two").checked, true);
    check.equal(count(), "Selected 3");
    check.deepEqual(calls, []);
    open.click();
    check.equal(calls[0], "remove");
    check.equal(calls[1].main, "Beta");
    check.deepEqual(calls[1].ids.slice().sort(), ["one", "two"]);
    calls.length = 0;

    // 使用原生按键验证单选组切换和取消，确保不会触发行点击打开布局。
    const key = value => require("electron").ipcRenderer.invoke("layout-selection-key", value);
    main("Alpha").focus();
    await key("Space");
    check.equal(main("Alpha").checked, true);
    check.equal(main("Beta").checked, false);
    main("Alpha").dispatchEvent(new KeyboardEvent("keydown", {key: " ", repeat: true, bubbles: true}));
    check.equal(main("Alpha").checked, true);
    await key("Down");
    check.equal(main("Beta").checked, true);
    check.equal(main("Alpha").checked, false);
    check.equal(document.activeElement, main("Beta"));
    await key("Space");
    check.equal(main("Beta").checked, false);
    check.equal(count(), "Selected 2");
    check.deepEqual(calls, []);
    open.click();
    check.equal(calls[0], "remove");
    check.equal(calls[1].main, "");
    check.deepEqual(calls[1].ids.slice().sort(), ["one", "two"]);
    root.remove();
    return "Layout selection cases passed";
};

const run = async () => {
    const {app, BrowserWindow, ipcMain} = require("electron");
    app.setPath("userData", process.argv[2]);
    app.commandLine.appendSwitch("disable-gpu");
    await app.whenReady();
    const win = new BrowserWindow({show: false, webPreferences: {
        nodeIntegration: true, contextIsolation: false, offscreen: true,
    }});
    ipcMain.handle("layout-selection-key", async (_event, keyCode) => {
        win.webContents.sendInputEvent({type: "keyDown", keyCode});
        win.webContents.sendInputEvent({type: "keyUp", keyCode});
        await new Promise(resolve => setTimeout(resolve, 20));
    });
    let code = 0;
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        const result = await win.webContents.executeJavaScript(`(${cases.toString()})(${JSON.stringify(source())})`);
        assert.equal(result, "Layout selection cases passed");
        console.log(result);
    } catch (error) {
        console.error(error);
        code = 1;
    } finally {
        win.destroy();
        app.exit(code);
    }
};

if (process.versions.electron && process.type === "browser") {
    run().catch(error => { console.error(error); require("electron").app.exit(1); });
} else {
    require("node:test").test("layout selection preserves single-choice, optional main layout and window multi-selection", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 45000,
    }, async () => {
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-layout-selection-test-"));
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 40000});
            assert.match(stdout, /Layout selection cases passed/);
        } finally {
            assert.ok(path.resolve(profile).startsWith(path.resolve(os.tmpdir()) + path.sep));
            rmSync(profile, {recursive: true, force: true});
        }
    });
}
