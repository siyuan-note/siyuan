const assert = require("node:assert/strict");
const {readFileSync, mkdtempSync, rmSync} = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const sources = () => {
    const ts = require("typescript");
    const preprocess = require("ifdef-loader/preprocessor").parse;
    const modules = {};
    for (const name of ["layout/dock/BacklinkContent", "layout/dock/backlinkRefresh",
        "layout/dock/GlobalBacklinkList", "layout/dock/globalBacklinkPaging",
        "layout/dock/backlinkReadingAnchor", "layout/dock/backlinkSourceFilter", "mobile/util/secondaryEditors",
        "mobile/util/backlinkPanels", "mobile/util/openBacklinks", "mobile/util/bindBottomSheetDrag", "mobile/util/bindBottomSheetDialog", "menus/sheetOpen", "protyle/util/transactionQueue",
        "util/escape", "util/zIndex", "dialog/index", "layout/dock/panelSearch", "protyle/wysiwyg/backlinkTypeFold",
        "layout/dock/backlinkMentionCache", "layout/dock/bottomBacklinkScroll"]) {
        modules[name] = ts.transpileModule(preprocess(
            readFileSync(path.join(__dirname, "../src", name + ".ts"), "utf8"),
            {MOBILE: true, BROWSER: true}, false, true), {
            compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
        }).outputText;
    }
    return modules;
};

