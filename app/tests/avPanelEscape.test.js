const assert = require("node:assert/strict");
const {readFileSync, mkdtempSync, rmSync} = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const ts = require("typescript");
const {parse} = require("ifdef-loader/preprocessor");

const sources = mobile => {
    const read = file => readFileSync(path.join(__dirname, "../src", file), "utf8");
    const compile = text => ts.transpileModule(parse(text, {MOBILE: mobile, BROWSER: true}, false, true), {
        compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
    }).outputText;
    const declaration = (file, name) => {
        const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true);
        return source.statements.find(node => ts.isVariableStatement(node) &&
            node.declarationList.declarations.some(item => item.name.getText(source) === name)).getText(source);
    };
    return {
        panel: compile(read("protyle/render/av/openMenuPanel.ts")),
        target: compile(read("protyle/render/av/panelTarget.ts")),
        keyboard: compile(read("boot/globalEvent/keydown.ts")),
        avKeyboard: compile(read("protyle/render/av/keydown.ts")),
        closest: compile(read("protyle/util/hasClosest.ts")),
        selection: compile("const revealTabsForTarget = () => {};\n" +
            declaration("protyle/util/selection.ts", "focusBlock") + "\n" +
            declaration("protyle/util/selectionOffsets.ts", "focusByRange")),
    };
};

