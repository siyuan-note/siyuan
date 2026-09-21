const assert = require("node:assert/strict");
const {readFileSync, mkdtempSync, rmSync} = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const runCases = async (sources) => {
    const assert = require("node:assert/strict");
    const settle = () => new Promise(resolve => setTimeout(resolve, 0));
    const dataByElement = new WeakMap();
    let mobile = false;
    let fragment;
    window.siyuan = {zIndex: 0, languages: {empty: "Empty", cancel: "Cancel", save: "Save"}};
    const hiddenElement = () => {
        const element = document.createElement("div");
        element.className = "fn__none";
        return element;
    };
    const dependencies = {
        "../../../util/escape": {escapeHtml: value => value},
        "../../../util/functions": {isMobile: () => mobile},
        "../../../mobile/util/mobileAppUtil": {callMobileAppShowKeyboard: () => {}},
        "../../hint/extend": {hintRef: () => [], hintSlash: () => []},
        "../../hint/builtinSlash": {registerBuiltinSlashHint: value => value},
        "../../toolbar/defaults": {getDefaultToolbar: () => []},
        "../highlightRender": {highlightRender: () => {}},
        "../mathRender": {mathRender: () => {}},
        "./richTextEditorPosition": {positionAVRichTextEditor: () => {}},
        "./virtualScroll": {getAVData: element => dataByElement.get(element)},
        "../../util/outlineBlock": {updateOutlineCurrentBlock: () => {}},
        "./richText": {
            getAVTextSource: value => ({kind: "plain", content: value.text.content}),
            getAVRichTextLute: () => ({}),
            serializeAVRichTextBlockDOM: content => ({markdown: content, plainText: content}),
            createAVRichTextValue: (content, _plainText, value) => ({...value, text: {...value.text, content}}),
        },
        "../../lite/fragmentEditor": {
            // 保留真实 DOM 输入及浮层生命周期，仅隔离富文本内核和网络。
            mountProtyleLiteFragment: (host, options) => {
                const input = document.createElement("div");
                input.contentEditable = "true";
                input.textContent = options.initialPlainText;
                host.append(input);
                fragment = {
                    input,
                    destroyed: false,
                    flushed: false,
                    pendingInput: "",
                    hintElement: hiddenElement(),
                    protyle: {
                        wysiwyg: {flushPendingInput: async () => {
                            fragment.flushed = true;
                            if (fragment.pendingInput) {
                                input.append(document.createTextNode(fragment.pendingInput));
                            }
                        }},
                        toolbar: {element: hiddenElement(), subElement: hiddenElement()},
                    },
                    getBlockHTML: () => input.textContent,
                    focus: () => input.focus(),
                    destroy() {
                        this.destroyed = true;
                        host.replaceChildren();
                    },
                };
                return fragment;
            },
        },
    };
    const load = name => {
        if (!dependencies[name]) {
            assert.ok(sources[name], `Unexpected module: ${name}`);
            const exports = {};
            new Function("require", "exports", sources[name])(load, exports);
            dependencies[name] = exports;
        }
        return dependencies[name];
    };
    const editor = load("./richTextEditor");
    const {hasAVEditorSession} = load("./editorSession");
    const createOwner = standalone => {
        const owner = document.createElement("div");
        owner.className = standalone ? `protyle-db-row${mobile ? " protyle-db-row--mobile" : ""}` : "protyle";
        owner.innerHTML = '<div data-type="NodeAttributeView"><div class="av__row" data-id="row"><div data-col-id="text"></div></div></div>';
        document.body.replaceChildren(owner);
        const nodeElement = owner.firstElementChild;
        const anchorElement = nodeElement.querySelector("[data-col-id]");
        const value = {id: "value", keyID: "text", blockID: "row", type: "text", text: {content: "Initial"}};
        const column = {id: "text", type: "text"};
        const cell = {id: "value", value};
        const stableCells = [{groupID: "", rowID: "row", colID: "text", rowIndex: 0, colIndex: 0, cell, column}];
        const data = {viewType: "table", view: {columns: [column], rows: [{id: "row", cells: [cell]}]}};
        dataByElement.set(nodeElement, data);
        const saves = [];
        let closed = 0;
        const protyle = {element: standalone ? document.createElement("div") : owner};
        editor.openAVRichTextEditor({protyle, nodeElement, anchorElement, value, stableCells,
            onSave: (...args) => saves.push(args), onDestroy: () => closed++});
        return {owner, protyle, nodeElement, anchorElement, value, stableCells, saves, data, closed: () => closed};
    };
    for (const mode of ["document", "desktop-row", "mobile-row"]) {
        mobile = mode === "mobile-row";
        const state = createOwner(mode !== "document");
        for (const input of ["a", "b", "中文"]) {
            fragment.input.append(document.createTextNode(input));
            fragment.input.dispatchEvent(new InputEvent("input", {bubbles: true, data: input}));
            await settle();
            assert.ok(document.querySelector(".av__richtext-mask"), `${mode}: input must keep the editor open`);
            assert.equal(fragment.destroyed, false);
            assert.equal(document.activeElement, fragment.input);
        }
        assert.equal(hasAVEditorSession(state.owner), true, `${mode}: track the visible owner`);
        fragment.pendingInput = "待提交";
        if (mobile) {
            document.querySelector('[data-type="save"]').click();
        } else {
            document.querySelector(".av__richtext-mask").dispatchEvent(new MouseEvent("mousedown", {bubbles: true}));
        }
        await settle();
        assert.equal(fragment.flushed, true);
        assert.equal(state.saves.length, 1);
        assert.equal(state.saves[0][0].text.content, "Initialab中文待提交");
        assert.equal(state.saves[0][0].id, state.value.id);
        assert.equal(state.saves[0][1], state.nodeElement);
        assert.equal(state.saves[0][2], state.stableCells);
        assert.equal(state.closed(), 1);
        assert.equal(hasAVEditorSession(state.owner), false);
        assert.equal(document.querySelector(".av__richtext-mask"), null);

        const removed = createOwner(mode !== "document");
        fragment.input.append(document.createTextNode("unsaved"));
        await settle();
        removed.owner.remove();
        await settle();
        assert.equal(removed.saves.length, 0);
        assert.equal(removed.closed(), 1, `${mode}: closing the owner must cancel the editor`);
        assert.equal(fragment.destroyed, true);
        assert.equal(hasAVEditorSession(removed.owner), false);
        assert.equal(document.querySelector(".av__richtext-mask"), null);
    }
    // 普通数据库行刷新后仍按稳定标识编辑；目标字段删除后取消编辑。
    mobile = false;
    const rerendered = createOwner(false);
    rerendered.anchorElement.replaceWith(rerendered.anchorElement.cloneNode());
    fragment.input.append(document.createTextNode("updated"));
    await settle();
    assert.ok(document.querySelector(".av__richtext-mask"));
    rerendered.data.view.columns = [];
    rerendered.nodeElement.querySelector("[data-col-id]").remove();
    await settle();
    assert.equal(rerendered.saves.length, 0);
    assert.equal(rerendered.closed(), 1);
    assert.equal(document.querySelector(".av__richtext-mask"), null);
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
        const sources = Object.fromEntries(["richTextEditor", "editorSession", "selectionState"].map(name => ["./" + name,
            ts.transpileModule(readFileSync(path.join(__dirname, `../src/protyle/render/av/${name}.ts`), "utf8"),
                {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020}}).outputText]));
        await win.loadURL("data:text/html,<html><body></body></html>");
        await win.webContents.executeJavaScript(`(${runCases.toString()})(${JSON.stringify(sources)})`);
        console.log("AV rich text editor lifecycle cases passed");
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
    require("node:test").it("keeps rich text input and saving attached to the visible database row owner", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 45000,
    }, async () => {
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-av-rich-editor-"));
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 40000});
            assert.match(stdout, /AV rich text editor lifecycle cases passed/);
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(profile).startsWith("siyuan-av-rich-editor-"));
            rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
