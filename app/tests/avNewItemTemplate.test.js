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
    window.siyuan = {languages: new Proxy({...sources.languages, untitled: "Untitled"}, {get: (target, key) => target[key] || key}),
        notebooks: [], config: {editor: {databaseAttrShow: true}}};
    window.Lute = {NewNodeID: () => "new-template"};
    const dateModules = {};
    const loadDate = name => {
        if (dateModules[name]) return dateModules[name];
        const exports = dateModules[name] = {};
        if (!sources.dates[name]) return exports;
        new Function("require", "exports", sources.dates[name])(request => {
            if (request === "dayjs") return require("dayjs");
            if (request.endsWith("lunar_calendar_data.json")) return sources.lunarData;
            return loadDate(require("node:path").posix.normalize(require("node:path").posix.join(require("node:path").posix.dirname(name), request)));
        }, exports);
        return exports;
    };
    const fieldEditor = loadDate("protyle/render/av/fieldValueEditor");
    const calls = [];
    const pending = [];
    let dialog;
    let saved;
    let holdTransactions = false;
    const writes = [];
    const api = load(sources.template, {
        "../../../dialog/mobileDialog": {MobileDialog: class {
            pending = false;
            constructor(options) {
                this.element = document.createElement("div");
                this.element.innerHTML = options.content;
                document.body.append(this.element);
                dialog = {element: this.element, destroy: () => this.destroy()};
            }
            destroy() { if (!this.pending) this.element.remove(); }
            async runPending(task) {
                if (this.pending) return false;
                this.pending = true;
                let success = false;
                try { success = await task(); } catch { success = false; }
                this.pending = false;
                if (success) this.destroy();
                return success;
            }
        }},
        "../../../util/functions": {isMobile: () => mobile},
        "../../../util/escape": {escapeHtml: String, escapeAttr: String},
        "./blockIcon": {getAVBlockIconHTML: () => ""},
        "./view": {getFieldsByData: data => data.fields || []},
        "./capabilities": loadDate("protyle/render/av/capabilities"),
        "./col": {getColIconByType: () => "iconCalendar"},
        "./fieldValueEditor": fieldEditor,
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
        "./render": {avRender(_block, _protyle, _callback, _all, _data, automaticRefresh) {
            assert.equal(automaticRefresh, true, "creation and template settings must preserve unrelated row results");
        }},
        "../../wysiwyg/transaction": {transaction: (_protyle, operations, undo, options) => {
            assert.equal(options.awaitResponse, true);
            saved = {operations, undo};
            if (holdTransactions) return new Promise((resolve, reject) => writes.push({resolve, reject}));
        }},
        "./openDatabaseRow": {openDatabaseRowByData: (_protyle, data, options) => calls.push({data, options})},
        "../../../dialog/message": {showMessage() {}},
    });
    const block = document.createElement("div");
    Object.assign(block.dataset, {avId: "database", nodeId: "carrier", avType: "table"});
    document.body.append(block);
    const protyle = {id: "session", notebookId: "notebook", block: {rootID: "carrier"}, app: {appId: "app"}, options: {}};

    const dateField = {id: "date", name: "Date", type: "date", date: {fillSpecificTime: true}};
    const dateTemplate = {id: "date-template", name: "Date", targetType: "detached", fieldValues: {
        date: {mode: "static", value: {type: "date", date: {content: new Date("2024-02-28T13:45").getTime(), isNotEmpty: true, isNotTime: false}}},
    }};
    const dateData = {id: "database", fields: [dateField], newItemTemplates: [dateTemplate]};
    api.openNewItemTemplateDialog({protyle, blockElement: block, data: dateData});
    const dateHost = dialog.element.querySelector("[data-field-date-host]");
    const dateInput = dateHost.querySelector('[data-role="field-value"]');
    const mode = dialog.element.querySelector('[data-role="field-mode"]');
    assert.equal(dateHost.querySelector(".date-picker__calendar"), null, "template dates stay collapsed until focused");
    dateInput.focus();
    assert.ok(dateHost.querySelector(".date-picker__calendar"), "focusing a template date expands its calendar in the existing editor");
    assert.equal(dateInput.value, "2024-02-28");
    assert.equal(dateInput.closest(".date-picker__split").querySelector('[data-date-picker-part="time"]').value, "13:45");
    for (let index = 0; index < 2; index++) {
        mode.focus();
        mode.value = "currentTime"; mode.dispatchEvent(new Event("change"));
        assert.equal(dateHost.classList.contains("fn__none"), true);
        mode.focus();
        mode.value = "static"; mode.dispatchEvent(new Event("change"));
        assert.equal(dateHost.classList.contains("fn__none"), false);
        assert.equal(dateHost.querySelectorAll(".date-picker__calendar").length, 1);
    }
    dateInput.value = "2024-03-01T15:30";
    dateInput.dispatchEvent(new Event("input", {bubbles: true}));
    dateInput.dispatchEvent(new Event("change", {bubbles: true}));
    assert.equal(saved, undefined, "editing dates only changes the template draft");
    dialog.element.querySelector('[data-role="cancel"]').click();
    assert.equal(saved, undefined, "cancel does not write a template transaction");
    assert.equal(dateTemplate.fieldValues.date.value.date.content, new Date("2024-02-28T13:45").getTime());
    api.openNewItemTemplateDialog({protyle, blockElement: block, data: dateData});
    const savedInput = dialog.element.querySelector('[data-role="field-value"]');
    savedInput.value = "not-a-date";
    savedInput.dispatchEvent(new Event("input", {bubbles: true}));
    const beforeInvalid = saved;
    dialog.element.querySelector('[data-role="confirm"]').click();
    assert.equal(saved, beforeInvalid, "invalid dates cannot be persisted by the template host");
    assert.equal(dialog.element.isConnected, true);
    savedInput.value = "2024-03-01T15:30";
    savedInput.dispatchEvent(new Event("input", {bubbles: true}));
    dialog.element.querySelector('[data-role="confirm"]').click();
    assert.equal(saved.operations[0].data.templates[0].fieldValues.date.value.date.content, new Date("2024-03-01T15:30").getTime());
    await new Promise(resolve => setTimeout(resolve, 0));
    api.openNewItemTemplateDialog({protyle, blockElement: block, data: dateData});
    const dynamicMode = dialog.element.querySelector('[data-role="field-mode"]');
    dynamicMode.value = "currentTime"; dynamicMode.dispatchEvent(new Event("change"));
    dialog.element.querySelector('[data-role="confirm"]').click();
    assert.equal(saved.operations[0].data.templates[0].fieldValues.date.mode, "currentTime");
    assert.equal(saved.operations[0].data.templates[0].fieldValues.date.value, undefined, "dynamic dates remain dynamic");
    await new Promise(resolve => setTimeout(resolve, 0));
    dateField.dateFormat = "lunar";
    api.openNewItemTemplateDialog({protyle, blockElement: block, data: dateData});
    const lunarTrigger = dialog.element.querySelector('[data-value-type="lunarDate"]');
    lunarTrigger.click();
    assert.ok(dialog.element.querySelector("[data-lunar-endpoint]"), "template lunar controls expand inside its field");
    assert.equal(document.querySelector('[data-menu="av-field-lunar-date"]'), null);
    const lunarDay = dialog.element.querySelector('[data-lunar-part="day"]');
    lunarDay.value = lunarDay.value === "1" ? "2" : "1";
    lunarDay.dispatchEvent(new Event("change", {bubbles: true}));
    const beforeLunarCancel = saved;
    dialog.element.querySelector('[data-role="cancel"]').click();
    assert.equal(saved, beforeLunarCancel, "cancelling a lunar template draft does not persist");
    api.openNewItemTemplateDialog({protyle, blockElement: block, data: dateData});
    dialog.element.querySelector('[data-value-type="lunarDate"]').click();
    const pendingDay = dialog.element.querySelector('[data-lunar-part="day"]');
    pendingDay.value = pendingDay.value === "1" ? "2" : "1";
    pendingDay.dispatchEvent(new Event("change", {bubbles: true}));
    dialog.element.querySelector('[data-role="confirm"]').click();
    assert.notEqual(saved.operations[0].data.templates[0].fieldValues.date.value.date.content,
        dateTemplate.fieldValues.date.value.date.content, "host confirmation flushes the inline lunar draft");
    await new Promise(resolve => setTimeout(resolve, 0));
    delete dateField.dateFormat;
    for (const targetType of ["detached", "document"]) {
        for (const view of ["table", "list", "gallery", "kanban", "calendar"]) {
            for (const preference of [undefined, false, true]) {
                block.dataset.avType = view;
                const template = {id: "template", name: "Template", targetType};
                if (preference !== undefined) template.openAfterCreate = preference;
                const data = {id: "database", newItemTemplates: [template]};
                api.openNewItemTemplateDialog({protyle, blockElement: block, data});
                const checkbox = dialog.element.querySelector('[data-role="open-after-create"]');
                assert.equal(checkbox.value, (preference ?? view === "calendar") ? "right" : "none");
                assert.equal(checkbox.closest('[data-role="document-options"]'), null);
                dialog.element.querySelector('[data-role="template-name"]').value = "Renamed";
                dialog.element.querySelector('[data-role="confirm"]').click();
                assert.equal(saved.operations[0].data.templates[0].openAfterCreate, preference,
                    "unrelated template edits must preserve an omitted preference");
                assert.equal(saved.undo[0].data.templates[0].openAfterCreate, preference);
                dialog.destroy();

                api.openNewItemTemplateDialog({protyle, blockElement: block, data});
                const toggle = dialog.element.querySelector('[data-role="open-after-create"]');
                toggle.value = toggle.value === "none" ? "right" : "none";
                toggle.dispatchEvent(new Event("change"));
                dialog.element.querySelector('[data-role="confirm"]').click();
                assert.equal(saved.operations[0].data.templates[0].openAfterCreate, toggle.value !== "none");
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
    assert.equal(dialog.element.querySelector('[data-role="open-after-create"]').value, "none");
    dialog.element.querySelector('[data-role="confirm"]').click();
    assert.equal(saved.operations[0].data.templates[0].openAfterCreate, false);
    dialog.destroy();
    for (const targetType of ["detached", "document"]) {
        const template = {id: "current", name: "Current", targetType, openAfterCreate: true, openInCurrentTab: true};
        api.openNewItemTemplateDialog({protyle, blockElement: block, data: {id: "database", newItemTemplates: [template]}});
        assert.equal(dialog.element.querySelector('[data-role="open-after-create"]').value, "current");
        dialog.element.querySelector('[data-role="confirm"]').click();
        assert.equal(saved.operations[0].data.templates[0].openInCurrentTab, true);
        dialog.destroy();
        api.createAttributeViewItem({protyle, blockElement: block, templateID: "current"});
        pending.pop().callback({code: 0, data: {itemID: "created", blockID: "document", content: "Title",
            isDetached: targetType === "detached", openAfterCreate: true, openInCurrentTab: true}});
        await new Promise(resolve => setTimeout(resolve, 0));
        assert.deepEqual(calls.at(-1).options, {currentPane: true});
    }
    await new Promise(resolve => setTimeout(resolve, 0));
    holdTransactions = true;
    api.openNewItemTemplateDialog({protyle, blockElement: block, data: {id: "database"}, createNew: true});
    const draft = dialog.element.querySelector('[data-role="template-name"]');
    draft.value = "Retry template";
    const confirm = dialog.element.querySelector('[data-role="confirm"]');
    confirm.click();
    confirm.click();
    dialog.destroy();
    assert.equal(writes.length, 1, "pending template saves are deduplicated");
    assert.equal(dialog.element.isConnected, true);
    writes[0].reject(new Error("save failed"));
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(dialog.element.isConnected, true, "failed persistence retains the template editor");
    assert.equal(draft.value, "Retry template");
    confirm.click();
    assert.equal(writes.length, 2);
    writes[1].resolve();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(dialog.element.isConnected, false);
    holdTransactions = false;

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
    root.innerHTML = '<div id="toolbarNameReadonly" contenteditable="true">Mobile title</div><div contenteditable="true">Document title</div>' +
        '<div data-av-id="database"><div data-primary="true"><div data-row-id="created"><input value="Primary title"></div></div></div>';
    document.body.append(root);
    const title = mobile ? root.querySelector("#toolbarNameReadonly") : root.querySelector("div:nth-child(2)");
    const input = root.querySelector("[data-row-id] input");
    let titleOpenings = 0;
    const target = {...protyle, notebookId: "document", block: {rootID: "document"}, title: {editElement: title,
        openEditor: async isValid => {
            assert.equal(isValid(), true);
            titleOpenings++;
            title.focus();
            const range = document.createRange();
            range.selectNodeContents(title);
            range.collapse(false);
            getSelection().removeAllRanges();
            getSelection().addRange(range);
        }}};
    if (mobile) window.siyuan.mobile = {editor: {protyle: target}};
    const focusRequest = () => ({avID: "database", itemID: "created", boundBlockID: "document", focusPrimary: true, focusTitle: true});
    const request = focusRequest();
    primary.focusDatabasePrimary(root, target, request);
    assert.equal(document.activeElement, title);
    assert.equal(titleOpenings, 1, "notebook documents focus through the full title editor");
    {
        const beforeCaret = document.createRange();
        beforeCaret.selectNodeContents(title);
        beforeCaret.setEnd(getSelection().anchorNode, getSelection().anchorOffset);
        assert.equal(beforeCaret.toString().length, title.textContent.length);
    }
    input.focus();
    primary.focusDatabasePrimary(root, target, request);
    assert.equal(document.activeElement, input, "refresh must not focus the title again");
    title.style.display = "none";
    document.activeElement.blur();
    primary.focusDatabasePrimary(root, target, focusRequest());
    assert.equal(document.activeElement, input, "hidden titles fall back to the primary key");
    title.style.display = "";
    document.activeElement.blur();
    primary.focusDatabasePrimary(root, {...target, block: {rootID: "carrier"}}, focusRequest());
    assert.equal(document.activeElement, input, "standalone row previews must not focus the carrier title");
    for (const mode of ["disabled", "publish", "created", "snapshot"]) {
        document.activeElement.blur();
        window.siyuan.isPublish = mode === "publish";
        primary.focusDatabasePrimary(root, {...target, disabled: mode === "disabled", options: {history: {[mode]: "archive"}}}, focusRequest());
        assert.notEqual(document.activeElement, title);
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
    app.setPath("userData", process.argv.at(-1));
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
            sources.lunarData = JSON.parse(readFileSync(path.join(__dirname, "../../kernel/av/lunar_calendar_data.json"), "utf8"));
            sources.languages = JSON.parse(readFileSync(path.join(__dirname, "../appearance/langs/zh-CN.json"), "utf8"));
            sources.dates = Object.fromEntries(["datePicker/model", "datePicker/yearInput", "datePicker/field", "datePicker/inline",
                "protyle/render/av/fieldValueEditor", "protyle/render/av/lunarDate", "protyle/render/av/lunarCalendar", "protyle/render/av/dateFormat", "protyle/render/av/dateSubmit", "protyle/render/av/capabilities", "protyle/render/av/capabilities.generated", "util/escape"].map(name =>
                [name, ts.transpileModule(readFileSync(path.join(__dirname, `../src/${name}.ts`), "utf8"), {
                    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021},
                }).outputText]));
            await win.loadURL("data:text/html,<html><body></body></html>");
            win.show();
            win.focus();
            if (!win.webContents.debugger.isAttached()) win.webContents.debugger.attach("1.3");
            await win.webContents.debugger.sendCommand("Emulation.setFocusEmulationEnabled", {enabled: true});
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
        timeout: 60000,
    }, async () => {
        const env = {...process.env, XDG_CACHE_HOME: path.join(os.tmpdir(), "siyuan-template-cache")};
        delete env.ELECTRON_RUN_AS_NODE;
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-new-item-template-"));
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [...(process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY ? ["--no-sandbox", "--disable-gpu", "--ozone-platform=headless"] : []), __filename, profile], {env, windowsHide: true, timeout: 55000});
            assert.equal(stdout.match(/Template opening cases passed/g)?.length, 2);
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(profile).startsWith("siyuan-new-item-template-"));
            rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
