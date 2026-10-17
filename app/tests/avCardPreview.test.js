const assert = require("node:assert/strict");
const {readFileSync, mkdtempSync, rmSync} = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const runCases = (sources, mobile) => {
    const assert = require("node:assert/strict");
    const opened = [];
    const primary = {id: "value", value: {keyID: "primary", block: {id: "document", content: "Title"}}};
    window.siyuan = {languages: {}};
    const dependencies = {
        "./conditionalColor": {getConditionalItemStyle: () => ""},
        "../../../util/escape": {escapeAttr: value => value},
        "../../../util/image": {getCompressURL: value => value},
        "../../../util/imageURL": {isBrowserRenderableImagePath: () => true},
        "./attributeValue": {getAVTemplateInteractiveElement: () => undefined},
        "../../util/compatibility": {isOnlyMeta: event => event.metaKey || event.ctrlKey},
        "./coverPosition": {isCardCoverPositioning: () => false},
        "./virtualScroll": {getAVPrimaryCell: (block, itemID) => {
            assert.equal(block.dataset.nodeId, "database");
            assert.equal(itemID, "row");
            return primary;
        }},
        "./cellValue": {cloneAVCellValueSnapshot: value => JSON.parse(JSON.stringify(value))},
        "./openDatabaseRow": {openDatabaseRowByData: (_protyle, data) => opened.push(data)},
    };
    const load = name => {
        if (!dependencies[name]) {
            const exports = {};
            new Function("require", "exports", sources[name])(id => sources[id] ? load(id) : dependencies[id] || {}, exports);
            dependencies[name] = exports;
        }
        return dependencies[name];
    };
    const {getRowHTML} = load("./row");
    const {avClick} = load("./action");
    const host = document.createElement("div");
    host.className = "protyle-wysiwyg";
    host.style.width = mobile ? "360px" : "800px";
    document.body.append(host);
    const protyle = {notebookId: "notebook"};
    for (const type of ["gallery", "kanban"]) {
        const data = {fields: [{id: "primary", type: "block", hidden: true}], coverFrom: 1,
            cardAspectRatio: 0, displayEmptyFields: true};
        for (const cover of [
            {coverContent: '<div data-node-id="preview" data-type="NodeParagraph" class="p"><div contenteditable="false">Preview <span data-type="block-ref" data-id="other">reference</span></div></div><a href="#other">Link</a><button>Button</button><input value="Preview input">'},
            {coverURL: "assets/cover.png"},
            {},
        ]) {
            host.innerHTML = `<div class="av" data-node-id="database" data-av-id="av" data-type="NodeAttributeView" data-av-type="${type}"><div class="av__gallery">${getRowHTML({data, row: {id: "row", values: [], coverContent: "", ...cover}, rowIndex: 0, type})}</div></div>`;
            const block = host.firstElementChild;
            const coverElement = host.querySelector(".av__gallery-cover");
            const preview = host.querySelector(".av__gallery-content");
            if (!coverElement) {
                assert.equal(type, "kanban");
                assert.deepEqual(cover, {});
                continue;
            }
            if (preview) {
                // 模拟主题将摘要提升到遮罩之上，验证事件和焦点仍由外层卡片承接。
                preview.style.position = "relative";
                preview.style.zIndex = "1";
                for (const control of preview.querySelectorAll("a, button, input")) {
                    control.style.pointerEvents = "auto";
                    control.focus();
                    assert.notEqual(document.activeElement, control);
                }
            }
            const rect = coverElement.getBoundingClientRect();
            assert.ok(rect.width > 0 && rect.height > 0);
            for (const offset of [12, 35, 65]) {
                const target = document.elementFromPoint(rect.left + 35, rect.top + offset);
                assert.ok(coverElement.contains(target));
                assert.ok(!preview?.contains(target), "preview blocks and controls cannot capture pointer input");
                const before = opened.length;
                const event = new MouseEvent("click", {bubbles: true, cancelable: true});
                block.onclick = event => avClick(protyle, event);
                target.dispatchEvent(event);
                if (type === "gallery") {
                    assert.equal(opened.length, before + 1);
                    assert.equal(opened.at(-1).boundBlockID, "document");
                    assert.equal(opened.at(-1).itemID, "row");
                    assert.equal(event.defaultPrevented, true);
                }
            }
            if (preview) {
                // 对照相同布局，摘要恢复交互后会遮住封面并截获命中。
                preview.inert = false;
                const target = document.elementFromPoint(rect.left + 35, rect.top + 12);
                assert.ok(preview.contains(target));
            }
        }
    }
};

const runElectron = async () => {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", process.argv[2]);
    app.commandLine.appendSwitch("disable-gpu");
    await app.whenReady();
    const win = new BrowserWindow({show: false, width: 1100, height: 900,
        webPreferences: {nodeIntegration: true, contextIsolation: false}});
    let exitCode = 0;
    try {
        const ts = require("typescript");
        const {parse} = require("ifdef-loader/preprocessor");
        for (const mobile of [false, true]) {
            const files = {"./row": "render/av/row", "./action": "render/av/action",
                "./cover": "render/av/cover", "./gallery/cardLayout": "render/av/gallery/cardLayout",
                "../../util/hasClosest": "util/hasClosest"};
            const sources = Object.fromEntries(Object.entries(files).map(([name, file]) => [name,
                ts.transpileModule(parse(readFileSync(path.join(__dirname, `../src/protyle/${file}.ts`), "utf8"),
                    {MOBILE: mobile, BROWSER: true}, false, true), {
                    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021},
                }).outputText]));
            await win.loadURL("data:text/html,<html><body></body></html>");
            await win.webContents.insertCSS(require("sass").compile(path.join(__dirname,
                `../src/assets/scss/${mobile ? "mobile" : "base"}.scss`), {logger: {warn() {}}}).css);
            const error = await win.webContents.executeJavaScript(`(() => {
                try { (${runCases.toString()})(${JSON.stringify(sources)}, ${mobile}); return ""; }
                catch (error) { return error.stack; }
            })()`);
            assert.equal(error, "");
        }
        console.log("AV card preview input cases passed");
    } catch (error) {
        console.error(error);
        exitCode = 1;
    } finally {
        win.destroy();
        app.exit(exitCode);
    }
};

if (process.versions.electron && process.type === "browser") {
    runElectron().catch(error => {
        console.error(error);
        require("electron").app.exit(1);
    });
} else {
    require("node:test").test("card content previews preserve pointer opening and reject focus on desktop and mobile", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 45000,
    }, async () => {
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-av-card-preview-"));
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 40000});
            assert.match(stdout, /AV card preview input cases passed/);
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(profile).startsWith("siyuan-av-card-preview-"));
            rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
