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
    let request;
    let candidates;
    window.siyuan = {zIndex: 0, languages: {empty: "Empty", confirm: "Confirm",
        newFile: "New document", newSubDoc: "New subdocument", newFileAtPath: "Choose location"}};
    const hiddenElement = () => {
        const element = document.createElement("div");
        element.className = "fn__none";
        return element;
    };
    const hintDependencies = {
        hasClosestBlock: node => node.parentElement?.closest("[data-node-id]"),
        getEditorRange: () => ({startContainer: fragment.input.firstChild}),
        isEncryptedBox: id => id === "encrypted-box",
        fetchPost: (url, params, callback) => {
            assert.equal(url, "/api/search/searchRefBlock");
            request = params;
            callback({data: {newDoc: true, k: "New document", blocks: []}});
        },
        Lute: {UnEscapeHTMLStr: value => value, Caret: "caret"},
        replaceFileName: value => value,
        getDailyNoteHints: async () => [],
        Constants: {ZWSP: "\u200b"},
    };
    const hintRef = new Function(...Object.keys(hintDependencies), "exports", sources.hintRef + "\nreturn exports.hintRef;")(
        ...Object.values(hintDependencies), {});
    const dependencies = {
        "../../../util/escape": {escapeHtml: value => value},
        "../../../util/functions": {isMobile: () => mobile},
        "../../../mobile/util/mobileAppUtil": {callMobileAppShowKeyboard: () => {}},
        "../../hint/extend": {hintRef, hintSlash: () => []},
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
                        lite: true,
                        block: {},
                        notebookId: options.protyleOptions.notebookId,
                        options: options.protyleOptions,
                        hint: {
                            element: hiddenElement(),
                            prepareCreateTarget: () => ({promise: Promise.resolve(false), isCurrent: () => true}),
                            genLoading() {},
                            genHTML: items => { candidates = items; },
                        },
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
    const createOwner = (standalone, notebookId = "box") => {
        const owner = document.createElement("div");
        owner.className = standalone ? `protyle-db-row${mobile ? " protyle-db-row--mobile" : ""}` : "protyle";
        owner.innerHTML = '<div data-type="NodeAttributeView"><div class="av__row" data-id="row"><div data-col-id="text"></div></div></div>';
        document.body.replaceChildren(owner);
        const nodeElement = owner.firstElementChild;
        nodeElement.dataset.nodeId = "carrier-block";
        const anchorElement = nodeElement.querySelector("[data-col-id]");
        const value = {id: "value", keyID: "text", blockID: "row", type: "text", text: {content: "Initial"}};
        const column = {id: "text", type: "text"};
        const cell = {id: "value", value};
        const stableCells = [{groupID: "", rowID: "row", colID: "text", rowIndex: 0, colIndex: 0, cell, column}];
        const data = {viewType: "table", view: {columns: [column], rows: [{id: "row", cells: [cell]}]}};
        dataByElement.set(nodeElement, data);
        const saves = [];
        let closed = 0;
        const protyle = {element: standalone ? document.createElement("div") : owner,
            notebookId, path: "/document.sy", block: {rootID: "document"}};
        editor.openAVRichTextEditor({protyle, nodeElement, anchorElement, value, stableCells,
            onSave: (...args) => saves.push(args), onDestroy: () => closed++});
        return {owner, protyle, nodeElement, anchorElement, value, stableCells, saves, data, closed: () => closed};
    };
    // 文本字段块引复用真实文档上下文，不把临时段落或数据库条目当作搜索来源。
    for (const isMobile of [false, true]) {
        mobile = isMobile;
        for (const standalone of [false, true]) {
            for (const notebookId of ["box", "encrypted-box"]) {
                const state = createOwner(standalone, notebookId);
                for (const splitChar of ["((", "（（", "[[", "【【"]) {
                    fragment.protyle.hint.splitChar = splitChar;
                    const hint = fragment.protyle.options.hint.extend.find(item => item.key === splitChar);
                    hint.hint("New document", fragment.protyle, "hint");
                    await settle();
                    assert.equal(request.id, "carrier-block");
                    assert.equal(request.rootID, "document");
                    assert.equal(request.isDatabase, false);
                    assert.equal(request.isSquareBrackets, ["[[", "【【"].includes(splitChar));
                    assert.equal(request.notebook, notebookId === "encrypted-box" ? notebookId : undefined);
                    assert.equal(fragment.protyle.path, state.protyle.path);
                    assert.equal(candidates.length, 3);
                    assert.ok(candidates[0].value.startsWith("((newFile "));
                    assert.ok(candidates[1].value.startsWith("((newSubDoc "));
                    assert.ok(candidates[2].value.startsWith("((newFileAtPath "));
                }
                editor.destroyAVRichTextEditor();
                await settle();
            }
        }
    }
    for (const mode of ["document", "desktop-row", "mobile-row"]) {
        mobile = mode === "mobile-row";
        const state = createOwner(mode !== "document");
        if (mobile) {
            const toolbar = document.createElement("div");
            toolbar.className = "keyboard";
            toolbar.style.zIndex = "100";
            document.body.append(toolbar);
            const confirm = document.querySelector('[data-type="confirm"]');
            assert.equal(document.querySelectorAll(".av__richtext-actions button").length, 1);
            assert.equal(confirm.textContent, window.siyuan.languages.confirm);
            const rect = confirm.getBoundingClientRect();
            assert.ok(rect.bottom <= toolbar.getBoundingClientRect().top, "actions must remain above the keyboard toolbar");
            assert.ok(confirm.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)),
                "mobile actions must receive pointer events");
        }
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
            document.querySelector('[data-type="confirm"]').click();
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

        if (mobile) {
            const unchanged = createOwner(true);
            document.querySelector('[data-type="confirm"]').click();
            await settle();
            assert.equal(unchanged.saves.length, 0);
            assert.equal(unchanged.closed(), 1);
            assert.equal(document.querySelector(".av__richtext-mask"), null);

            const returned = createOwner(true);
            fragment.pendingInput = "pending";
            editor.destroyAVRichTextEditor(true);
            await settle();
            assert.equal(returned.saves[0][0].text.content, "Initialpending");
            assert.equal(returned.closed(), 1);
            assert.equal(document.querySelector(".av__richtext-mask"), null);
        }

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
        const sources = Object.fromEntries(["richTextEditor", "editorSession", "selectionState", "capabilities", "capabilities.generated"].map(name => ["./" + name,
            ts.transpileModule(readFileSync(path.join(__dirname, `../src/protyle/render/av/${name}.ts`), "utf8"),
                {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020}}).outputText]));
        const hintSource = ts.createSourceFile("extend.ts", readFileSync(path.join(__dirname,
            "../src/protyle/hint/extend.ts"), "utf8"), ts.ScriptTarget.Latest, true);
        sources.hintRef = ts.transpileModule(hintSource.statements.filter(ts.isVariableStatement).find(statement =>
            statement.declarationList.declarations.some(declaration => declaration.name.getText(hintSource) === "hintRef"))
            .getText(hintSource), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020}}).outputText;
        await win.loadURL("data:text/html,<html><body></body></html>");
        await win.webContents.insertCSS(require("sass").compile(path.join(__dirname, "../src/assets/scss/mobile.scss"),
            {logger: {warn() {}}}).css);
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
