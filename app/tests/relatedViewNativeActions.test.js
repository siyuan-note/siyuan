const assert = require("node:assert/strict");
const {readFileSync, mkdtempSync, rmSync} = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const sources = mobile => {
    const ts = require("typescript");
    const {parse} = require("ifdef-loader/preprocessor");
    const root = path.join(__dirname, "../src/protyle/render/av");
    return Object.fromEntries(["relatedView", "host", "action", "cell", "asset", "blockAttr", "openMenuPanel", "panels/asset", "../../preview/image"].map(name => [name,
        ts.transpileModule(parse(readFileSync(path.join(root, name + ".ts"), "utf8"), {MOBILE: mobile, BROWSER: !mobile}), {
            compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS},
        }).outputText]));
};

const cases = async (compiled, mobile) => {
    const check = require("node:assert/strict");
    const tick = () => new Promise(resolve => setTimeout(resolve, 0));
    const requests = [], previews = [], navigations = [], sharedRenders = [], transactions = [], messages = [], timeouts = [];
    const data = new WeakMap();
    const lang = new Proxy({}, {get: (_object, key) => key === "_attrView" ? lang : String(key)});
    const menu = {remove() {}, element: document.createElement("div")};
    menu.element.className = "fn__none";
    window.siyuan = {config: {readonly: false}, languages: lang, menus: {menu}, zIndex: 0, mobile: {}};
    window.Viewer = class {
        constructor(element) { previews.push([...element.querySelectorAll("img")].map(image => image.getAttribute("src"))); }
        show() {} destroy() {}
    };
    let filterResolve, pendingFilter = false, confirm, pendingRender = false, nextSource = 0;
    class Editor { constructor(protyle) { this.editor = {protyle}; } }
    const noop = () => {};
    const deps = {
        hasClosestBlock: node => node?.closest("[data-node-id]"),
        hasClosestByClassName: (node, name) => (node?.nodeType === 3 ? node.parentElement : node)?.closest("." + name),
        isTableLikeView: view => view === "table", isMobile: () => mobile, isInMobileApp: () => false,
        getAVBatchEditMode: () => "replace", isBrowserRenderableImagePath: () => true,
        getCompressURL: value => value, removeCompressURL: value => value,
        escapeHtml: String, escapeAttr: String, escapeAriaLabel: String, escapeHtmlTextAndAttr: String,
        getAVData: element => data.get(element), setAVData: (element, value) => data.set(element, value),
        getAVSelectedItemIDs: () => [], getAVSelectedItemPoints: () => [], getFieldsByData: () => [],
        getPageSize: () => ({}), isAVRenderData: () => true,
        preserveAVBindingRange: () => noop,
        prepareFilterColumns: () => pendingFilter ? new Promise(resolve => { filterResolve = resolve; }) : Promise.resolve(),
        avRender: async (element, editor, callback) => {
            if (!element.dataset.nodeId) return;
            sharedRenders.push({element, editor, callback});
            if (!pendingRender) callback({id: "target", viewID: "view", viewType: "table", view: {}, views: []});
        },
        transaction: (editor, forward, undo, options) => transactions.push({editor, forward, undo, options}),
        initUnfoldedGroupTables: noop, setAVGroupFolded: noop, beginAVRender: noop,
        getAVCurrentViewID: element => element.getAttribute("custom-sy-av-view") || "view",
        getAVPanelDescriptor: type => type === "asset" ? modules["panels/asset"].assetPanel : {
            render: context => { context.html = '<input data-config="true">'; return true; },
        },
        dispatchAVPanelAction: (context, action) => modules["panels/asset"].assetPanel.actions[action.type]?.(context, action) || "continue",
        fetchPost: (url, payload, callback) => {
            requests.push({url, payload});
            if (url.endsWith("renderAttributeView")) callback({code: 0, data: {id: "target", view: {rows: []}, viewType: "table"}});
            else if (url.endsWith("getCurrentAttrViewImages")) callback({code: 0, data: ["assets/member.png", "assets/unrelated.png"]});
            else if (url.endsWith("getAttributeViewKeys")) callback({code: 0, data: []});
            else if (url.endsWith("getAttributeViewBacklinks")) callback({code: 0, data: {total: 0, items: []}});
        },
        fetchSyncPost: async (url, payload) => {
            requests.push({url, payload});
            return {code: 0, data: {blockIDs: ["target-carrier"], notebookID: "target-notebook"}};
        },
        mobileConfirmDialog: (_title, _message, callback) => { confirm = callback; },
        openMobileFileById: async (_app, id, _action, _position, notebookID, callback) => {
            navigations.push({id, notebookID, callback}); return true;
        },
        openFileById: async options => navigations.push({id: options.id, notebookID: options.notebookId,
            callback: protyle => options.afterOpen(new Editor(protyle))}),
        Editor, addScript: () => Promise.resolve(), showMessage: message => messages.push(message),
        Constants: {CUSTOM_SY_AV_VIEW: "custom-sy-av-view", TIMEOUT_LOAD: 0, CB_GET_HL: "hl", CB_GET_CONTEXT: "context"},
    };
    const imports = new Proxy(deps, {get: (object, key) => key in object ? object[key] : noop});
    const modules = {};
    const load = name => {
        if (modules[name]) return modules[name];
        const exports = modules[name] = {};
        const timer = (callback, delay) => {
            if (delay !== 10000) return setTimeout(callback, delay);
            const value = {callback, cancelled: false}; timeouts.push(value); return value;
        };
        new Function("require", "exports", "setTimeout", "clearTimeout", compiled[name])(specifier => {
            let key = specifier.replace(/^\.\//, "");
            if (name === "panels/asset" && specifier === "../asset") key = "asset";
            if (specifier.endsWith("/preview/image")) key = "../../preview/image";
            return compiled[key] ? load(key) : imports;
        }, exports, timer, value => {
            if (value && typeof value === "object") value.cancelled = true;
            else clearTimeout(value);
        });
        return exports;
    };
    for (const name of Object.keys(compiled)) load(name);
    const api = modules.relatedView, hostAPI = modules.host;
    const attributes = document.createElement("div");
    document.body.append(attributes);
    for (const carrier of ["target-carrier", "another-target-carrier"]) {
        for (const disabled of [false, true]) {
            modules.blockAttr.renderAVAttribute(attributes, "entry", {id: "metadata", disabled, options: {}}, undefined,
                {avID: "target", itemID: "entry", valueID: "value", databaseBlockID: carrier});
            for (const endpoint of ["getAttributeViewKeys", "getAttributeViewBacklinks"]) {
                check.deepEqual(requests.findLast(request => request.url.endsWith(endpoint)).payload,
                    {id: "entry", avID: "target", itemID: "entry", valueID: "value", blockID: carrier});
            }
        }
    }
    modules.blockAttr.renderAVAttribute(attributes, "document", {id: "metadata", options: {}});
    check.deepEqual(requests.findLast(request => request.url.endsWith("getAttributeViewKeys")).payload, {id: "document"});
    api.disposeRelatedAVViews(attributes); attributes.remove();
    const mount = () => {
        const source = document.createElement("div");
        source.className = "custom-attr";
        source.innerHTML = '<div data-av-id="source"></div>';
        document.body.append(source);
        const editor = {id: "native-source-" + ++nextSource, disabled: false, options: {}, app: {appId: "app"}, element: source};
        api.mountRelatedAVViews(source, [{avID: "source", keyValues: [
            {key: {type: "block"}, values: [{blockID: "source-entry"}]},
            {key: {type: "relation", id: "relation", relation: {avID: "target", detailView: {spec: 1, enabled: true, viewID: "view"}}}},
        ]}], editor, "source-carrier");
        api.syncRelatedAVViews(source);
        const host = source.querySelector("[data-av-host]");
        host.innerHTML = '<div class="av__container"><div class="av__views"><span data-type="av-filter">Filter</span><span data-type="av-more">Settings</span></div><div class="av__scroll"><div class="av__body" data-group-id="group"><div class="av__row av__row--header"><div data-col-id="image" data-dtype="mAsset"></div></div><div class="av__row" data-id="member"><div class="av__colsticky"></div><div class="av__cell" data-col-id="image" data-id="value"><img class="av__cellassetimg" src="assets/member.png"></div></div></div></div></div>';
        host.querySelector(".av__cell").dataset.cellValue = encodeURIComponent(JSON.stringify({type: "mAsset", mAsset: [
            {type: "image", content: "assets/member.png", name: ""},
        ]}));
        const av = {id: "target", viewID: "view", view: {filters: []}, views: []};
        data.set(host, av); hostAPI.getAVRelationHost(host).rendered(av);
        return {source, editor, host, dispose: () => {
            api.disposeRelatedAVViews(source); source.remove(); document.querySelector(".av__panel")?.remove();
        }};
    };
    const target = (withCarrier = true, viewID = "view") => {
        const tab = document.createElement("div"), element = document.createElement("div"), root = document.createElement("div");
        tab.append(element); element.append(root); document.body.append(tab);
        const protyle = {id: "native-target", disabled: false, element, wysiwyg: {element: root}, block: {rootID: "target-doc"},
            options: {}, notebookId: "target-notebook"};
        const add = () => {
            root.innerHTML = `<div class="av" data-av-id="target" data-node-id="target-carrier" custom-sy-av-view="${viewID}"><div class="av__views"></div></div>`;
        };
        if (withCarrier) add();
        window.siyuan.mobile.editor = {protyle};
        return {protyle, tab, element, root, add, remove: () => tab.remove()};
    };
    const dispatch = async state => {
        state.host.querySelector('[data-type="av-more"]').click();
        await confirm();
        check.equal(navigations.at(-1).id, "target-carrier");
        check.equal(navigations.at(-1).notebookID, "target-notebook");
        return navigations.at(-1);
    };

    const asset = mount();
    asset.host.querySelector(".av__cell").click(); await tick();
    const preview = document.querySelector('.av__panel [data-type="openAssetItem"]');
    check.ok(preview);
    preview.click(); await tick();
    check.deepEqual(previews.at(-1), ["assets/member.png"]);
    check.equal(requests.some(request => request.url.endsWith("getCurrentAttrViewImages")), false);
    asset.dispose();
    const previewCount = previews.length, requestCount = requests.length;
    modules.asset.previewAVAssetImages("assets/member.png", asset.host);
    modules.openMenuPanel.openMenuPanel({blockElement: asset.host, protyle: asset.editor, type: "filters",
        filterOperation: {save() {}}});
    await tick();
    check.equal(previews.length, previewCount); check.equal(requests.length, requestCount);
    check.equal(document.querySelector(".av__panel"), null);
    const ordinary = document.createElement("div");
    ordinary.innerHTML = '<div class="av" data-av-id="ordinary" data-node-id="real-carrier" custom-sy-av-view="real-view"><span data-type="av-search">query</span><div class="av__body" data-group-id="group"><span class="av__cell"></span></div></div>';
    modules.asset.previewAVAssetImages("assets/member.png", ordinary.firstElementChild, ordinary.querySelector(".av__cell"));
    check.deepEqual(requests.at(-1).payload, {id: "ordinary", blockID: "real-carrier", viewID: "real-view", query: "query", groupID: "group"});

    for (const change of ["dispose", "hidden", "readonly", "replace", "new-panel", "valid"]) {
        const state = mount(); pendingFilter = true;
        state.host.querySelector('[data-type="av-filter"]').click(); check.equal(typeof filterResolve, "function");
        let newer;
        if (change === "dispose") state.dispose();
        if (change === "hidden") { state.source.classList.add("fn__none"); api.syncRelatedAVViews(state.source); }
        if (change === "readonly") { state.editor.disabled = true; api.syncRelatedAVViews(state.source); }
        if (change === "replace") hostAPI.setAVRelationHost(state.host, {...hostAPI.getAVRelationHost(state.host)});
        if (change === "new-panel") { newer = document.createElement("div"); newer.className = "av__panel"; document.body.append(newer); }
        filterResolve(); await tick();
        if (change === "valid") check.ok(document.querySelector(".av__panel"));
        else check.equal(document.querySelector(".av__panel"), newer || null, change);
        state.dispose(); pendingFilter = false;
    }

    for (const late of [false, true]) {
        const state = mount(), destination = target(!late), opening = await dispatch(state);
        state.dispose(); opening.callback(destination.protyle);
        const before = sharedRenders.length;
        if (late) { destination.add(); await tick(); check.equal(sharedRenders.length, before + 1); }
        check.ok(document.querySelector('.av__panel [data-config="true"]'));
        document.querySelector(".av__panel").remove(); destination.remove();
    }
    for (const change of ["readonly", "domain", "wrong-av", "closed", "history", "hidden", "another-editor"]) {
        const state = mount(), destination = target(), opening = await dispatch(state);
        const before = sharedRenders.length, beforeTransactions = transactions.length;
        if (change === "readonly") destination.protyle.disabled = true;
        if (change === "domain") destination.protyle.notebookId = "other-notebook";
        if (change === "wrong-av") destination.root.firstElementChild.dataset.avId = "other-av";
        if (change === "closed") destination.remove();
        if (change === "history") destination.protyle.options.history = {created: 1};
        if (change === "hidden") destination.element.classList.add("fn__none");
        if (change === "another-editor") {
            if (mobile) window.siyuan.mobile.editor = {protyle: {}};
            else destination.protyle.wysiwyg.element = document.createElement("div");
        }
        state.dispose(); opening.callback(destination.protyle); await tick();
        check.equal(sharedRenders.length, before, change); check.equal(transactions.length, beforeTransactions, change);
        check.equal(document.querySelector(".av__panel"), null, change); destination.remove();
    }
    for (const change of ["readonly", "valid"]) {
        const state = mount(), destination = target(true, "previous"), opening = await dispatch(state);
        state.dispose(); opening.callback(destination.protyle);
        check.equal(transactions.at(-1).forward[0].action, "setAttrViewBlockView");
        check.equal(transactions.at(-1).forward[0].blockID, "target-carrier");
        const before = sharedRenders.length;
        if (change === "readonly") destination.protyle.disabled = true;
        transactions.at(-1).options.callback(); await tick();
        check.equal(sharedRenders.length, before + Number(change === "valid"));
        document.querySelector(".av__panel")?.remove(); destination.remove();
    }
    for (const change of ["new-document", "locked", "valid"]) {
        const state = mount(), destination = target(), opening = await dispatch(state);
        pendingRender = true; state.dispose(); opening.callback(destination.protyle);
        const rendered = sharedRenders.at(-1);
        if (change === "new-document") destination.protyle.block.rootID = "different-document";
        if (change === "locked") destination.protyle.disabled = true;
        rendered.callback({id: "target", viewType: "table", view: {}}); await tick();
        check.equal(!!document.querySelector(".av__panel"), change === "valid");
        pendingRender = false; document.querySelector(".av__panel")?.remove(); destination.remove();
    }
    for (const change of ["timeout", "close", "next-navigation"]) {
        const state = mount(), destination = target(false), opening = await dispatch(state);
        opening.callback(destination.protyle);
        const timeout = timeouts.at(-1), before = sharedRenders.length, messageCount = messages.length;
        if (change === "timeout") { timeout.callback(); check.equal(messages.length, messageCount + 1); }
        if (change === "close") { destination.element.remove(); await tick(); }
        if (change === "next-navigation") await dispatch(state);
        check.equal(timeout.cancelled, true, change);
        destination.add(); await tick(); check.equal(sharedRenders.length, before, change);
        state.dispose(); destination.remove();
    }
    check.ok(timeouts.every(timeout => timeout.cancelled));
    return `Native related actions passed: ${mobile ? "mobile" : "desktop"}`;
};

if (process.versions.electron && process.type === "browser") {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", process.argv[2]);
    app.commandLine.appendSwitch("disable-gpu");
    app.whenReady().then(async () => {
        const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false,
            offscreen: true, backgroundThrottling: false}});
        try {
            for (const mobile of [false, true]) {
                await win.loadURL("about:blank");
                console.log(await win.webContents.executeJavaScript(`(${cases.toString()})(${JSON.stringify(sources(mobile))}, ${mobile})`));
            }
            win.destroy(); app.exit(0);
        } catch (error) { console.error(error); win.destroy(); app.exit(1); }
    });
} else {
    require("node:test").test("native related actions keep image previews scoped and bind async panels to their current source or destination", {timeout: 60000}, async () => {
        const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE;
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-related-native-"));
        try {
            const args = [__filename, profile];
            if (process.platform === "linux" && !env.DISPLAY && !env.WAYLAND_DISPLAY) args.push("--ozone-platform=headless");
            if (process.platform === "linux" && process.getuid?.() === 0) args.push("--no-sandbox");
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), args, {env, timeout: 55000, windowsHide: true});
            assert.match(stdout, /Native related actions passed: desktop/);
            assert.match(stdout, /Native related actions passed: mobile/);
        } finally { rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100}); }
    });
}
