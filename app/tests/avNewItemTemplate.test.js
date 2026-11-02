const assert = require("node:assert/strict");
const {readFileSync, mkdtempSync, rmSync} = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const runCases = async (sources, mobile) => {
    const assert = require("node:assert/strict");
    const load = (source, imports) => {
        const exports = {};
        new Function("require", "exports", source)(name => imports[name] || {}, exports);
        return exports;
    };
    window.siyuan = {languages: new Proxy({untitled: "Untitled"}, {get: (target, key) => target[key] || key}),
        notebooks: [], config: {editor: {databaseAttrShow: true}}};
    window.Lute = {NewNodeID: () => "new-template"};
    const calls = [];
    const pending = [];
    let dialog;
    let saved;
    const api = load(sources.template, {
        "../../../dialog": {Dialog: class {
            constructor(options) {
                this.element = document.createElement("div");
                this.element.innerHTML = options.content;
                document.body.append(this.element);
                dialog = {element: this.element, destroy: () => this.destroy()};
            }
            destroy() { this.element.remove(); }
        }},
        "../../../util/functions": {isMobile: () => mobile},
        "../../../util/escape": {escapeHtml: String, escapeAttr: String},
        "./blockIcon": {getAVBlockIconHTML: () => ""},
        "./view": {getFieldsByData: () => []},
        "./fieldValueEditor": {bindFieldLunarDates() {}},
        "../../../constants": {Constants: {CUSTOM_SY_AV_VIEW: "custom-sy-av-view"}},
        "../../../util/fetch": {fetchSyncPost: (url, data) => {
            assert.equal(url, "/api/av/createAttributeViewItem");
            return new Promise(resolve => pending.push({data, callback: resolve}));
        }},
        "../../../util/documentSelectionRequest": {fetchWithDocumentSelection: async (send, options) => {
            const response = await send();
            return options.isValid() ? response : undefined;
        }},
        "./calendar/state": {getCalendarCreationDate: () => 123},
        "./render": {avRender() {}},
        "../../wysiwyg/transaction": {transaction: (_protyle, operations, undo) => { saved = {operations, undo}; }},
        "./openDatabaseRow": {openDatabaseRowByData: (_protyle, data, options) => calls.push({data, options})},
        "../../../dialog/message": {showMessage() {}},
        "../../../mobile/util/bindBottomSheetDialog": {bindBottomSheetDialog: () => () => {}},
        "../../../mobile/util/keyboardToolbar": {activeBlur() {}},
    });
    const block = document.createElement("div");
    Object.assign(block.dataset, {avId: "database", nodeId: "carrier", avType: "table"});
    document.body.append(block);
    const protyle = {id: "session", notebookId: "notebook", block: {rootID: "carrier"}, app: {appId: "app"}, options: {}};

    for (const targetType of ["detached", "document"]) {
        for (const view of ["table", "list", "gallery", "kanban", "calendar"]) {
            for (const preference of [undefined, false, true]) {
                block.dataset.avType = view;
                const template = {id: "template", name: "Template", targetType};
                if (preference !== undefined) template.openAfterCreate = preference;
                const data = {id: "database", newItemTemplates: [template]};
                api.openNewItemTemplateDialog({protyle, blockElement: block, data});
                const checkbox = dialog.element.querySelector('[data-role="open-after-create"]');
                assert.equal(checkbox.checked, preference ?? view === "calendar");
                assert.equal(checkbox.closest('[data-role="document-options"]'), null);
                dialog.element.querySelector('[data-role="template-name"]').value = "Renamed";
                dialog.element.querySelector('[data-role="confirm"]').click();
                assert.equal(saved.operations[0].data.templates[0].openAfterCreate, preference,
                    "unrelated template edits must preserve an omitted preference");
                assert.equal(saved.undo[0].data.templates[0].openAfterCreate, preference);
                dialog.destroy();

                api.openNewItemTemplateDialog({protyle, blockElement: block, data});
                const toggle = dialog.element.querySelector('[data-role="open-after-create"]');
                toggle.click();
                dialog.element.querySelector('[data-role="confirm"]').click();
                assert.equal(saved.operations[0].data.templates[0].openAfterCreate, toggle.checked);
                assert.equal(template.openAfterCreate, preference, "dialog must not mutate its input");
                dialog.destroy();

                const before = calls.length;
                api.createAttributeViewItem({protyle, blockElement: block, templateID: "template"});
                const request = pending.pop();
                assert.equal(request.data.templateID, "template");
                // A view switch while the request is pending must not change legacy calendar behavior.
                block.dataset.avType = view === "calendar" ? "table" : "calendar";
                request.callback({code: 0, data: {itemID: "created", blockID: "document", content: "Template title",
                    isDetached: targetType === "detached", openAfterCreate: preference}});
                await new Promise(resolve => setTimeout(resolve, 0));
                assert.equal(calls.length - before, Number(preference ?? view === "calendar"));
                if (calls.length > before) {
                    const opened = calls.at(-1);
                    assert.equal(opened.options, undefined, "use the existing split-opening behavior");
                    assert.equal(opened.data.focusPrimary, true);
                    assert.equal(opened.data.focusTitle, preference === true && targetType === "document");
                    assert.equal(opened.data.itemID, "created");
                }
            }
        }
    }
    api.openNewItemTemplateDialog({protyle, blockElement: block, data: {id: "database"}, createNew: true});
    assert.equal(dialog.element.querySelector('[data-role="open-after-create"]').checked, false);
    dialog.element.querySelector('[data-role="confirm"]').click();
    assert.equal(saved.operations[0].data.templates[0].openAfterCreate, false);
    dialog.destroy();

    for (const failure of ["error", "unavailable", "closed", "readonly"]) {
        const before = calls.length;
        api.createAttributeViewItem({protyle, blockElement: block});
        if (failure === "closed") block.remove();
        if (failure === "readonly") protyle.disabled = true;
        pending.pop().callback(failure === "unavailable" ? {code: 1, data: {unavailableNotebook: true}} : {
            code: failure === "error" ? -1 : 0,
            data: {itemID: "created", openAfterCreate: true, isDetached: true},
        });
        await new Promise(resolve => setTimeout(resolve, 0));
        assert.equal(calls.length, before);
        document.body.append(block);
        protyle.disabled = false;
    }

    // 真实 DOM 聚焦：笔记本标题、隐藏标题回退、独立主键及移动端标题。
    const primary = load(sources.primary, {
        "../../util/selection": {focusByOffset: (element, start, end) => {
            assert.equal(start, end);
            const selection = getSelection();
            const range = document.createRange();
            range.selectNodeContents(element);
            range.collapse(false);
            selection.removeAllRanges();
            selection.addRange(range);
        }},
        "./cell": {popTextCell: () => assert.fail("the editable primary has an input")},
    });
    const root = document.createElement("div");
    root.innerHTML = '<input id="toolbarName" value="Mobile title"><div contenteditable="true">Document title</div>' +
        '<div data-av-id="database"><div data-primary="true"><div data-row-id="created"><input value="Primary title"></div></div></div>';
    document.body.append(root);
    const title = root.querySelector("[contenteditable]");
    const titleInput = root.querySelector("#toolbarName");
    const input = root.querySelector("[data-row-id] input");
    const target = {...protyle, notebookId: "document", block: {rootID: "document"}, title: {editElement: title}};
    const focusRequest = () => ({avID: "database", itemID: "created", boundBlockID: "document", focusPrimary: true, focusTitle: true});
    const request = focusRequest();
    primary.focusDatabasePrimary(root, target, request);
    assert.equal(document.activeElement, mobile ? titleInput : title);
    if (mobile) {
        assert.equal(titleInput.selectionStart, titleInput.value.length);
    } else {
        const beforeCaret = document.createRange();
        beforeCaret.selectNodeContents(title);
        beforeCaret.setEnd(getSelection().anchorNode, getSelection().anchorOffset);
        assert.equal(beforeCaret.toString().length, title.textContent.length);
    }
    input.focus();
    primary.focusDatabasePrimary(root, target, request);
    assert.equal(document.activeElement, input, "refresh must not focus the title again");
    (mobile ? titleInput : title).style.display = "none";
    document.activeElement.blur();
    primary.focusDatabasePrimary(root, target, focusRequest());
    assert.equal(document.activeElement, input, "hidden titles fall back to the primary key");
    (mobile ? titleInput : title).style.display = "";
    document.activeElement.blur();
    primary.focusDatabasePrimary(root, {...target, block: {rootID: "carrier"}}, focusRequest());
    assert.equal(document.activeElement, input, "standalone row previews must not focus the carrier title");
    for (const mode of ["disabled", "publish", "created", "snapshot"]) {
        document.activeElement.blur();
        window.siyuan.isPublish = mode === "publish";
        primary.focusDatabasePrimary(root, {...target, disabled: mode === "disabled", options: {history: {[mode]: "archive"}}}, focusRequest());
        assert.notEqual(document.activeElement, mobile ? titleInput : title);
        assert.notEqual(document.activeElement, input);
    }
    root.remove();
    block.remove();

    // Compose the real title-loading and readonly paths with template focus. The source and mobile
    // editor chunk deliberately remain pending while the attribute panel finishes rendering.
    window.siyuan.isPublish = false;
    for (const invalidation of ["none", "disabled", "readonly", "publish", "history", "root", "notebook",
        "destroyed", "detached", "replaced", "source-replaced", "hidden", ...(mobile ? ["mobile-editor"] : [])]) {
        window.siyuan.config.readonly = false;
        window.siyuan.isPublish = false;
        const host = document.createElement("div");
        host.innerHTML = '<input id="toolbarName" value="Template title"><span id="toolbarNameReadonly">Template title</span>' +
            '<div contenteditable="true">Template title</div>' +
            '<div data-av-id="database"><div data-primary="true"><div data-row-id="created"><input value="Template title"></div></div></div>';
        document.body.append(host);
        const toolbar = host.querySelector("#toolbarName");
        const plain = host.querySelector("[contenteditable]");
        const field = host.querySelector("[data-row-id] input");
        const owner = {app: {}, element: host, options: {}, block: {rootID: "document"}, notebookId: "notebook",
            preview: {element: document.createElement("div")}};
        owner.preview.element.className = "fn__none";
        window.siyuan.mobile = {editor: {protyle: owner}};
        let resolveSource;
        let sourceRequests = 0;
        let focused = 0;
        const {Title} = load(sources.title, {
            "../../util/fetch": {fetchSyncPost: (url, data) => {
                assert.equal(url, "/api/block/getDocTitle");
                assert.deepEqual(data, {id: "document", notebook: "notebook"});
                sourceRequests++;
                return new Promise(resolve => { resolveSource = resolve; });
            }},
            "../render/autoDirection": {setTitleAutoDirection() {}},
            "../../mobile/util/mobileDocumentTitle": {updateMobileDocumentTitle() {}},
            "../../mobile/util/mobileAppUtil": {callMobileAppShowKeyboard() {}},
            "./documentTitleEditor": {DocumentTitleEditor: class {
                constructor(_owner, element, initial, onEditable) {
                    this.element = document.createElement("div");
                    this.element.contentEditable = "true";
                    this.element.textContent = initial.text;
                    element.append(this.element);
                    this.fragment = {protyle: {element}};
                    onEditable(this.element);
                }
                focus() { focused++; this.element.focus(); }
                destroy() { this.element.remove(); }
            }},
        });
        const title = Object.assign(Object.create(Title.prototype), {
            protyle: owner, editElement: mobile ? undefined : plain, sourceRequest: 0, element: document.createElement("div"),
        });
        owner.title = title;
        if (mobile) {
            load(sources.editMode, {}).updateMobileTitleReadonly(owner);
            assert.equal(toolbar.readOnly, true, "the live mobile toolbar is a readonly rich-title summary");
        }
        const loading = mobile ? undefined : title.refresh();
        if (!mobile) assert.equal(plain.isContentEditable, false, "source loading locks the plain title");
        const request = focusRequest();
        const opening = primary.focusDatabasePrimary(host, owner, request);
        assert.ok(opening instanceof Promise);
        assert.notEqual(document.activeElement, field, "pending source focus must not fall back to the primary field");
        assert.equal(primary.focusDatabasePrimary(host, owner, request), undefined, "refresh cannot duplicate pending focus");
        if (invalidation === "disabled") owner.disabled = true;
        if (invalidation === "readonly") window.siyuan.config.readonly = true;
        if (invalidation === "publish") window.siyuan.isPublish = true;
        if (invalidation === "history") owner.options.history = {created: "archive"};
        if (invalidation === "root") owner.block.rootID = "another-document";
        if (invalidation === "notebook") owner.notebookId = "another-notebook";
        if (invalidation === "destroyed") title.destroy();
        if (invalidation === "detached") host.remove();
        if (invalidation === "replaced") owner.title = {};
        if (invalidation === "source-replaced") title.sourceRequest++;
        if (invalidation === "hidden") host.style.display = "none";
        if (invalidation === "mobile-editor") window.siyuan.mobile.editor = {protyle: {}};
        assert.equal(sourceRequests, 1, "automatic focus shares the already pending title source");
        resolveSource({code: 0, data: {text: "Template title", blockDOM: "Template title", revision: "r0"}});
        await loading;
        await opening;
        const expected = invalidation === "none" ? 1 : 0;
        assert.equal(focused, expected, `${mobile ? "mobile" : "desktop"}: ${invalidation}`);
        if (expected) assert.equal(document.activeElement, title.editElement);
        primary.focusDatabasePrimary(host, owner, request);
        assert.equal(focused, expected, "source completion must not repeat focus on refresh");
        assert.notEqual(document.activeElement, field);
        if (expected) {
            await title.openEditor();
            assert.equal(focused, 2, "explicit title clicks still open without a caller guard");
        }
        host.remove();
    }
    return "Template opening cases passed";
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
        const ifdef = require("ifdef-loader");
        for (const mobile of [false, true]) {
            const sources = Object.fromEntries(Object.entries({template: "render/av/newItemTemplate", primary: "render/av/primaryFocus",
                title: "header/Title", editMode: "util/setEditMode"}).map(([key, file]) => {
                const source = readFileSync(path.join(__dirname, `../src/protyle/${file}.ts`), "utf8");
                let processed;
                ifdef.call({query: {MOBILE: mobile, BROWSER: false, "ifdef-triple-slash": true}, callback(error, result) {
                    if (error) throw error;
                    processed = result;
                }}, source);
                return [key, ts.transpileModule(processed, {
                    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021},
                }).outputText];
            }));
            await win.loadURL("data:text/html,<html><body></body></html>");
            const result = await win.webContents.executeJavaScript(`(async () => {
                try { return {message: await (${runCases.toString()})(${JSON.stringify(sources)}, ${mobile})}; }
                catch (error) { return {error: error.stack}; }
            })()`);
            assert.equal(result.error, undefined);
            console.log(result.message);
        }
    } catch (error) {
        console.error(error);
        exitCode = 1;
    } finally {
        win.destroy();
        app.exit(exitCode);
    }
};

if (process.versions.electron && process.type === "browser") {
    runElectron().catch(error => { console.error(error); require("electron").app.exit(1); });
} else {
    require("node:test").test("template creation preserves legacy behavior and opens and focuses bound and detached items on desktop and mobile", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 60000,
    }, async () => {
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-new-item-template-"));
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 55000});
            assert.equal(stdout.match(/Template opening cases passed/g)?.length, 2);
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(profile).startsWith("siyuan-new-item-template-"));
            rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