const runCases = async (compiled, mobile) => {
    const check = require("node:assert/strict");
    const load = (text, imports) => {
        const exports = {};
        new Function("require", "exports", text)(name =>
            new Proxy(imports[name] || {}, {get: (target, key) => target[key] || (() => false)}), exports);
        return exports;
    };
    const target = load(compiled.target, {});
    const closest = load(compiled.closest, {});
    const selection = load(compiled.selection, {});
    const keys = new Proxy({}, {get: () => ({})});
    const menuElement = document.createElement("div");
    menuElement.className = "fn__none";
    window.siyuan = {zIndex: 0, dialogs: [], languages: {}, menus: {menu: {
        element: menuElement,
        remove: () => menuElement.classList.add("fn__none"),
    }}, config: {keymap: {general: keys, editor: {general: keys, insert: keys, heading: keys, list: keys, table: keys}}}};
    const focusCalls = [];
    const focusBlock = element => {
        focusCalls.push(element);
        return selection.focusBlock(element);
    };
    let submissions = 0;
    const panel = load(compiled.panel, {
        "./panels/registry": {getAVPanelDescriptor: () => ({
            render: context => {context.html = "<input>"; return true;},
            bind: context => {context.closeCB = () => submissions++;},
        })},
        "./groups": {getPageSize: () => ({unGroupPageSize: 50, groupPageSize: {}})},
        "./view": {getFieldsByData: () => []},
        "./panelTarget": target,
        "../../../util/escape": {escapeAttr: String},
        "../../../util/functions": {isMobile: () => mobile},
        "../../util/selection": {focusBlock},
        "../../../constants": {Constants: {TIMEOUT_TRANSITION: 0}},
    });
    const avKeyboard = load(compiled.avKeyboard, {});
    const keyboard = load(compiled.keyboard, {
        "../../protyle/render/av/panelTarget": target,
        "../../protyle/render/av/keydown": avKeyboard,
        "../../protyle/util/hasClosest": closest,
        "../../protyle/util/selection": {focusBlock},
        "../../util/keymapBindings": {getKeymapBindings: () => []},
        "../../layout/getAll": {getAllEditor: () => [], getAllDocks: () => []},
        "../../protyle/toolbar/FormatPainter": {formatPainter: {deactivate: () => false}},
    });
    const fixture = (name, hidden, nodeID = name) => `<div class="protyle-wysiwyg" contenteditable="true" ${hidden ? 'style="display:none"' : ""}>
<div id="${name}" class="av" contenteditable="false" data-node-id="${nodeID}" data-type="NodeAttributeView" data-av-id="database" data-av-type="table">
    <div class="av__views">Views</div><div class="av__cell av__cell--select" data-col-id="field">Cell</div>
    <div class="av__cursor" contenteditable="true">&#8203;</div>
</div></div>`;
    const setup = (hidden = true, sameBlock = false) => {
        document.body.innerHTML = fixture("previous", hidden, sameBlock ? "shared" : "previous") +
            fixture("current", false, sameBlock ? "shared" : "current");
        focusCalls.length = 0;
        submissions = 0;
        const block = document.getElementById("current");
        const protyle = {toolbar: {subElement: document.createElement("div")}};
        protyle.toolbar.subElement.classList.add("fn__none");
        return {block, protyle, cell: block.querySelector(".av__cell")};
    };
    const open = (state, type = "relation", cells = type === "config" ? undefined : [state.cell]) => {
        panel.openMenuPanel({protyle: state.protyle, blockElement: state.block, type,
            cellElements: cells, data: {viewType: "table"}});
        const element = document.querySelector(".av__panel");
        check.ok(element);
        element.querySelector("input").focus();
        return element;
    };
    const escape = () => {
        const input = document.querySelector(".av__panel input");
        const event = new KeyboardEvent("keydown", {key: "Escape", bubbles: true, cancelable: true});
        let failure;
        input.addEventListener("keydown", event => {
            try {
                keyboard.windowKeyDown({}, event);
            } catch (error) {
                failure = error;
            }
        }, {once: true});
        input.dispatchEvent(event);
        if (failure) throw failure;
    };
    // 隐藏页签、分屏和同一块的多个显示实例都必须恢复到面板所属的数据库。
    for (const [hidden, sameBlock] of [[true, false], [false, false], [true, true]]) {
        for (const [type, dtype] of [["relation", "relation"], ["select", "select"], ["select", "mSelect"], ["date", "date"]]) {
            const state = setup(hidden, sameBlock);
            state.cell.dataset.dtype = dtype;
            const element = open(state, type);
            check.equal(target.getAVCellPanelTarget(element), state.block);
            escape();
            check.equal(element.isConnected, false);
            check.deepEqual(focusCalls, [state.block]);
            check.equal(submissions, 0, "Escape must not submit pending field edits");
            if (!mobile) {
                check.ok(state.block.contains(getSelection().getRangeAt(0).startContainer));
                if (document.hasFocus()) {
                    check.equal(document.activeElement, state.block.querySelector(".av__cursor"));
                    const received = [];
                    state.block.parentElement.addEventListener("keydown", event => received.push(event.key));
                    for (const key of ["ArrowRight", "Enter"]) {
                        document.activeElement.dispatchEvent(new KeyboardEvent("keydown", {key, bubbles: true}));
                    }
                    check.deepEqual(received, ["ArrowRight", "Enter"]);
                }
            }
        }
    }
    // 虚拟渲染移除选中标记后，面板仍使用记录的显示实例恢复焦点。
    const refreshed = setup();
    const refreshedPanel = open(refreshed);
    refreshed.cell.classList.remove("av__cell--select");
    escape();
    check.equal(refreshedPanel.isConnected, false);
    check.deepEqual(focusCalls, [refreshed.block]);
    // 配置面板和已隐藏或移除的来源不得借用其他文档的选中单元格。
    for (const condition of ["config", "hidden", "removed", "attribute"]) {
        const state = setup();
        const element = open(state, condition === "config" ? "config" : "relation",
            condition === "config" ? undefined : [state.cell]);
        if (condition === "hidden") state.block.parentElement.style.display = "none";
        if (condition === "removed") state.block.remove();
        if (condition === "attribute") state.block.classList.remove("av");
        escape();
        check.equal(element.isConnected, false);
        check.equal(focusCalls.length, 0);
        check.equal(submissions, 0);
    }
    // Esc 先关闭嵌套菜单，再取消字段面板；点击遮罩仍执行普通关闭提交。
    const nested = setup();
    const nestedPanel = open(nested);
    menuElement.classList.remove("fn__none");
    escape();
    check.equal(nestedPanel.isConnected, true);
    check.equal(focusCalls.length, 0);
    escape();
    check.equal(nestedPanel.isConnected, false);
    check.deepEqual(focusCalls, [nested.block]);
    const outside = setup();
    const outsidePanel = open(outside, "date");
    outsidePanel.querySelector('[data-type="close"]').click();
    check.equal(outsidePanel.isConnected, false);
    check.equal(submissions, 1);
    await new Promise(resolve => setTimeout(resolve, 10));
    check.deepEqual(focusCalls, [outside.block]);
};

if (process.versions.electron && process.type === "browser") {
    (async () => {
        const {app, BrowserWindow} = require("electron");
        app.setPath("userData", process.argv[2]);
        await app.whenReady();
        const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false}});
        let exitCode = 0;
        try {
            await win.loadURL("data:text/html,<html><body></body></html>");
            for (const mobile of [false, true]) {
                const failure = await win.webContents.executeJavaScript(`Promise.resolve().then(() =>
                    (${runCases.toString()})(${JSON.stringify(sources(mobile))}, ${mobile})).then(() => null, error => error.stack || String(error))`);
                assert.equal(failure, null);
            }
            console.log("AV panel Escape ownership cases passed");
        } catch (error) {
            console.error(error);
            exitCode = 1;
        } finally {
            win.destroy();
            app.exit(exitCode);
        }
    })();
} else {
    require("node:test").test("database panel Escape restores its owning editor and preserves cancellation", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 35000,
    }, async () => {
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-av-panel-escape-"));
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 30000});
            assert.match(stdout, /AV panel Escape ownership cases passed/);
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(profile).startsWith("siyuan-av-panel-escape-"));
            rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