const runCases = async (sources) => {
    const assert = require("node:assert/strict");
    const cache = {};
    const noop = () => {};
    const requests = [];
    const tick = () => new Promise(resolve => setTimeout(resolve, 10));
    const stubs = {
        "editor/assetOpen": {normalizeAssetOpenConfig: value => value},
        "layout/dock/backlinkRefFilterMenu": {loadBacklinkRefFilterMenu: noop},
        "protyle/render/av/editorSession": {hasAVEditorSession: () => false},
        "layout/Model": {Model: class {constructor({app}) {this.app = app;} connect() {throw Error("mobile panel opened a desktop socket");}}},
        "util/Tree": {Tree: class {
            constructor(options) {this.element = options.element; this.options = options;}
            updateData() {this.element.replaceChildren();}
            createTopLevelItem(item) {
                const li = document.createElement("li");
                li.className = "b3-list-item";
                li.dataset.nodeId = item.id;
                li.dataset.notebookId = item.box;
                li.innerHTML = '<span><svg class="b3-list-item__arrow"></svg></span><span class="b3-list-item__text"></span>';
                li.lastElementChild.textContent = item.name;
                li.addEventListener("click", () => this.options.click(li));
                return li;
            }
        }},
        "mobile/editor": {openMobileFileById: noop},
        "util/fetch": {fetchPost: (url, data, callback) => new Promise(resolve => {
            requests.push({url, data, reply: response => {callback?.({code: 0, data: response}); resolve();}});
        }), fetchSyncPost: (url, data) => new Promise(resolve => {
            requests.push({url, data, reply: response => resolve({code: 0, data: response})});
        })},
        "constants": {Constants: {TIMEOUT_LOAD: 0, TIMEOUT_OPENDIALOG: 0, TIMEOUT_DBLCLICK: 0}},
        "protyle/util/compatibility": {updateHotkeyAfterTip: () => "", isNotCtrl: () => true},
        "protyle/index": {Protyle: class {
            constructor(app, element, options) {
                element.className = "protyle";
                element.innerHTML = '<div class="protyle-wysiwyg" contenteditable="true">reference context</div>';
                this.protyle = {app, element, notebookId: options.notebookId, block: {rootID: options.blockId}, options,
                    wysiwyg: {element: element.firstElementChild, flushPendingInput: async () => {}}};
            }
            destroy() {load("mobile/util/secondaryEditors").unregisterMobileSecondaryEditor(this); this.destroyed = true;}
        }},
        "menus/Menu": {MenuItem: class {}},
        "protyle/render/searchMarkRender": {isSupportCSSHL: () => true, searchMarkRender: noop},
        "util/pathName": {getDocDisplayName: item => item.name, isEncryptedBox: () => false},
        "layout/getAll": {getAllEditor: () => []},
        "util/functions": {isMobile: () => true},
        "protyle/ui/hideElements": {hideElements: noop},
        "protyle/wysiwyg/renderBacklink": {renderBacklink: async () => {}},
        "util/heightAnimation": {cancelHeightAnimation: noop, isHeightAnimating: () => false},
        "util/viewState": {ViewStateService: class {
            constructor() {this.ready = Promise.resolve(); this.values = new Map();}
            get(key) {return this.values.get(key);}
            set(key, value) {this.values.set(key, value);}
            has(key) {return this.values.has(key);}
            remove(key) {this.values.delete(key);}
            async destroy() {}
        }},
        "protyle/util/viewFold": {applyViewFoldStates: async () => {}, invalidateViewFoldRequests: noop,
            registerViewFoldContext: async () => {}, unregisterViewFoldContext: noop},
        "dialog/moveResize": {moveResize: noop},
        "util/genID": {genUUID: () => Math.random().toString()},
        "dialog/message": {showMessage: noop},
        "mobile/util/keyboardToolbar": {activeBlur: () => document.activeElement.blur()},
    };
    const load = name => {
        if (stubs[name]) {return stubs[name];}
        if (stubs[name + "/index"]) {return stubs[name + "/index"];}
        if (!sources[name] && sources[name + "/index"]) {return load(name + "/index");}
        if (!cache[name]) {
            assert.ok(sources[name], "unexpected module " + name);
            cache[name] = {};
            const resolve = dependency => load(require("node:path").posix.normalize(
                require("node:path").posix.dirname(name) + "/" + dependency));
            new Function("require", "exports", sources[name])(resolve, cache[name]);
        }
        return cache[name];
    };
    const style = document.createElement("style");
    style.textContent = ".fn__none{display:none!important}.protyle{min-height:32px}.panel{height:400px}";
    document.head.appendChild(style);
    const key = {custom: ""};
    window.siyuan = {config: {editor: {backlinkSort: 0, backmentionSort: 0, backlinkExpandCount: 0,
        backmentionExpandCount: 0}, keymap: {editor: {general: {expand: key, collapse: key}}, general: {closeTab: key}}},
    languages: new Proxy({}, {get: (target, property) => property}), dialogs: [], zIndex: 10,
    menus: {menu: {remove: noop, element: document.createElement("div")}}};
    const {BacklinkContent} = load("layout/dock/BacklinkContent");
    const registry = load("mobile/util/secondaryEditors");
    const panels = load("mobile/util/backlinkPanels");
    const element = document.createElement("div");
    element.className = "panel";
    document.body.appendChild(element);
    const panel = new BacklinkContent({app: {}, element, blockId: "host", rootId: "host", notebookId: "box",
        type: "local", surface: "mobile-sheet", onlyBacklinks: true});
    const unregister = panels.registerMobileBacklinkPanel(panel);
    await tick();
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, "/api/ref/getBacklink2");
    assert.equal(requests[0].data.includeMentions, false);
    const list = {box: "box", backlinks: [{id: "ref", box: "box", name: "Source", revision: "1"}],
        backmentions: [], linkRefsCount: 1, mentionsCount: 0, k: "", mk: "", revision: "list1"};
    requests.shift().reply(list);
    await tick();
    assert.equal(panel.editors.length, 0, "collapsed document must not allocate an editor");
    assert.equal(requests.length, 0, "collapsed document must not fetch context");
    element.querySelector('.b3-list-item[data-node-id="ref"]').click();
    assert.equal(requests[0].url, "/api/ref/getBacklinkDoc");
    requests.shift().reply({revision: "ctx1", backlinks: [{id: "ref-block"}], keywords: []});
    await tick();
    assert.equal(panel.editors.length, 1);
    const editor = panel.editors[0];
    assert.deepEqual(registry.getMobileSecondaryEditors(), [editor]);
    panel.markIndexDirty({backlinkChanged: true, backlinkFull: true});
    panel.refreshAfterIndex();
    const inFlight = requests.shift();
    editor.protyle.wysiwyg.element.focus();
    assert.equal(registry.getActiveMobileSecondaryEditor(), editor);
    inFlight.reply({...list, backlinks: [], linkRefsCount: 0, revision: "list2"});
    await tick();
    assert.equal(panel.editors[0], editor, "a response started before focus must not replace the active editor");
    panel.markIndexDirty({backlinkChanged: true, backlinkFull: true});
    panel.refreshAfterIndex();
    assert.equal(requests.length, 0, "index refresh must defer while editing");
    const toolbar = document.createElement("button");
    document.body.appendChild(toolbar);
    toolbar.dispatchEvent(new PointerEvent("pointerdown", {bubbles: true}));
    assert.equal(registry.getActiveMobileSecondaryEditor(), editor, "keyboard toolbar must keep its source editor");
    element.querySelector('.b3-list-item[data-node-id="ref"]').click();
    assert.equal(editor.destroyed, undefined, "folding must retain pending mobile input");
    assert.equal(registry.getActiveMobileSecondaryEditor(), undefined, "folded editor must stop receiving commands");
    element.querySelector('.b3-list-item[data-node-id="ref"]').click();
    let finishInput;
    editor.protyle.wysiwyg.flushPendingInput = () => new Promise(resolve => {finishInput = resolve;});
    editor.protyle.wysiwyg.element.focus();
    toolbar.focus();
    editor.protyle.wysiwyg.flushPendingInput = async () => {};
    let flushed = false;
    const flushing = registry.flushMobileSecondaryEditor(editor).then(() => {flushed = true;});
    await tick();
    assert.equal(flushed, false, "closing must await input already started by focusout");
    finishInput();
    await flushing;
    assert.equal(flushed, true);
    editor.protyle.wysiwyg.element.focus();
    const main = document.createElement("div");
    main.className = "protyle";
    main.innerHTML = '<div contenteditable="true">main document</div>';
    document.body.appendChild(main);
    main.firstElementChild.focus();
    assert.equal(registry.getActiveMobileSecondaryEditor(), undefined, "keyboard focus must return commands to the main editor");
    panels.removeMobileBacklinkContent({notebookId: "box"});
    assert.equal(panel.editors.length, 0);
    assert.equal(registry.getMobileSecondaryEditors().length, 0);
    for (const request of requests.splice(0)) {request.reply(list);}
    await tick();
    assert.equal(panel.blockId, "", "stale index responses must not restore locked content");
    assert.equal(panel.editors.length, 0);
    unregister();
    panel.destroy();

    window.siyuan.config.editor.backlinkGlobalSort = 1;
    const globalElement = document.createElement("div");
    globalElement.className = "panel";
    document.body.appendChild(globalElement);
    const globalPanel = new BacklinkContent({app: {}, element: globalElement, blockId: "host", rootId: "host",
        notebookId: "box", type: "local", surface: "mobile-sheet", onlyBacklinks: true});
    const unregisterGlobal = panels.registerMobileBacklinkPanel(globalPanel);
    await tick();
    for (const request of requests.splice(0)) {
        if (request.url === "/api/ref/getBacklink2") {
            assert.equal(request.data.includeBacklinks, false);
            request.reply({...list, backlinks: [], linkRefsCount: 0});
        } else {
            assert.equal(request.url, "/api/ref/getGlobalBacklinks");
            request.reply({snapshot: "global", offset: 0, total: 2, items: [
                {id: "first", rootID: "source1", box: "box", hPath: "/Source 1", anchor: "A1"},
                {id: "second", rootID: "source2", box: "box", hPath: "/Source 2", anchor: "A2"},
            ]});
        }
    }
    for (let i = 0; i < 20 && requests.length === 0; i++) { await tick(); }
    assert.equal(requests[0]?.url, "/api/ref/getGlobalBacklinkContexts");
    requests.shift().reply({expired: false, items: [
        {id: "first", revision: "first1", dom: "", blockPaths: [], expand: true},
        {id: "second", revision: "second1", dom: "", blockPaths: [], expand: true},
    ]});
    await tick();
    assert.equal(globalPanel.editors.length, 2, "global entries from separate documents must mount independently");
    assert.equal(globalElement.querySelector(".listCount").textContent, "2");
    assert.equal(globalElement.querySelector(".listCount").classList.contains("fn__none"), false);
    assert.equal(registry.getMobileSecondaryEditors().length, 2);
    const globalEditors = [...globalPanel.editors];
    const globalList = globalPanel.globalList;
    const firstRecord = globalList.records.get("first");
    const originalHeight = firstRecord.element.getBoundingClientRect().height;
    const originalScroll = globalList.onScroll;
    globalList.onScroll = noop;
    await globalList.release(firstRecord);
    assert.ok(Math.abs(firstRecord.element.getBoundingClientRect().height - originalHeight) < 1,
        "recycling must include the fallback path in the existing height");
    const restoring = globalList.loadContexts([firstRecord]);
    assert.equal(requests[0]?.url, "/api/ref/getGlobalBacklinkContexts");
    requests.shift().reply({expired: false, items: [
        {id: "first", revision: "first1", dom: "", blockPaths: [], expand: true},
    ]});
    await restoring;
    assert.ok(Math.abs(firstRecord.element.getBoundingClientRect().height - originalHeight) < 1,
        "restoring an editor must preserve the complete placeholder height");
    globalEditors[0] = firstRecord.editor;
    globalList.onScroll = originalScroll;
    globalPanel.type = "bottom";
    globalPanel.empty = true;
    globalElement.classList.add("sy__backlink--backlinks-empty", "sy__backlink--mentions-empty");
    globalList.clearUnavailable();
    assert.equal(globalElement.classList.contains("sy__backlink--backlinks-empty"), false,
        "a failed bottom list must keep its retry control visible");
    assert.equal(globalPanel.empty, false);
    assert.equal(globalList.message.textContent, "retry");
    globalList.message.click();
    await tick();
    assert.equal(requests[0]?.url, "/api/ref/getGlobalBacklinks");
    requests.shift().reply({snapshot: "empty", offset: 0, total: 0, items: []});
    await tick();
    assert.equal(globalList.hasError, false);
    assert.equal(globalElement.classList.contains("sy__backlink--backlinks-empty"), true,
        "a successful empty retry must restore normal empty handling");
    globalPanel.type = "local";
    globalList.search({...globalList.query, keyword: "restored"}, false);
    await tick();
    assert.equal(requests[0]?.url, "/api/ref/getGlobalBacklinks");
    requests.shift().reply({snapshot: "restored", offset: 0, total: 1, items: [
        {id: "first", rootID: "source1", box: "box", hPath: "/Source 1", anchor: "A1"},
    ]});
    for (let i = 0; i < 20 && requests.length === 0; i++) { await tick(); }
    assert.equal(requests[0]?.url, "/api/ref/getGlobalBacklinkContexts");
    requests.shift().reply({expired: false, items: [
        {id: "first", revision: "first2", dom: "", blockPaths: [], expand: true},
    ]});
    await tick();
    assert.equal(globalPanel.editors.length, 1);
    globalEditors.splice(0, globalEditors.length, ...globalPanel.editors);
    panels.removeMobileBacklinkContent({notebookId: "box"});
    assert.equal(globalPanel.editors.length, 0);
    assert.equal(registry.getMobileSecondaryEditors().length, 0);
    assert.ok(globalEditors.every(editor => editor.destroyed));
    assert.equal(globalElement.querySelector("[data-global-backlink-id]"), null);
    unregisterGlobal();
    globalPanel.destroy();
    window.siyuan.config.editor.backlinkGlobalSort = 0;

    const ownerElement = document.createElement("div");
    document.body.appendChild(ownerElement);
    const owner = {app: {}, element: ownerElement, block: {rootID: "host"}, notebookId: "box"};
    await load("mobile/util/openBacklinks").openMobileBacklinks(owner, "host");
    const sheet = panels.getMobileBacklinkPanels()[0];
    assert.ok(sheet instanceof BacklinkContent, "sheet must use the shared implementation");
    let finishSave;
    const save = new Promise(resolve => {finishSave = resolve;});
    const sheetEditor = new stubs["protyle/index"].Protyle({}, document.createElement("div"), {blockId: "ref"});
    sheet.element.appendChild(sheetEditor.protyle.element);
    sheet.editors.push(sheetEditor);
    registry.registerMobileSecondaryEditor(sheetEditor, noop);
    sheetEditor.protyle.wysiwyg.flushPendingInput = () => save;
    const closing = panels.closeMobileBacklinkSheets();
    await tick();
    assert.equal(sheetEditor.destroyed, undefined, "sheet must remain mounted until pending input completes");
    finishSave();
    await closing;
    assert.equal(sheetEditor.destroyed, true);
    assert.equal(panels.getMobileBacklinkPanels().length, 0);
    assert.equal(registry.getMobileSecondaryEditors().length, 0);
    for (const request of requests.splice(0)) {request.reply(list);}
    await tick();
    assert.equal(window.siyuan.dialogs.length, 0);
    const dragElement = document.createElement("div");
    dragElement.style.height = "400px";
    dragElement.innerHTML = '<div class="heading">Backlinks</div><div contenteditable="true">editable</div><div class="scroll" style="height:40px;overflow:auto"><div style="height:200px">content</div></div>';
    document.body.appendChild(dragElement);
    let closeCount = 0;
    const disposeDrag = load("mobile/util/bindBottomSheetDrag").bindBottomSheetDrag(dragElement,
        document.createElement("div"), async () => {closeCount++;});
    const touch = (target, type, y, x = 10) => {
        const event = new Event(type, {bubbles: true, cancelable: true});
        Object.defineProperties(event, {
            touches: {value: type === "touchend" ? [] : [{clientX: x, clientY: y}]},
            changedTouches: {value: [{clientX: x, clientY: y}]},
        });
        target.dispatchEvent(event);
        return event;
    };
    const heading = dragElement.firstElementChild;
    touch(heading, "touchstart", 0);
    assert.equal(touch(heading, "touchmove", 150).defaultPrevented, true);
    assert.equal(dragElement.style.transform, "translateY(150px)");
    touch(heading, "touchend", 150);
    await tick();
    assert.equal(closeCount, 1);
    assert.equal(heading.dispatchEvent(new MouseEvent("click", {bubbles: true, cancelable: true})), false);
    touch(heading, "touchstart", 0);
    touch(heading, "touchmove", 10);
    touch(heading, "touchend", 10);
    assert.equal(dragElement.style.transform, "");
    assert.equal(closeCount, 1, "short drag must rebound");
    for (const target of [dragElement.querySelector('[contenteditable="true"]'), dragElement.querySelector(".scroll > div")]) {
        dragElement.querySelector(".scroll").scrollTop = 30;
        touch(target, "touchstart", 0);
        assert.equal(touch(target, "touchmove", 150).defaultPrevented, false);
        touch(target, "touchend", 150);
        assert.equal(closeCount, 1, "editing and scrolled content must retain native gestures");
    }
    touch(heading, "touchstart", 0);
    touch(heading, "touchmove", 80);
    touch(heading, "touchcancel", 80);
    assert.equal(dragElement.style.transform, "");
    assert.equal(closeCount, 1);
    disposeDrag();
    return "Mobile backlink lifecycle cases passed";
};

