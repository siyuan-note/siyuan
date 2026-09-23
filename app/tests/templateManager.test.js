const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const runCases = async (sources, css, mobile, legacyMobile) => {
    const assert = require("node:assert/strict");
    const tick = () => new Promise(resolve => setTimeout(resolve, 30));
    document.body.innerHTML = '<div id="model"><button class="toolbar__icon">Back</button><div id="modelMain"></div></div>';
    new Function(sources.icons)();
    const style = document.createElement("style");
    style.textContent = css + "body {margin:0;}" + (mobile ? "#modelMain {height:calc(100dvh - 44px);}" : "#model {display:none;}");
    document.head.replaceChildren(style);
    const requests = [];
    const files = new Map([
        ["alpha.md", {content: "Original source", revision: "alpha-v1", sourceDocID: "20260921000000-abcdefg"}],
        ["beta.md", {content: "Other source", revision: "beta-v1"}],
        ["folder", {content: "", revision: "folder-v1", isDir: true}],
        ["package", {content: "", revision: "package-v1", isDir: true, isPackage: true}],
    ]);
    const dialogs = [];
    const confirmations = [];
    const opened = [];
    let modelOptions;
    let sourceUnavailable = false;
    let confirmInput;
    let openSucceeded = true;
    let closed = 0;
    const menuElement = document.createElement("div");
    menuElement.className = "fn__none";
    document.body.append(menuElement);
    const menu = {
        element: menuElement,
        remove() {menuElement.classList.add("fn__none"); menuElement.replaceChildren();},
        append(element) {menuElement.append(element);},
        popup() {menuElement.classList.remove("fn__none");},
    };
    class Dialog {
        constructor(options) {
            this.options = options;
            this.element = document.createElement("div");
            this.element.style.width = options.width || "400px";
            this.element.style.height = options.height || "auto";
            this.element.innerHTML = options.content;
            document.body.append(this.element);
            dialogs.push(this);
        }
        destroy() {this.element.remove(); this.options.destroyCallback?.();}
    }
    const languages = JSON.parse(sources.languages);
    window.siyuan = {languages, dialogs: [], storage: {}, mobile: {}, ws: {app: {}}, config: {system: {dataDir: "/workspace/data"}}, menus: {menu}};
    if (!legacyMobile) {
        window.siyuan.mobile.tabs = {open: async id => {
            opened.push(id);
            return openSucceeded ? "success" : "failed";
        }};
    }
    const stubs = {
        "dialog": {Dialog},
        "dialog/inputDialog": {openInputDialog(options) {
            const prompt = new Dialog({content: "<input>"});
            prompt.element.querySelector("input").value = options.value;
            confirmInput = value => {
                prompt.element.querySelector("input").value = value;
                options.onConfirm(value, prompt);
            };
            return prompt;
        }},
        "dialog/confirmDialog": {confirmDialog: (title, text, callback) => confirmations.push({title, text, callback})},
        "dialog/message": {showMessage() {}},
        "util/hostCapabilities": {getHostCapabilities: () => ({localFileSystem: true})},
        "util/functions": {isMobile: () => mobile, isBrowser: () => false},
        "editor/rename": {replaceFileName: value => value},
        "editor/util": {openBy() {}, openFileById: async options => {
            opened.push(options.id);
            return openSucceeded ? {} : undefined;
        }},
        "mobile/editor": {loadMobileFileById: (_app, id, _action, _scroll, _box, afterOpen, _force, _valid, _signal, _attr, _recent, onFailure) => {
            opened.push(id);
            if (openSucceeded) {afterOpen({notebookId: "notebook"});} else {onFailure();}
        }},
        "mobile/util/backlinkPanels": {closeMobileBacklinkSheets: async () => {}},
        "constants": {Constants: {LOCAL_DOCINFO: "docInfo"}},
        "protyle/util/compatibility": {setStorageVal() {}},
        "util/pathName": {isEncryptedBox: () => false},
        "mobile/menu/model": {openModel: options => {
            modelOptions = options;
            document.getElementById("model").style.transform = "translateX(0px)";
            const element = document.getElementById("modelMain");
            element.innerHTML = options.html;
            options.bindEvent(element);
        }},
        "mobile/util/closePanel": {closeModel: () => {
            document.getElementById("modelMain").replaceChildren();
            modelOptions.destroyCallback();
        }},
        "protyle/toolbar/util": {
            clearTemplatePreview: element => {element.innerHTML = "";},
            previewTemplate: (_path, element, _context, source) => {element.textContent = source;},
        },
        "menus/Menu": {MenuItem: class {
            constructor(options) {
                this.element = document.createElement("button");
                this.element.dataset.id = options.id;
                this.element.textContent = options.label;
                this.element.disabled = options.disabled;
                this.element.onclick = () => {options.click(); menu.remove();};
            }
        }},
        "util/fetch": {fetchSyncPost: async (url, data) => {
            requests.push({url, ...data});
            if (url === "/api/block/getRefText") {return {code: 0, data: "Context document"};}
            if (url === "/api/block/getBlockInfo") {
                return sourceUnavailable ? {code: -1} : {code: 0, data: {rootID: data.id, box: "notebook"}};
            }
            assert.equal(url, "/api/template/manage");
            if (data.action === "list") {
                return {code: 0, data: Array.from(files, ([path, file]) => ({path, isDir: !!file.isDir, isPackage: file.isPackage}))};
            }
            const file = files.get(data.path);
            if (data.action === "read") {
                return file ? {code: 0, data: {...file, path: "/templates/" + data.path}} : {code: -1};
            }
            if (file?.revision !== data.revision) {return {code: -1};}
            if (data.action === "move") {
                files.set(data.target, file);
                files.delete(data.path);
            } else if (data.action === "remove") {
                files.delete(data.path);
            } else if (data.action === "write") {
                file.content = data.content;
                file.revision += "-saved";
                file.sourceDocID = undefined;
                return {code: 0, data: {revision: file.revision}};
            }
            return {code: 0, data: null};
        }},
    };
    const cache = {};
    const load = name => {
        if (stubs[name]) {return stubs[name];}
        if (cache[name]) {return cache[name];}
        assert.ok(sources[name], name);
        const exports = cache[name] = {};
        new Function("require", "exports", sources[name])(reference => {
            const segments = name.split("/").slice(0, -1);
            for (const segment of reference.split("/")) {
                if (segment === "..") {segments.pop();}
                else if (segment !== ".") {segments.push(segment);}
            }
            return load(segments.join("/"));
        }, exports);
        return exports;
    };
    const {openTemplateManager} = load("template/manager");
    openTemplateManager("context", () => closed++, "alpha.md");
    await tick();
    const root = document.querySelector(".template-manager");
    const source = root.querySelector("textarea");
    const row = name => Array.from(root.querySelectorAll("li[data-path]")).find(row => row.dataset.path === name);
    const button = action => root.querySelector(`.template-manager__actions > [data-action="${action}"]`);
    const select = async name => {row(name).querySelector(".template-manager__file").click(); await tick();};
    const more = async name => {row(name).querySelector(".template-manager__more").click(); await tick();};
    const action = name => menuElement.querySelector(`[data-id="${name}"]`).click();
    const edit = value => {source.value = value; source.dispatchEvent(new Event("input"));};
    assert.equal(source.value, "Original source");
    assert.equal(button("rename"), null);
    assert.equal(button("move"), null);
    assert.equal(button("remove"), null);
    assert.equal(button("source").classList.contains("fn__none"), false);
    if (mobile) {
        assert.equal(button("open"), null);
        assert.equal(getComputedStyle(root.querySelector(".template-manager__sidebar")).display, "none");
        root.querySelector(".template-manager__heading [data-action=more]").click();
        await tick();
        assert.equal(menuElement.querySelector("[data-id=open]"), null);
        assert.ok(menuElement.querySelector("[data-id=source]"));
        modelOptions.backCallback();
        assert.ok(menuElement.classList.contains("fn__none"));
        assert.ok(root.classList.contains("template-manager--editing"));
        edit("Unsaved mobile content");
        modelOptions.backCallback();
        assert.equal(confirmations.length, 1);
        confirmations.pop();
        assert.equal(source.value, "Unsaved mobile content");
        modelOptions.backCallback();
        confirmations.pop().callback();
        await tick();
        assert.equal(root.classList.contains("template-manager--editing"), false);
        assert.equal(closed, 0);
        await more("folder");
        assert.equal(root.classList.contains("template-manager--editing"), false);
        assert.equal(row("folder").querySelector(".template-manager__toggle").getAttribute("aria-expanded"), "false");
        menu.remove();
        await select("alpha.md");
    } else {
        await select("folder");
        root.querySelector(".template-manager__heading [data-action=more]").click();
        await tick();
        assert.ok(menuElement.querySelector("[data-id=source]"));
        menu.remove();
        row("beta.md").dispatchEvent(new MouseEvent("contextmenu", {bubbles: true, cancelable: true}));
        await tick();
        assert.equal(menuElement.querySelector("[data-id=source]"), null);
        assert.equal(source.value, "Original source");
        menu.remove();
    }
    edit("Unsaved content");
    await more("beta.md");
    assert.equal(source.value, "Unsaved content");
    assert.equal(confirmations.length, 0);
    assert.equal(menuElement.querySelector("[data-id=source]"), null);
    action("rename");
    assert.equal(confirmations.length, 1);
    confirmations.pop();
    assert.ok(files.has("beta.md"));
    await more("beta.md");
    action("rename");
    confirmations.pop().callback();
    confirmInput("renamed.md");
    await tick();
    assert.ok(files.has("renamed.md"));
    assert.ok(files.has("alpha.md"));
    assert.equal(requests.find(request => request.action === "move").revision, "beta-v1");
    assert.equal(source.value, "Other source");
    await more("renamed.md");
    action("move");
    const moveDialog = dialogs.at(-1);
    moveDialog.element.querySelector("select").value = "folder";
    moveDialog.element.querySelector("[data-action=confirm]").click();
    await tick();
    assert.ok(files.has("folder/renamed.md"));
    await more("package");
    assert.equal(menuElement.querySelector("[data-id=rename]").disabled, true);
    assert.equal(menuElement.querySelector("[data-id=move]").disabled, true);
    assert.equal(menuElement.querySelector("[data-id=remove]").disabled, false);
    menu.remove();
    await more("folder/renamed.md");
    files.get("folder/renamed.md").revision = "external-change";
    action("remove");
    confirmations.pop().callback();
    await tick();
    assert.ok(files.has("folder/renamed.md"));
    assert.equal(source.value, "Other source");
    await select("alpha.md");
    edit("Source without document attributes");
    button("save").click();
    await tick();
    assert.equal(button("source").classList.contains("fn__none"), true);
    files.get("alpha.md").sourceDocID = "20260921000000-abcdefg";
    button("refresh").click();
    await tick();
    sourceUnavailable = true;
    button("source").click();
    await tick();
    assert.equal(opened.length, 0);
    assert.equal(closed, 0);
    sourceUnavailable = false;
    openSucceeded = false;
    button("source").click();
    await tick();
    assert.equal(closed, 0);

    for (const width of mobile ? [360, 740] : [1440, 850]) {
        await require("electron").ipcRenderer.invoke("template-manager-size", width, 800);
        await tick();
        const wide = !mobile && width === 1440;
        assert.equal(root.classList.contains("template-manager--wide"), wide);
        assert.equal(getComputedStyle(root.querySelector(".template-manager__editor")).flexDirection, wide ? "row" : "column");
        assert.ok(root.scrollWidth <= root.clientWidth + 1, `${mobile}/${width}: manager overflows`);
        assert.ok(root.getBoundingClientRect().top < 100, "manager must stay within the viewport");
        const editor = root.querySelector(".template-manager__editor");
        assert.ok(editor.scrollWidth <= editor.clientWidth + 1, `${mobile}/${width}: editor overflows`);
        button("source").textContent = "Open the document from which this template was originally exported";
        root.style.fontSize = "28px";
        await tick();
        assert.ok(root.scrollWidth <= root.clientWidth + 1, `${mobile}/${width}: large text overflows`);
        assert.ok(editor.scrollWidth <= editor.clientWidth + 1, `${mobile}/${width}: large editor text overflows`);
        root.style.fontSize = "";
        button("source").textContent = languages.templateOpenSourceDoc;
        const original = source.value;
        source.value = "# Project plan\n\n## Goals\n\n- Plan the next milestone\n- Review progress\n\n## Notes\n\n.action{.title}";
        root.querySelector(".template-manager__preview").innerHTML = '<div class="protyle-wysiwyg"><h1>Project plan</h1><h2>Goals</h2><ul><li>Plan the next milestone</li><li>Review progress</li></ul><h2>Notes</h2><p>Context document</p></div>';
        await tick();
        await require("electron").ipcRenderer.invoke("template-manager-capture", `${mobile ? "mobile" : "desktop"}-${width}`);
        source.value = original;
        if (mobile && width === 360) {
            await require("electron").ipcRenderer.invoke("template-manager-size", width, 360);
            await tick();
            button("source").scrollIntoView({block: "nearest"});
            assert.ok(button("source").getBoundingClientRect().bottom <= 360, "actions remain reachable above the keyboard");
        }
    }
    openSucceeded = true;
    button("source").click();
    await tick();
    assert.equal(closed, 1);
    assert.equal(opened.at(-1), "20260921000000-abcdefg");
};

