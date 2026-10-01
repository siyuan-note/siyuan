const assert = require("node:assert/strict");
const {readFileSync, mkdtempSync, rmSync} = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const runCases = (sources) => {
    const assert = require("node:assert/strict");
    const opened = [];
    const edited = [];
    const errors = [];
    window.addEventListener("error", event => errors.push(event.message));
    let mobile = false;
    let tables;
    const escape = value => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;")
        .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    window.DOMPurify = {sanitize: value => value};
    window.siyuan = {config: {editor: {}}, languages: {database: "Database", empty: "Empty", untitled: "Untitled"}};
    const dependencies = {
        "../../../util/fetch": {fetchPost: (url, _data, callback) => callback({
            data: url.endsWith("getAttributeViewKeys") ? tables : {total: 0},
        })},
        "../../../util/escape": {escapeAttr: escape, escapeHtml: escape, escapeAriaLabel: escape, escapeHtmlTextAndAttr: escape},
        "../../../emoji/fileTreeIcon": {getFileTreeIconHTML: () => "<svg></svg>"},
        "../../../util/hostCapabilities": {getHostCapabilities: () => ({remoteKernel: true})},
        "../../../util/functions": {isTouchDevice: () => mobile},
        "../../../util/touchDragBridge": {isLastPointerMouse: () => !mobile},
        "../../../editor/openLink": {openLink: (_app, href, event, ctrl) => opened.push({href, event, ctrl})},
        "./col": {getColIconByType: () => "iconDatabase"},
        "./cell": {cellValueIsEmpty: () => false, popTextCell: (_protyle, cells, type) => edited.push({cells, type})},
        "./binding": {preserveAVBindingRange: () => () => {}},
        "./richText": {
            renderAVRichTextElements: () => {},
            getAVRichTextSafeURL: value => value,
            getAVTextSource: value => ({kind: "rich", content: value.text.content}),
            getAVRichTextPreviewHTML: value => value,
        },
    };
    const load = name => {
        if (dependencies[name]) {
            return dependencies[name];
        }
        if (!sources[name]) {
            return {};
        }
        const exports = {};
        new Function("require", "exports", sources[name])(load, exports);
        dependencies[name] = exports;
        return exports;
    };
    const {renderAVAttribute} = load("./blockAttr");
    const item = (id, detached = false, renderedContent) => ({
        type: "block", id: `value-${id}`, keyID: "primary", blockID: `row-${id}`,
        isDetached: detached, block: {id: detached ? "" : id, content: id},
        ...(renderedContent === undefined ? {} : {hasRenderTemplate: true, renderedContent}),
    });
    const firstID = "20261002120000-aaaaaaa";
    const secondID = "20261002120000-bbbbbbb";
    const templateID = "20261002120000-ccccccc";
    const click = (target, type = "click", options = {}) => {
        const event = new MouseEvent(type, {bubbles: true, cancelable: true, ...options});
        target.dispatchEvent(event);
        return event;
    };
    // 顶部面板、属性弹窗和独立条目页面执行同一套真实渲染与点击分发。
    for (const touch of [false, true]) {
        mobile = touch;
        for (const className of ["custom-attr protyle-db-attr__body", "custom-attr", "custom-attr protyle-db-row__body"]) {
            const body = document.createElement("div");
            body.className = className;
            document.body.replaceChildren(body);
            const protyle = {app: {}, options: {}, disabled: false};
            const contents = [item(firstID), item(secondID), item("detached", true),
                item(templateID, false, '<strong>Template</strong><a href="https://example.com">Link</a><button>Action</button>')];
            tables = [{avID: "database", blockIDs: ["carrier"], keyValues: [
                {key: {id: "relation", name: "Relation", type: "relation"}, values: [{
                    type: "relation", keyID: "relation", blockID: "row",
                    relation: {blockIDs: contents.map(value => value.blockID), contents},
                }]},
                {key: {id: "text", name: "Text", type: "text"}, values: [{
                    type: "text", keyID: "text", blockID: "row",
                    text: {content: `<span data-type="block-ref" data-id="${secondID}">Reference</span>`},
                }]},
            ]}];
            let bubbled = 0;
            document.body.onclick = () => bubbled++;
            renderAVAttribute(body, "document", protyle);
            const field = body.querySelector('[data-type="relation"]');
            const refs = field.querySelectorAll('[data-type="block-ref"]');
            for (const [index, id] of [firstID, secondID].entries()) {
                const before = edited.length;
                const event = click(refs[index], "click", {ctrlKey: index === 0, metaKey: index === 1});
                assert.equal(opened.at(-1).href, `siyuan://blocks/${id}`);
                assert.equal(opened.at(-1).event, event);
                assert.equal(opened.at(-1).ctrl, true);
                assert.equal(event.defaultPrevented, true);
                assert.equal(edited.length, before);
                assert.equal(bubbled, 0);
            }
            for (const target of [field, field.querySelectorAll(".av__cell--relation")[2]]) {
                const before = opened.length;
                const beforeEdit = edited.length;
                click(target);
                assert.equal(edited.length, beforeEdit + 1);
                assert.equal(edited.at(-1).type, "relation");
                assert.equal(edited.at(-1).cells[0], field);
                assert.equal(opened.length, before);
            }
            const beforeContext = opened.length;
            const beforeContextEdit = edited.length;
            click(refs[0], "contextmenu");
            assert.equal(edited.length, beforeContextEdit + 1);
            assert.equal(edited.at(-1).type, "relation");
            assert.equal(opened.length, beforeContext);
            click(field.querySelector("strong"));
            assert.equal(opened.at(-1).href, `siyuan://blocks/${templateID}`);
            const beforeLink = edited.length;
            click(field.querySelector("a"));
            assert.equal(opened.at(-1).href, "https://example.com");
            assert.equal(edited.length, beforeLink);
            const beforeButton = opened.length;
            click(field.querySelector("button"));
            assert.equal(opened.length, beforeButton);
            assert.equal(edited.length, beforeLink);
            click(body.querySelector(".av__celltext--rich [data-type='block-ref']"));
            assert.equal(opened.at(-1).href, `siyuan://blocks/${secondID}`);
            assert.equal(edited.length, beforeLink);
            protyle.disabled = true;
            const beforeReadonly = opened.length;
            click(refs[0]);
            assert.equal(opened.length, beforeReadonly + 1);
            assert.equal(opened.at(-1).href, `siyuan://blocks/${firstID}`);
            click(field);
            click(refs[0], "contextmenu");
            assert.equal(edited.length, beforeLink);
        }
    }
    assert.deepEqual(errors, []);
};

const runElectron = async () => {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", process.argv[2]);
    app.commandLine.appendSwitch("disable-gpu");
    await app.whenReady();
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false}});
    let exitCode = 0;
    try {
        const ts = require("typescript");
        const sources = Object.fromEntries(["blockAttr", "attributeValue", "cellValue", "blockIcon", "../../util/hasClosest"].map(name => [
            name === "../../util/hasClosest" ? name : "./" + name,
            ts.transpileModule(readFileSync(path.join(__dirname, `../src/protyle/render/av/${name}.ts`), "utf8"),
                {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020}}).outputText,
        ]));
        await win.loadURL("data:text/html,<html><body></body></html>");
        const failure = await win.webContents.executeJavaScript(`Promise.resolve().then(() =>
            (${runCases.toString()})(${JSON.stringify(sources)})).then(() => null, error => error.stack || String(error))`);
        assert.equal(failure, null);
        console.log("Attribute navigation cases passed");
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
    require("node:test").it("opens related documents from attribute panels while preserving editing and template interactions", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 45000,
    }, async () => {
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-av-attribute-navigation-"));
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 40000});
            assert.match(stdout, /Attribute navigation cases passed/);
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(profile).startsWith("siyuan-av-attribute-navigation-"));
            rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