if (process.versions.electron && process.type === "browser") {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", process.argv[2]);
    app.whenReady().then(async () => {
        const win = new BrowserWindow({show: false, webPreferences: {
            nodeIntegration: true, contextIsolation: false, backgroundThrottling: false, offscreen: true,
        }});
        let code = 0;
        try {
            await win.loadURL("data:text/html,<html><body></body></html>");
            win.webContents.debugger.attach("1.3");
            await win.webContents.debugger.sendCommand("Emulation.setFocusEmulationEnabled", {enabled: true});
            console.log(await win.webContents.executeJavaScript(`(${runCases.toString()})(${JSON.stringify(sources())})`));
        } catch (error) {
            console.error(error);
            code = 1;
        } finally {
            win.destroy();
            app.exit(code);
        }
    });
} else {
    const {it} = require("node:test");
    const {execFile} = require("node:child_process");
    const {promisify} = require("node:util");
    it("shares mobile backlink rendering and preserves editor lifecycle", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 45000,
    }, async () => {
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-mobile-backlinks-"));
        try {
            const {stdout} = await promisify(execFile)(require("electron"), [__filename, profile], {
                env, windowsHide: true, timeout: 40000,
            });
            assert.match(stdout, /Mobile backlink lifecycle cases passed/);
        } finally {
            assert.equal(path.dirname(profile), os.tmpdir());
            assert.ok(path.basename(profile).startsWith("siyuan-mobile-backlinks-"));
            rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