if (process.versions.electron && process.type === "browser") {
    const {app, BrowserWindow, ipcMain} = require("electron");
    app.setPath("userData", process.argv[2]);
    app.whenReady().then(async () => {
        const win = new BrowserWindow({show: false, width: 1500, height: 900, webPreferences: {nodeIntegration: true, contextIsolation: false, backgroundThrottling: false, offscreen: true}});
        let code = 0;
        try {
            ipcMain.handle("template-manager-size", (_event, width, height) => win.setContentSize(width, height));
            ipcMain.handle("template-manager-capture", async (_event, name) => {
                if (process.env.SIYUAN_TEMPLATE_CAPTURE_DIR) {
                    assert.match(name, /^(mobile|desktop)-\d+$/);
                    win.webContents.invalidate();
                    await new Promise(resolve => setTimeout(resolve, 150));
                    fs.writeFileSync(path.join(process.env.SIYUAN_TEMPLATE_CAPTURE_DIR, name + ".png"), (await win.webContents.capturePage()).toPNG());
                }
            });
            const ts = require("typescript");
            const preprocess = require("ifdef-loader/preprocessor").parse;
            const sass = require("sass");
            const theme = fs.readFileSync(path.join(__dirname, "../appearance/themes/daylight/theme.css"), "utf8");
            for (const [mobile, legacyMobile] of [[false, false], [true, false], [true, true]]) {
                await win.loadURL("data:text/html,<html><body></body></html>");
                const sources = {
                    icons: fs.readFileSync(path.join(__dirname, "../appearance/icons/litheness/icon.js"), "utf8"),
                    languages: fs.readFileSync(path.join(__dirname, "../appearance/langs/zh-CN.json"), "utf8"),
                };
                for (const name of ["template/manager", "template/actionState", "util/fileTree", "util/escape"]) {
                    sources[name] = ts.transpileModule(preprocess(fs.readFileSync(path.join(__dirname, "../src", name + ".ts"), "utf8"),
                        {MOBILE: mobile, BROWSER: false}, false, true), {
                        compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
                    }).outputText;
                }
                const css = theme + sass.compile(path.join(__dirname, `../src/assets/scss/${mobile ? "mobile" : "base"}.scss`), {logger: sass.Logger.silent}).css;
                await win.webContents.executeJavaScript(`(${runCases.toString()})(${JSON.stringify(sources)}, ${JSON.stringify(css)}, ${mobile}, ${legacyMobile})`);
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
    test("template manager preserves action targets, unsaved edits, source navigation and mobile layout", async () => {
        const profile = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-template-manager-"));
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
